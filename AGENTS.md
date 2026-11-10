# WhatsApp Read Watcher

## Purpose and boundaries
This Manifest V3 Chrome/Chromium extension watches the read state of the latest outgoing message in one user-selected WhatsApp Web chat and issues a desktop notification. MegaVault owns project identity and repository location; C2/C3 are frozen references; use the existing Git owner for source work. WhatsApp Web and browser notification/storage APIs are external.

## Architecture and data
`content.js` reads the DOM rendered by `https://web.whatsapp.com/`, keeps a small local state in `chrome.storage.local`, and messages `background.js` to create a desktop notification. `manifest.json` limits the content script and host permission to WhatsApp Web. See `README.md` for selectors, limitations, and user controls.

## Privacy and validation
Do not add network requests, private WhatsApp API access, WebSocket interception, or external collection of chat/message metadata. The extension retains the watched chat label, a message identifier/fingerprint, read/dedup state and a random watch ID locally. Producer tab/document ownership is browser-session control metadata, not message content. Use `node --check` and validate the manifest JSON for source checks; do not open WhatsApp Web or a user's chat during validation. The user controls when to arm or stop watching.

`read-policy.js` contains pure supplied-value classification and fingerprints; load it before the DOM adapter through the manifest. Run `node --test tests/read-policy.test.cjs tests/control-state.test.cjs` without accessing WhatsApp, Chrome profiles or notifications. The control tests execute source against fabricated documents and Chrome API stubs only. Preserve marker, label and color semantics; browser/DOM acceptance remains separate.
