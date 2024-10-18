(async function () {
    const REQUIRED_CONFIG_KEYS = ['userId', 'siteId', 'siteKey'];
    const COOKIE_NAMES = ['sessionid', 'authToken', 'JSESSIONID', 'csrftoken'];
    const TOKEN_NAMES = ['authToken', 'sessionToken', 'jwtToken', 'accessToken'];

    let reconnectAttempts = 0;
    const initialDelay = 1000; // 1 second
    const maxDelay = 30000; // 30 seconds
    const maxReconnectAttempts = 10;

    // Define log levels
    const LOG_LEVELS = {
        'debug': 1,
        'info': 2,
        'warn': 3,
        'error': 4,
        'none': 5
    };

    // Initialize logger with default no-op functions
    let logger = {
        debug: () => {},
        info: () => {},
        warn: () => {},
        error: () => {},
    };

    async function loadRrwebScript() {
        return new Promise((resolve, reject) => {
            const script = document.createElement('script');
            script.src = 'https://cdn.jsdelivr.net/npm/rrweb@latest/dist/rrweb.min.js';
            script.onload = resolve;
            script.onerror = reject;
            document.head.appendChild(script);
        });
    }

    async function initializeRecording() {
        const config = window.recordConfig;

        if (!isValidConfig(config)) {
            logger.error("Invalid or missing configuration. Event recording will not start.");
            return;
        }

        const {
            userId,
            siteId,
            siteKey,
            enableFallback = true,
            log_level = 'none' // Default to 'none' if not specified
        } = config;

        // Determine current log level
        const currentLogLevel = LOG_LEVELS[log_level] || LOG_LEVELS['none'];

        // Create logger based on log_level
        logger = createLogger(currentLogLevel);

        logger.debug("Configuration loaded:", config);

        let sessionId = getCookie('recording_session_id');
        if (sessionId && !isValidGUID(sessionId)) {
            logger.warn('Invalid session ID in cookie:', sessionId);
            sessionId = null;
        }

        const sessionIsActive = isSessionActive(config.checkSession);

        if (!sessionIsActive && !enableFallback) {
            logger.debug("No active session detected and fallback is disabled. Event recording will not start.");
            return;
        }

        const socket = await setupWebSocketConnection(userId, siteId, siteKey, sessionId);
        startRecording(socket, userId, siteId, siteKey);
    }

    function createLogger(level) {
        return {
            debug: level <= LOG_LEVELS['debug'] ? console.debug.bind(console) : () => {},
            info: level <= LOG_LEVELS['info'] ? console.info.bind(console) : () => {},
            warn: level <= LOG_LEVELS['warn'] ? console.warn.bind(console) : () => {},
            error: level <= LOG_LEVELS['error'] ? console.error.bind(console) : () => {},
        };
    }

    function isValidConfig(config) {
        if (!config || typeof config !== 'object') return false;

        return REQUIRED_CONFIG_KEYS.every(key => {
            const value = config[key];
            switch (key) {
                case 'userId':
                case 'siteId':
                    return typeof value === 'string' && isValidGUID(value);
                case 'siteKey':
                    return typeof value === 'string' && value.length === 64 && /^[a-f0-9]+$/.test(value);
                default:
                    return false;
            }
        });
    }

    function isValidGUID(str) {
        const guidRegex = /^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$/;
        return guidRegex.test(str);
    }

    function getCookie(name) {
        const value = `; ${document.cookie}`;
        const parts = value.split(`; ${name}=`);
        if (parts.length === 2) {
            const cookieValue = parts.pop().split(';').shift();
            return decodeURIComponent(cookieValue);
        }
    }

    function setCookie(name, value, hours) {
        const expires = new Date(Date.now() + hours * 60 * 60 * 1000).toUTCString();
        document.cookie = `${name}=${encodeURIComponent(value)}; expires=${expires}; path=/; SameSite=None; Secure`;
    }

    function isSessionActive(customCheck) {
        if (typeof customCheck === 'function') return customCheck();

        return COOKIE_NAMES.some(cookieName => document.cookie.includes(`${cookieName}=`)) ||
            TOKEN_NAMES.some(tokenName => localStorage.getItem(tokenName) || sessionStorage.getItem(tokenName));
    }

    function setupWebSocketConnection(userId, siteId, siteKey, sessionId) {
        return new Promise((resolve) => {
            let params = `?userId=${encodeURIComponent(userId)}&siteId=${encodeURIComponent(siteId)}&siteKey=${encodeURIComponent(siteKey)}`;
            if (sessionId) {
                params += `&sessionId=${encodeURIComponent(sessionId)}`;
            }

            const siteUrl = window.location.href;
            params += `&siteUrl=${encodeURIComponent(siteUrl)}`;
            const wsProtocol = window.location.protocol === 'https:' ? 'wss://' : 'ws://';
            let socket = new WebSocket(`${wsProtocol}sessionspyre-production.up.railway.app/ws/record-session/${params}`);

            socket.onopen = () => {
                logger.debug("WebSocket connection opened");
                reconnectAttempts = 0; // Reset reconnect attempts on successful connection
                resolve(socket);
            };

            socket.onmessage = event => {
                const data = JSON.parse(event.data);

                if (data.message === undefined || data.message === null) {
                    logger.debug("Received empty message from server");
                    return;
                }

                if (data.message === 'Unauthorized') {
                    logger.error("Unauthorized access. Please check your site key and user ID.");
                    socket.close();
                    return;
                }

                if (data.message && isValidGUID(data.message)) {
                    sessionId = data.message;
                    setCookie('recording_session_id', sessionId, 8);
                    logger.debug('Session ID updated:', sessionId);
                } else {
                    logger.debug("Received unknown message from server:", data.message);
                }
            };

            socket.onclose = (event) => {
                logger.debug(`WebSocket connection closed with code: ${event.code}`);

                // Check for specific error codes where we should not reconnect
                if (event.code === 4004) {
                    logger.error("WebSocket closed due to invalid authorization. No reconnect will be attempted.");
                    return; // Stop reconnection attempts for unauthorized or invalid connections
                }

                // For any other close event, attempt to reconnect
                attemptReconnect(userId, siteId, siteKey, sessionId);
            };

            socket.onerror = () => {
                logger.error("WebSocket error occurred");
                socket.close(); // Close the connection and attempt reconnect
            };
        });
    }

    function attemptReconnect(userId, siteId, siteKey, sessionId) {
        if (reconnectAttempts < maxReconnectAttempts) {
            const delay = Math.min(initialDelay * Math.pow(2, reconnectAttempts), maxDelay);
            reconnectAttempts++;
            logger.info(`Reconnecting in ${delay / 1000} seconds... (Attempt ${reconnectAttempts})`);

            setTimeout(() => {
                setupWebSocketConnection(userId, siteId, siteKey, sessionId).then((socket) => {
                    startRecording(socket, userId, siteId, siteKey);
                });
            }, delay);
        } else {
            logger.error("Max reconnect attempts reached. Please check your network connection.");
        }
    }

    function startRecording(socket, userId, siteId, siteKey) {
        let events = [];
        const stopRecording = rrweb.record({
            emit(event) {
                events.push(event);
                if (events.length >= 10) {
                    socket.send(JSON.stringify({
                        user_id: userId,
                        site_id: siteId,
                        current_site_url: window.location.href,
                        events
                    }));
                    logger.debug("Sent 10 events to the server");
                    events = [];
                }
            }
        });

        window.addEventListener('beforeunload', () => {
            if (events.length > 0) {
                socket.send(JSON.stringify({
                    user_id: userId,
                    site_id: siteId,
                    current_site_url: window.location.href,
                    events,
                }));
                logger.debug("Sent remaining events to the server before unload");
            }
            stopRecording();
            socket.close();
            logger.debug("Stopped recording and closed WebSocket connection");
        });
    }

    function checkConfigAndInitialize() {
        if (window.recordConfig) {
            clearInterval(configCheckInterval);
            clearTimeout(timeoutHandle);
            initializeRecording();
        }
    }

    const configCheckInterval = setInterval(checkConfigAndInitialize, 1000);
    const timeoutHandle = setTimeout(() => {
        clearInterval(configCheckInterval);
        logger.error("Configuration object not found within the timeout period. Event recording will not start.");
    }, 20000);

    try {
        await loadRrwebScript();
        logger.debug("rrweb script loaded successfully");
    } catch (error) {
        logger.error("Failed to load rrweb script:", error);
    }
    checkConfigAndInitialize();
})();
