"use strict";

importScripts("read-policy.js");

const STATE_KEY = "whatsappWatcherStateV2";
const OWNER_KEY = "whatsappWatcherOwnerV2";
const PREFIX = "whatsapp-watcher-v2-";
const emptyState = () => ({ armed: false, chat: null, messageKey: null, lastRead: null, notifiedKey: null, watchId: null });
let state = emptyState();
let owner = null;
let epoch = 0;
let writes = Promise.resolve();
let observations = Promise.resolve();
let reservation = null;

function validArm(message) {
  return typeof message.chat === "string" && Boolean(message.chat.trim())
    && (message.key === null || typeof message.key === "string")
    && (message.read === null || typeof message.read === "boolean");
}

function validState(value, lease) {
  return value && value.armed === true && typeof value.chat === "string" && value.chat.trim()
    && typeof value.watchId === "string" && value.watchId && lease
    && lease.watchId === value.watchId && Number.isInteger(lease.tabId)
    && typeof lease.documentId === "string" && lease.documentId;
}

function validSender(sender) {
  try {
    return sender.id === chrome.runtime.id && Number.isInteger(sender.tab?.id)
      && sender.frameId === 0 && sender.documentLifecycle === "active"
      && typeof sender.documentId === "string" && sender.documentId
      && new URL(sender.url).origin === "https://web.whatsapp.com";
  } catch {
    return false;
  }
}

function isOwner(sender) {
  return state.armed && owner?.watchId === state.watchId
    && owner.tabId === sender.tab.id && owner.documentId === sender.documentId;
}

function response(sender, extra = {}) {
  return { ok: true, state: { ...state }, canObserve: Boolean(isOwner(sender)), ...extra };
}

function persist(snapshot, lease, version) {
  const task = writes.then(async () => {
    if (version !== epoch) return false;
    // Finish both writes, even on failure, before a later control tombstone.
    const results = await Promise.allSettled([
      chrome.storage.local.set({ [STATE_KEY]: snapshot }),
      chrome.storage.session.set({ [OWNER_KEY]: lease })
    ]);
    if (results.some((result) => result.status === "rejected")) throw new Error("storage-failed");
    return version === epoch;
  });
  writes = task.catch(() => {});
  return task;
}

const ready = (async () => {
  const [stored, session] = await Promise.all([
    chrome.storage.local.get(STATE_KEY), chrome.storage.session.get(OWNER_KEY)
  ]);
  if (epoch !== 0) return;
  const value = stored?.[STATE_KEY];
  const lease = session?.[OWNER_KEY];
  // Legacy state and a new browser session have no surviving producer lease.
  if (validState(value, lease)) {
    state = { armed: true, chat: value.chat, watchId: value.watchId,
      messageKey: typeof value.messageKey === "string" ? value.messageKey : null,
      lastRead: typeof value.lastRead === "boolean" ? value.lastRead : null,
      notifiedKey: typeof value.notifiedKey === "string" ? value.notifiedKey : null };
    owner = { watchId: lease.watchId, tabId: lease.tabId, documentId: lease.documentId };
  } else {
    await persist(emptyState(), null, 0);
  }
})();
void ready.catch(() => {});

async function getState(message, sender, ticket) {
  if (typeof message.instanceId !== "string" || !message.instanceId) {
    return { ok: false, error: "invalid-state-request" };
  }
  await ready;
  if (state.armed && owner?.tabId === sender.tab.id && owner.documentId !== sender.documentId) {
    const version = epoch;
    // The browser routes this challenge to its current top frame.
    const current = await chrome.tabs.sendMessage(sender.tab.id, { type: PREFIX + "document" }, { frameId: 0 });
    if (version !== epoch || !current || current.instanceId !== message.instanceId) return response(sender);
    if (reservation && !reservation.dispatched && reservation.watchId === state.watchId
        && reservation.key === state.messageKey && state.notifiedKey === reservation.key) {
      state = { ...state, lastRead: false, notifiedKey: null };
      reservation = null;
    }
    ticket.version = ++epoch;
    owner = { ...owner, documentId: sender.documentId };
    await persist({ ...state }, { ...owner }, ticket.version);
  }
  return response(sender);
}

async function control(message, sender, version) {
  await ready;
  if (version !== epoch) return response(sender, { ignored: true });
  if (message.type === PREFIX + "arm") {
    if (!validArm(message)) {
      return response(sender, { ok: false, error: "invalid-arm" });
    }
    state = { armed: true, chat: message.chat, messageKey: message.key,
      lastRead: message.read, notifiedKey: null, watchId: crypto.randomUUID() };
    owner = { watchId: state.watchId, tabId: sender.tab.id, documentId: sender.documentId };
  } else {
    state = emptyState();
    owner = null;
  }
  reservation = null;
  await persist({ ...state }, owner ? { ...owner } : null, version);
  return response(sender);
}

function notify(snapshot) {
  return new Promise((resolve, reject) => {
    const id = `whatsapp-watcher-${snapshot.watchId}-${WhatsAppReadPolicy.fnv1a(snapshot.messageKey)}`;
    chrome.notifications.create(id, { type: "basic", iconUrl: "icon128.png",
      title: "WhatsApp — messaggio letto",
      message: `Il tuo ultimo messaggio in “${snapshot.chat}” è stato letto.`, priority: 1 }, () => {
      if (chrome.runtime.lastError) reject(new Error("notification-failed"));
      else resolve();
    });
  });
}

async function observe(message, sender, version) {
  await ready;
  if (version !== epoch || !isOwner(sender) || message.watchId !== state.watchId
      || message.chat !== state.chat) return response(sender, { ignored: true });
  const observation = message.observation;
  if (!observation || !["chat", "sidebar"].includes(observation.source)
      || typeof observation.key !== "string" || !observation.key
      || typeof observation.read !== "boolean") return response(sender, { ignored: true });
  if (observation.source === "sidebar" && observation.key !== state.messageKey) return response(sender, { ignored: true });

  const snapshot = { ...state };
  let shouldNotify = false;
  if (observation.source === "chat" && observation.key !== snapshot.messageKey) {
    shouldNotify = Boolean(snapshot.messageKey) && observation.read;
    snapshot.messageKey = observation.key;
    snapshot.lastRead = observation.read;
    snapshot.notifiedKey = null;
  } else if (snapshot.lastRead === false && observation.read && snapshot.notifiedKey !== snapshot.messageKey) {
    shouldNotify = true;
  } else {
    snapshot.lastRead = observation.read;
  }
  if (shouldNotify) {
    snapshot.lastRead = true;
    snapshot.notifiedKey = snapshot.messageKey;
  }
  const claim = shouldNotify ? { watchId: snapshot.watchId, key: snapshot.messageKey, dispatched: false } : null;
  if (claim) reservation = claim;
  state = snapshot;
  // Reserve before delivery; concurrent observers cannot issue the same notice.
  if (!await persist({ ...snapshot }, { ...owner }, version)) {
    if (reservation === claim) reservation = null;
    return response(sender, { ignored: true });
  }
  if (shouldNotify) {
    if (version !== epoch || !isOwner(sender)) return response(sender, { ignored: true });
    try {
      claim.dispatched = true;
      await notify(snapshot);
    } catch {
      // A reload may change document/epoch while keeping this exact watch/key.
      if (reservation === claim && state.watchId === snapshot.watchId
          && state.messageKey === snapshot.messageKey && state.notifiedKey === snapshot.messageKey) {
        state = { ...state, lastRead: false, notifiedKey: null };
        await persist({ ...state }, { ...owner }, epoch);
      }
      if (version !== epoch) return response(sender, { ignored: true });
      return response(sender, { ok: false, error: "notification-failed" });
    } finally {
      if (reservation === claim) reservation = null;
    }
  }
  return response(sender, { ignored: version !== epoch });
}

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (!message || !["state", "arm", "stop", "observe"].some((name) => message.type === PREFIX + name)) return false;
  if (!validSender(sender)) {
    sendResponse({ ok: false, error: "unsupported-sender" });
    return false;
  }
  if (message.type === PREFIX + "arm" && !validArm(message)) {
    sendResponse({ ok: false, error: "invalid-arm" });
    return false;
  }
  const ticket = { version: epoch };
  let task;
  if (message.type === PREFIX + "arm" || message.type === PREFIX + "stop") {
    // Controls invalidate pending work without waiting for a notification.
    ticket.version = ++epoch;
    task = control(message, sender, ticket.version);
  } else if (message.type === PREFIX + "state") {
    task = getState(message, sender, ticket);
  } else {
    task = observations.then(() => observe(message, sender, ticket.version));
    observations = task.catch(() => {});
  }
  task.then(sendResponse, async () => {
    if (ticket.version !== epoch) {
      sendResponse(response(sender, { ignored: true }));
      return;
    }
    const version = ++epoch;
    state = emptyState();
    owner = null;
    reservation = null;
    try { await persist(emptyState(), null, version); } catch { /* Never report a failed write as success. */ }
    sendResponse({ ok: false, error: "state-unavailable" });
  });
  return true;
});
