
# Project Overview

This project provides functionality to record user interactions on a website using the rrweb library. It includes features for session management, configuration validation, and automatic reconnection attempts.

## Table of Contents
- [Installation](#installation)
- [Usage](#usage)
- [Functions](#functions)
- [Configuration](#configuration)
- [License](#license)

## Installation

To use this script, include it in your HTML file:

```html
<script src="path/to/record.js"></script>
```

## Usage

The script automatically initializes and starts recording user interactions when the required configuration is detected in the `window.recordConfig` object.

### Example Configuration

```javascript
window.recordConfig = {
    userId: 'your-user-id',
    siteId: 'your-site-id',
    siteKey: 'your-site-key',
    enableFallback: true, // Optional
    checkSession: function() {
        // Custom session check logic
        return true;
    }
};
```

## Functions

### `isSessionActive(customCheck)`
Checks if a session is active based on cookies or tokens.

### `isValidConfig(config)`
Validates the configuration object.

### `isValidGUID(str)`
Validates if a string is a valid GUID.

### `attemptReconnect(userId, siteId, siteKey, sessionId)`
Attempts to reconnect to the WebSocket server with exponential backoff.

### `setCookie(name, value, hours)`
Sets a cookie with the specified name, value, and expiration time.

### `getCookie(name)`
Retrieves the value of a cookie by name.

### `checkConfigAndInitialize()`
Checks for the configuration object and initializes recording if found.

### `loadRrwebScript()`
Loads the rrweb script dynamically.

### `startRecording(socket, userId, siteId, siteKey)`
Starts recording user interactions and sends events to the WebSocket server.

### `initializeRecording()`
Initializes the recording process by validating the configuration and setting up the WebSocket connection.

## Configuration

The script expects a global `window.recordConfig` object with the following properties:

- **userId** (string): The user ID.
- **siteId** (string): The site ID.
- **siteKey** (string): The site key (64-character hexadecimal string).
- **enableFallback** (boolean, optional): Whether to enable fallback if no active session is detected.
- **checkSession** (function, optional): Custom function to check if a session is active.

## License

This project is licensed under the MIT License.
