# whatsapp-watcher

Chrome/Chromium extension for WhatsApp Web that notifies when the latest outgoing message in one selected chat becomes read.

## What it does

- runs only on `https://web.whatsapp.com/`;
- lets you arm the **currently open chat** from a small on-page panel;
- follows the latest message sent by you in that chat;
- detects the WhatsApp Web read-receipt state (double blue tick / `*-dblcheck-ack`), with conservative accessibility/color fallbacks;
- sends one desktop notification when that latest outgoing message changes from not-read to read;
- automatically starts following a newer outgoing message if you send another one;
- persists the selected chat and last observed message in `chrome.storage.local` across reloads;
- never sends WhatsApp content or metadata to any external server.

## Install on Fedora / Chrome

The canonical checkout is expected at:

```text
/home/daniele/projects/whatsapp-watcher
```

`github-autosync` should clone/update it automatically. Then:

1. Open `chrome://extensions`.
2. Enable **Developer mode**.
3. Choose **Load unpacked**.
4. Select `/home/daniele/projects/whatsapp-watcher`.
5. Open or reload WhatsApp Web.

## Use

1. Open the chat you want to monitor.
2. In the bottom-right **WA Watcher** panel, click **Watch current chat**.
3. Leave WhatsApp Web running.
4. When the latest outgoing message becomes read, the extension sends one desktop notification.
5. Click **Stop** to disarm it.

The panel can be collapsed with `–`.

## Detection strategy

The extension intentionally avoids WhatsApp private JavaScript stores and WebSocket interception. It reads only the DOM WhatsApp Web already renders.

Primary read-state markers:

```text
msg-dblcheck-ack
msg-dblcheck-ack-light
status-dblcheck-ack
status-dblcheck-ack-light
```

It also accepts explicit accessibility labels such as `Read` / `Letto` and, only as a fallback, the blue color of a double-check icon.

## Limitations

- Read receipts must be enabled and exposed by WhatsApp.
- Detection is strongest while the watched chat is open.
- When another chat is open, the extension can still notice the transition if the watched chat is currently rendered in the left sidebar and its preview still represents your outgoing message.
- WhatsApp Web is not a stable public DOM API. A future UI update can require selector adjustments.
- Group-chat blue ticks mean the WhatsApp UI considers the message read according to its group-read semantics.

## Privacy

No network requests are added by this extension. The only persisted values are the watched chat label, an opaque fingerprint/data-id for the current outgoing message, and its last observed read state.

## Files

- `manifest.json` — Manifest V3 configuration.
- `content.js` — WhatsApp DOM watcher and compact control panel.
- `background.js` — desktop notification bridge.
- `icon128.png` — local extension/notification icon.
