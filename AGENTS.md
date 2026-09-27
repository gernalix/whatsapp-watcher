# WhatsApp Read Watcher

## Purpose and boundaries
This Manifest V3 Chrome/Chromium extension watches the read state of the latest outgoing message in one user-selected WhatsApp Web chat and issues a desktop notification. MegaVault owns project identity and repository location; C2 owns task lifecycle. WhatsApp Web and browser notification/storage APIs are external.

## Architecture and data
`content.js` reads the DOM rendered by `https://web.whatsapp.com/`, keeps a small local state in `chrome.storage.local`, and messages `background.js` to create a desktop notification. `manifest.json` limits the content script and host permission to WhatsApp Web. See `README.md` for selectors, limitations, and user controls.

## Privacy and validation
Do not add network requests, private WhatsApp API access, WebSocket interception, or external collection of chat/message metadata. The extension retains only the watched chat label, a message identifier/fingerprint, and read state in browser-local storage. Use `node --check` and validate the manifest JSON for source checks; do not open WhatsApp Web or a user's chat during validation. The user controls when to arm or stop watching.
