'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const policy = require('../read-policy.js');

test('only acknowledged double-check markers prove read, not delivery', () => {
  for (const name of ['msg-dblcheck-ack', 'status-dblcheck-ack-light', 'MSG-DBLCHECK-ACK']) {
    assert.equal(policy.isReadIcon(name), true);
    assert.equal(policy.isReadIcon(name), true);
    assert.equal(policy.isOutgoingStatusIcon(name), true);
  }
  for (const name of ['msg-clock', 'msg-check', 'msg-dblcheck', 'status-dblcheck']) {
    assert.equal(policy.isReadIcon(name), false);
    assert.equal(policy.isOutgoingStatusIcon(name), true);
  }
  assert.equal(policy.isReadIcon('prefix-msg-dblcheck-ack'), false);
});

test('localized whole-word read labels retain their prior recognition', () => {
  for (const label of ['Read', 'Messaggio letto', 'gelesen', 'leído', 'Lue']) {
    assert.equal(policy.isReadLabel(label), true);
  }
  for (const label of ['Unread', 'Delivered', 'thread', '']) {
    assert.equal(policy.isReadLabel(label), false);
  }
});

test('blue fallback rejects grey, green, red and malformed styles', () => {
  assert.equal(policy.isWhatsAppReadBlue('rgb(53, 186, 246)'), true);
  assert.equal(policy.isWhatsAppReadBlue('rgba(53, 186, 246, 1)'), true);
  for (const color of ['rgb(150,150,150)', 'rgb(0,200,100)', 'rgb(255,0,0)', 'inherit', null]) {
    assert.equal(policy.isWhatsAppReadBlue(color), false);
  }
});

test('label normalization and message fingerprints remain compatible', () => {
  assert.equal(policy.normalizeLabel('  Ａlice\n Example  '), 'Alice Example');
  assert.equal(policy.sameLabel(' Ａlice ', 'alice'), true);
  assert.equal(policy.sameLabel('Alice', 'Bob'), false);
  assert.equal(policy.fnv1a('hello'), '4f9f2cab');
});

test('policy loads in the browser realm without touching DOM or Chrome', () => {
  const context = {};
  for (const name of ['document', 'chrome', 'window', 'fetch']) {
    Object.defineProperty(context, name, { get() { throw new Error('runtime access forbidden'); } });
  }
  vm.runInNewContext(fs.readFileSync(path.join(__dirname, '../read-policy.js'), 'utf8'), context);
  assert.equal(context.WhatsAppReadPolicy.isReadIcon('msg-dblcheck-ack'), true);
  assert.equal(Object.isFrozen(context.WhatsAppReadPolicy), true);
});

test('packaged policy loads before DOM adapter with the same narrow permissions', () => {
  const manifest = JSON.parse(fs.readFileSync(path.join(__dirname, '../manifest.json'), 'utf8'));
  assert.deepEqual(manifest.content_scripts[0].js, ['read-policy.js', 'content.js']);
  assert.deepEqual(manifest.permissions, ['notifications', 'storage']);
  assert.deepEqual(manifest.host_permissions, ['https://web.whatsapp.com/*']);
  for (const script of manifest.content_scripts[0].js) {
    assert.equal(fs.statSync(path.join(__dirname, '..', script)).isFile(), true);
  }
});
