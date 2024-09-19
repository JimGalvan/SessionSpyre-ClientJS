(async function () {
    const REQUIRED_CONFIG_KEYS = ['userId', 'siteId', 'siteKey'];
    const COOKIE_NAMES = ['sessionid', 'authToken', 'JSESSIONID', 'csrftoken'];
    const TOKEN_NAMES = ['authToken', 'sessionToken', 'jwtToken', 'accessToken'];

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
            console.error("Invalid or missing configuration. Event recording will not start.");
            return;
        }

        const {userId, siteId, siteKey, enableFallback = true} = config;

        let sessionId = getCookie('recording_session_id');
        if (sessionId && !isValidGUID(sessionId)) {
            console.warn('Invalid session ID in cookie:', sessionId);
            sessionId = null;
        }

        const sessionIsActive = isSessionActive(config.checkSession);

        if (sessionId) {
            console.debug("Session ID found in cookie:", sessionId);
        }

        if (!sessionIsActive && !enableFallback) {
            console.debug("No active session detected and fallback is disabled. Event recording will not start.");
            return;
        }

        if (!sessionIsActive && enableFallback) {
            console.debug("No active session detected, but fallback is enabled. Recording will start.");
        }

        const socket = setupWebSocketConnection(userId, siteId, siteKey, sessionId);
        startRecording(socket, userId, siteId, siteKey);
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
            document.cookie.split(';').some(cookie => {
                const [, value] = cookie.split('=');
                return value && value.trim().length > 20 && /^[a-zA-Z0-9_-]+$/.test(value.trim());
            }) ||
            TOKEN_NAMES.some(tokenName => localStorage.getItem(tokenName) || sessionStorage.getItem(tokenName));
    }

    function setupWebSocketConnection(userId, siteId, siteKey, sessionId) {
        let params = `?userId=${encodeURIComponent(userId)}&siteId=${encodeURIComponent(siteId)}&siteKey=${encodeURIComponent(siteKey)}`;
        if (sessionId) {
            params += `&sessionId=${encodeURIComponent(sessionId)}`;
        }

        const siteUrl = window.location.href;
        params += `&siteUrl=${encodeURIComponent(siteUrl)}`;
        console.debug("Full URL:", siteUrl);
        console.debug("session id:", sessionId);
        const wsProtocol = window.location.protocol === 'https:' ? 'wss://' : 'ws://';
        const socket = new WebSocket(`${wsProtocol}sessionspyre-production.up.railway.app/ws/record-session/${params}`);

        socket.onopen = () => console.debug("WebSocket connection opened");
        socket.onmessage = event => {
            console.debug("Message from server:", event.data);
            const data = JSON.parse(event.data);
            console.debug("Message: ", data.message);
            if (data.message && isValidGUID(data.message)) {
                sessionId = data.message;
                setCookie('recording_session_id', sessionId, 8);
                console.debug('Session ID received and stored:', sessionId);
            } else {
                console.error('Invalid session ID received:', data.message);
            }
        };
        socket.onclose = () => console.debug("WebSocket connection closed");

        return socket;
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
                    events = [];
                }
            },
            sampling: {
                input: 'last',
                mouseInteraction: {
                    MouseUp: false, MouseDown: false, Click: false, ContextMenu: false,
                    DblClick: false, Focus: false, Blur: false, TouchStart: false, TouchEnd: false,
                },
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
            }
            stopRecording();
            socket.close();
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
        console.error("Configuration object not found within the timeout period. Event recording will not start.");
    }, 20000);

    await loadRrwebScript();
    checkConfigAndInitialize();
})();
