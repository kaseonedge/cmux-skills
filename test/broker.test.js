'use strict';

const os = require('os');
const fs = require('fs');
const path = require('path');

const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'cmux-hermes-broker-test-'));
process.env.XDG_STATE_HOME = path.join(TMP, 'state');

const { test } = require('node:test');
const assert = require('node:assert');

const broker = require('../src/voice/broker');

function resetBrokerState() {
  fs.rmSync(process.env.XDG_STATE_HOME, { recursive: true, force: true });
}

test('broker queues voice events by priority then age', () => {
  resetBrokerState();
  broker.enqueue({ id: 'low', type: 'voice', workspace: 'ws-a', text: 'low', priority: 10, createdAt: 1000, expiresAt: Date.now() + 60_000 });
  broker.enqueue({ id: 'high-newer', type: 'voice', workspace: 'ws-b', text: 'high newer', priority: 100, createdAt: 3000, expiresAt: Date.now() + 60_000 });
  broker.enqueue({ id: 'high-older', type: 'voice', workspace: 'ws-c', text: 'high older', priority: 100, createdAt: 2000, expiresAt: Date.now() + 60_000 });

  assert.strictEqual(broker.popNext().id, 'high-older');
  assert.strictEqual(broker.popNext().id, 'high-newer');
  assert.strictEqual(broker.popNext().id, 'low');
  assert.strictEqual(broker.popNext(), null);
});

test('broker drops expired events before selecting next work', () => {
  resetBrokerState();
  broker.enqueue({ id: 'expired', type: 'voice', workspace: 'ws-a', text: 'old', priority: 100, createdAt: 1000, expiresAt: Date.now() - 1 });
  broker.enqueue({ id: 'fresh', type: 'voice', workspace: 'ws-b', text: 'new', priority: 1, createdAt: 2000, expiresAt: Date.now() + 60_000 });

  assert.strictEqual(broker.popNext().id, 'fresh');
  assert.strictEqual(broker.status().queued, 0);
});

test('broker coalesces duplicate pending voice events by dedupe key', () => {
  resetBrokerState();
  broker.enqueue({ id: 'first', type: 'voice', workspace: 'ws-a', text: 'first', priority: 50, dedupeKey: 'same', createdAt: 1000, expiresAt: Date.now() + 60_000 });
  broker.enqueue({ id: 'second', type: 'voice', workspace: 'ws-a', text: 'second', priority: 50, dedupeKey: 'same', createdAt: 2000, expiresAt: Date.now() + 60_000 });

  const snapshot = broker.status();
  assert.strictEqual(snapshot.queued, 1);
  const next = broker.popNext();
  assert.strictEqual(next.id, 'second');
  assert.strictEqual(next.text, 'second');
});

test('broker event factory records action-bearing text and TTL', () => {
  resetBrokerState();
  const now = Date.now();
  const event = broker.createVoiceEvent({
    workspace: 'ws-action',
    text: 'Hermes needs you. Open the cloud session: UltraPlan needs input. Answer the question.',
    reason: 'UltraPlan needs input',
    action: 'Open the cloud session',
    details: 'Answer the question.',
    priority: 90,
    ttlSeconds: 5,
    dedupeKey: 'Open the cloud session | UltraPlan needs input | Answer the question.',
  });

  assert.strictEqual(event.type, 'voice');
  assert.strictEqual(event.workspace, 'ws-action');
  assert.strictEqual(event.priority, 90);
  assert.ok(event.id.startsWith('voice-'));
  assert.ok(event.expiresAt >= now + 4_000 && event.expiresAt <= now + 6_000);
  assert.strictEqual(event.action, 'Open the cloud session');
  assert.ok(event.text.includes('Open the cloud session'));
});
