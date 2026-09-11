"use strict";

(() => {
  const STORAGE_KEY = "whatsappWatcherState";
  const PANEL_ID = "whatsapp-watcher-panel";
  const READ_ICON_RE = /^(?:msg|status)-dblcheck-ack(?:-light)?$/i;
  const OUTGOING_STATUS_RE = /^(?:msg|status)-(?:clock|check|dblcheck|dblcheck-ack|dblcheck-ack-light)$/i;
  const READ_LABEL_RE = /\b(?:read|letto|letta|letti|lette|lu|lue|lus|lues|le[ií]do|le[ií]da|gelesen)\b/i;

  const DEFAULT_STATE = Object.freeze({
    armed: false,
    chat: null,
    messageKey: null,
    lastRead: null,
    notifiedKey: null
  });

  let state = { ...DEFAULT_STATE };
  let panel = null;
  let scanTimer = null;
  let lastStatusText = "";

  function normalizeLabel(value) {
    return String(value || "")
      .normalize("NFKC")
      .replace(/\s+/g, " ")
      .trim();
  }

  function sameLabel(a, b) {
    return normalizeLabel(a).toLocaleLowerCase() === normalizeLabel(b).toLocaleLowerCase();
  }

  function fnv1a(text) {
    let hash = 0x811c9dc5;
    for (let i = 0; i < text.length; i += 1) {
      hash ^= text.charCodeAt(i);
      hash = Math.imul(hash, 0x01000193);
    }
    return (hash >>> 0).toString(16).padStart(8, "0");
  }

  async function loadState() {
    try {
      const stored = await chrome.storage.local.get(STORAGE_KEY);
      const value = stored && stored[STORAGE_KEY];
      if (value && typeof value === "object") {
        state = { ...DEFAULT_STATE, ...value };
      }
    } catch (error) {
      console.warn("[whatsapp-watcher] could not load state", error);
    }
  }

  async function saveState() {
    try {
      await chrome.storage.local.set({ [STORAGE_KEY]: state });
    } catch (error) {
      console.warn("[whatsapp-watcher] could not save state", error);
    }
  }

  function currentChatTitle() {
    const main = document.querySelector("#main");
    const header = main && main.querySelector("header");
    if (!header) {
      return null;
    }

    const explicit = header.querySelector(
      '[data-testid="conversation-info-header-chat-title"], [data-testid="conversation-header-title"]'
    );
    const explicitText = normalizeLabel(explicit?.getAttribute("title") || explicit?.textContent);
    if (explicitText) {
      return explicitText;
    }

    const titled = Array.from(header.querySelectorAll("[title]"))
      .map((element) => normalizeLabel(element.getAttribute("title")))
      .filter(Boolean);

    return titled[0] || null;
  }

  function latestOutgoingMessage() {
    const main = document.querySelector("#main");
    if (!main) {
      return null;
    }

    const messageOut = Array.from(main.querySelectorAll(".message-out"));
    if (messageOut.length) {
      return messageOut[messageOut.length - 1];
    }

    const sentById = Array.from(main.querySelectorAll('[data-id*="true_"]'));
    if (sentById.length) {
      return sentById[sentById.length - 1].closest("[data-id]") || sentById[sentById.length - 1];
    }

    return null;
  }

  function messageKey(message) {
    const dataIdNode = message.matches?.("[data-id]")
      ? message
      : message.querySelector?.("[data-id]");
    const dataId = normalizeLabel(dataIdNode?.getAttribute("data-id"));
    if (dataId) {
      return `id:${dataId}`;
    }

    const plainNode = message.querySelector?.("[data-pre-plain-text]");
    const plain = normalizeLabel(plainNode?.getAttribute("data-pre-plain-text"));
    const text = normalizeLabel(message.innerText || message.textContent);
    return `hash:${fnv1a(`${plain}\n${text}`)}`;
  }

  function iconNames(root) {
    return Array.from(root.querySelectorAll?.("[data-icon]") || [])
      .map((element) => normalizeLabel(element.getAttribute("data-icon")))
      .filter(Boolean);
  }

  function hasOutgoingStatusIcon(root) {
    return iconNames(root).some((name) => OUTGOING_STATUS_RE.test(name));
  }

  function explicitReadMarker(root) {
    if (iconNames(root).some((name) => READ_ICON_RE.test(name))) {
      return true;
    }

    const labelled = Array.from(root.querySelectorAll?.("[aria-label]") || []);
    return labelled.some((element) => READ_LABEL_RE.test(normalizeLabel(element.getAttribute("aria-label"))));
  }

  function parseRgb(value) {
    const match = String(value || "").match(/rgba?\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)/i);
    if (!match) {
      return null;
    }
    return [Number(match[1]), Number(match[2]), Number(match[3])];
  }

  function isWhatsAppReadBlue(value) {
    const rgb = parseRgb(value);
    if (!rgb) {
      return false;
    }
    const [red, green, blue] = rgb;
    return red < 145 && green > 135 && blue > 175 && blue > green && green > red + 25;
  }

  function blueDoubleCheckFallback(root) {
    const candidates = Array.from(root.querySelectorAll?.('[data-icon*="dblcheck"]') || []);
    for (const candidate of candidates) {
      const nodes = [candidate, candidate.querySelector("svg"), candidate.querySelector("path")].filter(Boolean);
      for (const node of nodes) {
        const style = getComputedStyle(node);
        if (isWhatsAppReadBlue(style.color) || isWhatsAppReadBlue(style.fill) || isWhatsAppReadBlue(style.stroke)) {
          return true;
        }
      }
    }
    return false;
  }

  function isRead(root) {
    return explicitReadMarker(root) || blueDoubleCheckFallback(root);
  }

  function findSidebarRow(chat) {
    const pane = document.querySelector("#pane-side");
    if (!pane) {
      return null;
    }

    const titleNode = Array.from(pane.querySelectorAll("[title]")).find((element) =>
      sameLabel(element.getAttribute("title"), chat)
    );
    if (!titleNode) {
      return null;
    }

    const semanticRow = titleNode.closest('[role="row"], [data-testid="cell-frame-container"]');
    if (semanticRow) {
      return semanticRow;
    }

    let node = titleNode.parentElement;
    for (let depth = 0; node && node !== pane && depth < 9; depth += 1, node = node.parentElement) {
      if (hasOutgoingStatusIcon(node)) {
        return node;
      }
    }
    return null;
  }

  function mainObservation() {
    if (!state.armed || !state.chat || !sameLabel(currentChatTitle(), state.chat)) {
      return null;
    }
    const message = latestOutgoingMessage();
    if (!message) {
      return null;
    }
    return {
      source: "chat",
      key: messageKey(message),
      read: isRead(message)
    };
  }

  function sidebarObservation() {
    if (!state.armed || !state.chat) {
      return null;
    }
    const row = findSidebarRow(state.chat);
    if (!row || !hasOutgoingStatusIcon(row)) {
      return null;
    }
    return {
      source: "sidebar",
      key: state.messageKey,
      read: isRead(row)
    };
  }

  async function sendReadNotification() {
    if (!state.chat || !state.messageKey || state.notifiedKey === state.messageKey) {
      return false;
    }

    try {
      const response = await chrome.runtime.sendMessage({
        type: "whatsapp-watcher-read",
        chat: state.chat,
        messageKey: state.messageKey
      });
      if (response && response.ok === false) {
        setStatus(`Errore notifica: ${response.error || "sconosciuto"}`);
        return false;
      }
      state.notifiedKey = state.messageKey;
      state.lastRead = true;
      await saveState();
      setStatus(`Letto: ${state.chat}`);
      return true;
    } catch (error) {
      console.warn("[whatsapp-watcher] notification failed", error);
      setStatus("Errore nell'invio della notifica desktop");
      return false;
    }
  }

  async function handleObservation(observation) {
    if (!observation) {
      setStatus(state.armed ? `In attesa: ${state.chat}` : "Disattivato");
      return;
    }

    if (observation.source === "chat" && observation.key && observation.key !== state.messageKey) {
      const hadPreviousMessage = Boolean(state.messageKey);
      state.messageKey = observation.key;
      state.lastRead = observation.read;
      state.notifiedKey = null;
      await saveState();

      if (hadPreviousMessage && observation.read) {
        await sendReadNotification();
        return;
      }

      setStatus(observation.read ? `Ultimo messaggio già letto: ${state.chat}` : `Monitoraggio attivo: ${state.chat}`);
      return;
    }

    if (!state.messageKey && observation.key) {
      state.messageKey = observation.key;
      state.lastRead = observation.read;
      state.notifiedKey = null;
      await saveState();
      setStatus(observation.read ? `Ultimo messaggio già letto: ${state.chat}` : `Monitoraggio attivo: ${state.chat}`);
      return;
    }

    if (state.lastRead === false && observation.read === true && state.notifiedKey !== state.messageKey) {
      await sendReadNotification();
      return;
    }

    if (state.lastRead !== observation.read) {
      state.lastRead = observation.read;
      await saveState();
    }

    setStatus(observation.read ? `Letto: ${state.chat}` : `Monitoraggio attivo: ${state.chat}`);
  }

  async function scan() {
    if (!state.armed) {
      setStatus("Disattivato");
      return;
    }

    const observation = mainObservation() || sidebarObservation();
    await handleObservation(observation);
  }

  function scheduleScan(delay = 120) {
    if (scanTimer !== null) {
      clearTimeout(scanTimer);
    }
    scanTimer = window.setTimeout(() => {
      scanTimer = null;
      void scan();
    }, delay);
  }

  function setStatus(text) {
    lastStatusText = text;
    if (!panel) {
      return;
    }
    const status = panel.shadowRoot?.querySelector("#status");
    const target = panel.shadowRoot?.querySelector("#target");
    if (status) {
      status.textContent = text;
    }
    if (target) {
      target.textContent = state.chat ? `Chat: ${state.chat}` : "Nessuna chat selezionata";
    }
  }

  async function watchCurrentChat() {
    const chat = currentChatTitle();
    if (!chat) {
      setStatus("Apri prima la chat da monitorare");
      return;
    }

    const message = latestOutgoingMessage();
    state = {
      armed: true,
      chat,
      messageKey: message ? messageKey(message) : null,
      lastRead: message ? isRead(message) : null,
      notifiedKey: null
    };
    await saveState();
    setStatus(
      message
        ? state.lastRead
          ? `Ultimo messaggio già letto: ${chat}`
          : `Monitoraggio attivo: ${chat}`
        : `In attesa di un tuo messaggio: ${chat}`
    );
    scheduleScan(0);
  }

  async function stopWatching() {
    state = { ...DEFAULT_STATE };
    await saveState();
    setStatus("Disattivato");
  }

  function ensurePanel() {
    if (document.getElementById(PANEL_ID)) {
      panel = document.getElementById(PANEL_ID);
      return;
    }

    panel = document.createElement("div");
    panel.id = PANEL_ID;
    panel.style.position = "fixed";
    panel.style.right = "14px";
    panel.style.bottom = "14px";
    panel.style.zIndex = "2147483647";

    const shadow = panel.attachShadow({ mode: "open" });
    shadow.innerHTML = `
      <style>
        :host { all: initial; }
        .box {
          width: 260px;
          box-sizing: border-box;
          border: 1px solid rgba(255,255,255,.16);
          border-radius: 10px;
          background: #202c33;
          color: #e9edef;
          box-shadow: 0 8px 24px rgba(0,0,0,.28);
          font: 13px/1.35 system-ui, sans-serif;
          overflow: hidden;
        }
        .head {
          display: flex;
          align-items: center;
          justify-content: space-between;
          padding: 8px 10px;
          font-weight: 700;
        }
        .body { padding: 0 10px 10px; }
        #target { opacity: .82; margin-bottom: 5px; overflow-wrap: anywhere; }
        #status { min-height: 35px; margin-bottom: 8px; overflow-wrap: anywhere; }
        .buttons { display: flex; gap: 6px; }
        button {
          border: 0;
          border-radius: 7px;
          padding: 7px 9px;
          cursor: pointer;
          font: inherit;
        }
        #watch { flex: 1; background: #00a884; color: #071a15; font-weight: 700; }
        #stop { background: #374248; color: #e9edef; }
        #collapse { background: transparent; color: #e9edef; padding: 1px 6px; font-size: 18px; }
        .collapsed .body { display: none; }
      </style>
      <div class="box">
        <div class="head">
          <span>WA Watcher</span>
          <button id="collapse" type="button" title="Riduci">–</button>
        </div>
        <div class="body">
          <div id="target"></div>
          <div id="status"></div>
          <div class="buttons">
            <button id="watch" type="button">Watch current chat</button>
            <button id="stop" type="button">Stop</button>
          </div>
        </div>
      </div>
    `;

    shadow.querySelector("#watch")?.addEventListener("click", () => void watchCurrentChat());
    shadow.querySelector("#stop")?.addEventListener("click", () => void stopWatching());
    shadow.querySelector("#collapse")?.addEventListener("click", () => {
      const box = shadow.querySelector(".box");
      box?.classList.toggle("collapsed");
      const collapsed = box?.classList.contains("collapsed");
      const button = shadow.querySelector("#collapse");
      if (button) {
        button.textContent = collapsed ? "+" : "–";
        button.setAttribute("title", collapsed ? "Espandi" : "Riduci");
      }
    });

    document.body.appendChild(panel);
    setStatus(lastStatusText || (state.armed ? `In attesa: ${state.chat}` : "Disattivato"));
  }

  async function init() {
    await loadState();
    ensurePanel();

    const observer = new MutationObserver(() => scheduleScan());
    observer.observe(document.body, {
      childList: true,
      subtree: true,
      attributes: true,
      attributeFilter: ["data-icon", "aria-label", "class", "style"]
    });

    document.addEventListener("visibilitychange", () => scheduleScan(0));
    window.addEventListener("focus", () => scheduleScan(0));
    window.setInterval(() => scheduleScan(0), 2000);
    scheduleScan(0);
  }

  void init();
})();
