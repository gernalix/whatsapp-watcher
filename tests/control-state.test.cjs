'use strict';
// Fabricated documents and Chrome APIs only: no browser, profile or notification.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const root = path.join(__dirname, '..');
const source = name => fs.readFileSync(path.join(root, name), 'utf8');
const STATE = 'whatsappWatcherStateV2', OWNER = 'whatsappWatcherOwnerV2';
const PREFIX = 'whatsapp-watcher-v2-';
const clone = value => value === undefined ? undefined : structuredClone(value);
const flush = async () => { for (let i = 0; i < 6; i++) await new Promise(setImmediate); };

class Browser {
  constructor() {
    this.local = {}; this.session = {}; this.listeners = []; this.docs = new Map();
    this.notices = []; this.callbacks = []; this.holdNotifications = false;
    this.holdWrites = false; this.pendingWrites = []; this.failWrites = 0; this.serial = 0;
    this.startWorker();
  }
  storage(area) {
    return {
      get: async key => ({ [key]: clone(this[area][key]) }),
      set: values => new Promise((resolve, reject) => {
        const apply = () => {
          if (this.failWrites > 0) { this.failWrites--; reject(new Error('synthetic storage failure')); return; }
          const changes = {};
          for (const [key, value] of Object.entries(values)) {
            if (JSON.stringify(this[area][key]) !== JSON.stringify(value)) {
              changes[key] = { oldValue: clone(this[area][key]), newValue: clone(value) };
            }
            this[area][key] = clone(value);
          }
          if (Object.keys(changes).length) queueMicrotask(() => this.listeners.forEach(fn => fn(clone(changes), area)));
          resolve();
        };
        if (this.holdWrites) this.pendingWrites.push(apply); else apply();
      })
    };
  }
  startWorker() {
    const runtime = { id: 'synthetic-extension', onMessage: { addListener: fn => { this.receive = fn; } } };
    this.runtime = runtime;
    const chrome = { runtime, storage: { local: this.storage('local'), session: this.storage('session') },
      tabs: { sendMessage: async (tabId, message) => {
        const tab = this.docs.get(tabId);
        if (!tab?.receive) throw new Error('synthetic document absent');
        let response;
        tab.receive(clone(message), { id: runtime.id }, value => { response = clone(value); });
        return response;
      } },
      notifications: { create: (id, options, callback) => {
        this.notices.push({ id, options: clone(options) });
        const complete = error => {
          if (error) runtime.lastError = { message: 'synthetic delivery failure' };
          callback(); delete runtime.lastError;
        };
        if (this.holdNotifications) this.callbacks.push(complete); else complete(false);
      } }
    };
    const context = vm.createContext({ chrome, URL, crypto: { randomUUID: () => `synthetic-${++this.serial}` },
      importScripts: name => { assert.equal(name, 'read-policy.js'); vm.runInContext(source(name), context); } });
    vm.runInContext(source('background.js'), context);
  }
  request(message, sender) {
    return new Promise(resolve => {
      let responded = false;
      const keep = this.receive(clone(message), clone(sender), value => { responded = true; resolve(clone(value)); });
      if (!keep && !responded) resolve(undefined);
    });
  }
  sender(tabId, documentId) {
    return { id: this.runtime.id, tab: { id: tabId }, frameId: 0, documentId,
      documentLifecycle: 'active', url: 'https://web.whatsapp.com/' };
  }
  tab(tabId, documentId = `document-${++this.serial}`) {
    const browser = this, timers = new Map(), intervals = [], controls = new Map();
    const dom = { chat: 'SYNTHETIC_A', id: 'synthetic-message', read: false };
    let timerId = 0, host;
    const element = () => ({ style: {}, textContent: '', listeners: {}, isConnected: false,
      addEventListener(type, fn) { this.listeners[type] = fn; }, setAttribute() {},
      classList: { toggle() {}, contains() { return false; } } });
    const shadow = { innerHTML: '', querySelector(selector) {
      if (!controls.has(selector)) controls.set(selector, element()); return controls.get(selector);
    } };
    const title = { getAttribute: () => dom.chat, get textContent() { return dom.chat; } };
    const icon = { getAttribute: () => dom.read ? 'msg-dblcheck-ack' : 'msg-dblcheck', querySelector: () => null };
    const message = { matches: () => true, getAttribute: () => dom.id, innerText: 'PUBLIC_SYNTHETIC_TEXT',
      querySelector: () => null, querySelectorAll: selector => selector === '[data-icon]' ? [icon] : [] };
    const main = { querySelector: () => ({ querySelector: () => title, querySelectorAll: () => [title] }),
      querySelectorAll: selector => selector === '.message-out' ? [message] : [] };
    const decoy = element();
    const document = { querySelector: selector => selector === '#main' ? main : null,
      getElementById: () => decoy, addEventListener() {},
      createElement() { const node = element(); node.attachShadow = options => {
        node.shadowRoot = options.mode === 'open' ? shadow : null; return shadow;
      }; return node; }, body: { appendChild(node) { host = node; node.isConnected = true; } } };
    const tab = { dom, sender: this.sender(tabId, documentId),
      get host() { return host; }, get target() { return controls.get('#target')?.textContent; },
      async click(name, trusted = true) { controls.get('#' + name).listeners.click({ isTrusted: trusted }); await flush(); },
      async scan() { intervals[0](); const entry = timers.entries().next().value;
        if (entry) { timers.delete(entry[0]); entry[1](); } await flush(); } };
    this.docs.set(tabId, tab);
    const chrome = { storage: { onChanged: { addListener: fn => this.listeners.push(fn) } },
      runtime: { id: this.runtime.id, onMessage: { addListener: fn => { tab.receive = fn; } },
        sendMessage: message => browser.request(message, tab.sender) } };
    const context = vm.createContext({ document, chrome, crypto: { randomUUID: () => `instance-${++this.serial}` },
      window: { setTimeout(fn) { const id = ++timerId; timers.set(id, fn); return id; },
        setInterval: fn => intervals.push(fn), addEventListener() {} },
      clearTimeout: id => timers.delete(id), MutationObserver: class { observe() {} },
      getComputedStyle: () => ({ color: 'inherit', fill: 'inherit', stroke: 'inherit' }) });
    vm.runInContext(source('read-policy.js'), context); vm.runInContext(source('content.js'), context);
    return tab;
  }
  releaseWrites() {
    this.holdWrites = false; for (const apply of this.pendingWrites.splice(0)) apply();
  }
}

test('only trusted controls arm; page-owned panel IDs are not adopted and shadow is closed', async () => {
  const b = new Browser(), a = b.tab(1); await flush();
  assert.equal(a.host.shadowRoot, null);
  await a.click('watch', false); assert.equal(b.local[STATE].armed, false);
  await a.click('watch'); assert.equal(b.local[STATE].armed, true);
  assert.equal(b.session[OWNER].tabId, 1);
  await a.click('stop', false); assert.equal(b.local[STATE].armed, true);
});

test('global Stop rejects stale tabs and never resurrects armed state', async () => {
  const b = new Browser(), a = b.tab(1), other = b.tab(2); await flush();
  await a.click('watch');
  const captured = clone(b.local[STATE]);
  await other.click('stop');
  a.dom.read = true; await a.scan();
  const result = await b.request({ type: PREFIX + 'observe', watchId: captured.watchId,
    chat: captured.chat, observation: { source: 'chat', key: captured.messageKey, read: true } }, a.sender);
  assert.equal(result.ignored, true); assert.equal(b.notices.length, 0);
  assert.equal(b.local[STATE].armed, false); assert.equal(b.session[OWNER], null);
});

test('overlapping scans produce one notice and keep message content out of its payload', async () => {
  const b = new Browser(), a = b.tab(1); await flush(); await a.click('watch');
  b.holdNotifications = true; a.dom.read = true; await a.scan(); await a.scan();
  assert.equal(b.notices.length, 1);
  b.callbacks.shift()(false); await flush(); await a.scan();
  assert.equal(b.notices.length, 1);
  assert.equal(JSON.stringify(b.notices).includes('PUBLIC_SYNTHETIC_TEXT'), false);
  assert.equal(b.local[STATE].notifiedKey, 'id:synthetic-message');
});

test('Stop completes while a delivered notification callback remains pending', async () => {
  const b = new Browser(), a = b.tab(1); await flush(); await a.click('watch');
  b.holdNotifications = true; a.dom.read = true; await a.scan();
  assert.equal(b.callbacks.length, 1); await a.click('stop');
  assert.equal(b.local[STATE].armed, false);
  b.callbacks.shift()(false); await flush();
  assert.equal(b.local[STATE].armed, false); assert.equal(b.notices.length, 1);
});

test('old delivery completion cannot mark a newly armed target read or notified', async () => {
  const b = new Browser(), a = b.tab(1); await flush(); await a.click('watch');
  b.holdNotifications = true; a.dom.read = true; await a.scan();
  a.dom.chat = 'SYNTHETIC_B'; a.dom.id = 'new-message'; a.dom.read = false; await a.click('watch');
  const target = clone(b.local[STATE]); b.callbacks.shift()(false); await flush();
  assert.deepEqual(b.local[STATE], target); assert.equal(target.lastRead, false); assert.equal(target.notifiedKey, null);
  a.dom.read = true; await a.scan(); assert.equal(b.notices.length, 2);
  b.callbacks.shift()(false); await flush();
});

test('only the producer can advance a message, preventing older-tab rollback', async () => {
  const b = new Browser(), a = b.tab(1), other = b.tab(2); await flush(); await a.click('watch');
  a.dom.id = 'new-message'; await a.scan(); const current = clone(b.local[STATE]);
  const result = await b.request({ type: PREFIX + 'observe', watchId: current.watchId,
    chat: current.chat, observation: { source: 'chat', key: 'id:old-message', read: true } }, other.sender);
  assert.equal(result.ignored, true); assert.deepEqual(b.local[STATE], current); assert.equal(b.notices.length, 0);
});

test('reload transfers the lease only to the browser current document and preserves dedup', async () => {
  const b = new Browser(), old = b.tab(1); await flush(); await old.click('watch');
  old.dom.read = true; await old.scan(); const stored = clone(b.local[STATE]);
  const fresh = b.tab(1, 'new-document'); await flush();
  assert.equal(b.session[OWNER].documentId, 'new-document'); assert.deepEqual(b.local[STATE], stored);
  const stale = await b.request({ type: PREFIX + 'state', instanceId: 'not-the-current-instance' }, old.sender);
  assert.equal(stale.canObserve, false); assert.equal(b.session[OWNER].documentId, 'new-document');
  fresh.dom.read = true; await fresh.scan(); assert.equal(b.notices.length, 1);
});

test('worker restart retains the same-session lease; browser restart and legacy state do not arm', async () => {
  const b = new Browser(), a = b.tab(1); await flush(); await a.click('watch'); const stored = clone(b.local[STATE]);
  b.startWorker(); await flush();
  const same = await b.request({ type: PREFIX + 'state', instanceId: 'unused-for-same-document' }, a.sender);
  assert.equal(same.canObserve, true); assert.deepEqual(b.local[STATE], stored);
  b.session = {}; b.startWorker(); await flush(); assert.equal(b.local[STATE].armed, false);
  const c = new Browser(); c.local.whatsappWatcherState = { armed: true, chat: 'SYNTHETIC_LEGACY' };
  await flush(); assert.equal(c.local[STATE].armed, false);
});

test('producer reload releases an undelivered reservation before transferring the lease', async () => {
  const b = new Browser(), old = b.tab(1); await flush(); await old.click('watch');
  b.holdWrites = true; old.dom.read = true; await old.scan();
  const fresh = b.tab(1, 'reloaded-before-delivery'); await flush();
  b.releaseWrites(); await flush(); fresh.dom.read = true; await fresh.scan();
  assert.equal(b.notices.length, 1);
  assert.equal(b.local[STATE].notifiedKey, 'id:synthetic-message');
});

test('failed delivery after a producer reload permits the new document to retry', async () => {
  const b = new Browser(), old = b.tab(1); await flush(); await old.click('watch');
  b.holdNotifications = true; old.dom.read = true; await old.scan();
  const fresh = b.tab(1, 'reloaded-during-delivery'); await flush();
  b.callbacks.shift()(true); await flush(); fresh.dom.read = true; await fresh.scan();
  assert.equal(b.notices.length, 2); b.callbacks.shift()(false); await flush();
});

test('sender provenance, active document and sidebar key are validated', async () => {
  const b = new Browser(), a = b.tab(1); await flush(); await a.click('watch'); const stored = clone(b.local[STATE]);
  for (const change of [{ id: 'other-extension' }, { url: 'https://example.invalid/' },
    { frameId: 1 }, { documentLifecycle: 'cached' }, { documentId: '' }, { tab: null }]) {
    const result = await b.request({ type: PREFIX + 'stop' }, { ...a.sender, ...change });
    assert.equal(result.ok, false); assert.deepEqual(b.local[STATE], stored);
  }
  const result = await b.request({ type: PREFIX + 'observe', watchId: stored.watchId, chat: stored.chat,
    observation: { source: 'sidebar', key: 'wrong-message', read: true } }, a.sender);
  assert.equal(result.ignored, true); assert.equal(b.notices.length, 0);
  const legacy = await b.request({ type: 'whatsapp-watcher-read', chat: stored.chat }, a.sender);
  assert.equal(legacy, undefined); assert.equal(b.notices.length, 0);
});

test('first already-read message is baseline, while a newer already-read message notifies', async () => {
  const b = new Browser(), a = b.tab(1); await flush(); a.dom.read = true; await a.click('watch'); await a.scan();
  assert.equal(b.notices.length, 0);
  a.dom.id = 'new-message'; await a.scan(); assert.equal(b.notices.length, 1);
});

test('notification error releases only its own reservation and permits a retry', async () => {
  const b = new Browser(), a = b.tab(1); await flush(); await a.click('watch');
  b.holdNotifications = true; a.dom.read = true; await a.scan(); b.callbacks.shift()(true); await flush();
  assert.equal(b.local[STATE].notifiedKey, null); await a.scan(); assert.equal(b.notices.length, 2);
  b.callbacks.shift()(false); await flush();
});

test('control invalidates an observation awaiting storage, before any notification dispatch', async () => {
  const b = new Browser(), a = b.tab(1); await flush(); await a.click('watch');
  b.holdWrites = true; a.dom.read = true; await a.scan();
  // Do not await the control's persistence until the older write is released.
  const stopped = a.click('stop'); await flush(); b.releaseWrites(); await stopped; await flush();
  assert.equal(b.local[STATE].armed, false); assert.equal(b.notices.length, 0);
});

test('failed persistence reports failure and leaves current runtime disarmed', async () => {
  const b = new Browser(), a = b.tab(1); await flush(); b.failWrites = 1; await a.click('watch');
  assert.equal(b.local[STATE].armed, false); assert.equal(b.session[OWNER], null); assert.equal(b.notices.length, 0);
});

test('malformed arm requests do not cancel a valid pending notification', async () => {
  const b = new Browser(), a = b.tab(1); await flush(); await a.click('watch');
  b.holdWrites = true; a.dom.read = true; await a.scan();
  const result = await b.request({ type: PREFIX + 'arm', chat: 0 }, a.sender);
  assert.equal(result.ok, false); b.releaseWrites(); await flush();
  assert.equal(b.notices.length, 1);
});
