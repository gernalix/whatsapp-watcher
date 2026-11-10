"use strict";

(() => {
  const STORAGE_KEY = "whatsappWatcherStateV2";
  const PREFIX = "whatsapp-watcher-v2-";
  const instanceId = crypto.randomUUID();
  const PANEL_ID = "whatsapp-watcher-panel";
  const { normalizeLabel, sameLabel, fnv1a, isWhatsAppReadBlue, isReadIcon, isOutgoingStatusIcon, isReadLabel } = globalThis.WhatsAppReadPolicy;


  const DEFAULT_STATE = Object.freeze({
    armed: false,
    chat: null,
    messageKey: null,
    lastRead: null,
    notifiedKey: null,
    watchId: null
  });

  let state = { ...DEFAULT_STATE };
  let panel = null;
  let panelRoot = null;
  let canObserve = false;
  let requestVersion = 0;
  let pendingControl = 0;
  let scanTimer = null;
  let lastStatusText = "";

  function applyResponse(result) {
    if (!result || result.ok !== true || !result.state) throw new Error("state-unavailable");
    state = { ...DEFAULT_STATE, ...result.state };
    canObserve = result.canObserve === true;
    setStatus(!state.armed ? "Disattivato"
      : !canObserve ? `Monitoraggio attivo in un'altra scheda: ${state.chat}`
      : state.lastRead ? `Letto: ${state.chat}` : `Monitoraggio attivo: ${state.chat}`);
  }

  async function refreshState() {
    if (pendingControl) return;
    const version = ++requestVersion;
    try {
      const result = await chrome.runtime.sendMessage({ type: PREFIX + "state", instanceId });
      if (version === requestVersion && !pendingControl) applyResponse(result);
    } catch {
      if (version === requestVersion) setStatus("Stato monitoraggio non disponibile");
    }
  }

  async function issueControl(name, values = {}) {
    const version = ++requestVersion;
    pendingControl = version;
    state = { ...DEFAULT_STATE };
    canObserve = false;
    setStatus(name === "stop" ? "Disattivato" : "Attivazione monitoraggio…");
    try {
      const result = await chrome.runtime.sendMessage({ type: PREFIX + name, ...values });
      if (version === requestVersion) applyResponse(result);
    } catch {
      if (version === requestVersion) setStatus("Impossibile salvare il controllo del monitoraggio");
    } finally {
      if (pendingControl === version) pendingControl = 0;
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
    return iconNames(root).some((name) => isOutgoingStatusIcon(name));
  }

  function explicitReadMarker(root) {
    if (iconNames(root).some((name) => isReadIcon(name))) {
      return true;
    }

    const labelled = Array.from(root.querySelectorAll?.("[aria-label]") || []);
    return labelled.some((element) => isReadLabel(normalizeLabel(element.getAttribute("aria-label"))));
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

  async function scan() {
    if (!state.armed) {
      setStatus("Disattivato");
      return;
    }
    if (!canObserve || pendingControl) return;
    const observation = mainObservation() || sidebarObservation();
    if (!observation) {
      setStatus(`In attesa: ${state.chat}`);
      return;
    }
    const version = ++requestVersion;
    try {
      const result = await chrome.runtime.sendMessage({
        type: PREFIX + "observe", watchId: state.watchId, chat: state.chat, observation
      });
      if (version === requestVersion && !pendingControl && !result?.ignored) applyResponse(result);
    } catch {
      if (version === requestVersion) setStatus("Errore nell'osservazione del monitoraggio");
    }
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
    const status = panelRoot?.querySelector("#status");
    const target = panelRoot?.querySelector("#target");
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
    await issueControl("arm", { chat, key: message ? messageKey(message) : null,
      read: message ? isRead(message) : null });
    if (state.armed && canObserve) scheduleScan(0);
  }

  async function stopWatching() {
    await issueControl("stop");
  }

  function ensurePanel() {
    if (panel && panelRoot) {
      if (!panel.isConnected) document.body.appendChild(panel);
      return;
    }

    panel = document.createElement("div");
    panel.id = PANEL_ID;
    panel.style.position = "fixed";
    panel.style.right = "14px";
    panel.style.bottom = "14px";
    panel.style.zIndex = "2147483647";

    const shadow = panel.attachShadow({ mode: "closed" });
    panelRoot = shadow;
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

    shadow.querySelector("#watch")?.addEventListener("click", (event) => {
      if (event.isTrusted === true) void watchCurrentChat();
    });
    shadow.querySelector("#stop")?.addEventListener("click", (event) => {
      if (event.isTrusted === true) void stopWatching();
    });
    shadow.querySelector("#collapse")?.addEventListener("click", (event) => {
      if (event.isTrusted !== true) return;
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
    await refreshState();
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

  chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    if (message?.type === PREFIX + "document" && sender.id === chrome.runtime.id) {
      sendResponse({ instanceId });
    }
    return false;
  });
  chrome.storage.onChanged.addListener((changes, area) => {
    if (area === "local" && changes[STORAGE_KEY]) void refreshState();
  });

  void init();
})();
