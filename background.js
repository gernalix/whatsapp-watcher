"use strict";

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (!message || message.type !== "whatsapp-watcher-read") {
    return false;
  }

  const chat = String(message.chat || "chat WhatsApp").trim() || "chat WhatsApp";
  const notificationId = `whatsapp-watcher-${Date.now()}`;

  chrome.notifications.create(
    notificationId,
    {
      type: "basic",
      iconUrl: "icon128.png",
      title: "WhatsApp — messaggio letto",
      message: `Il tuo ultimo messaggio in “${chat}” è stato letto.`,
      priority: 1
    },
    () => {
      const error = chrome.runtime.lastError;
      sendResponse({ ok: !error, error: error ? error.message : null });
    }
  );

  return true;
});
