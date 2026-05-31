'use strict';

const os = require('os');
const fs = require('fs');
const path = require('path');

const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'cmux-skills-state-'));
process.env.XDG_STATE_HOME = path.join(TMP, 'state');

const { test } = require('node:test');
const assert = require('node:assert');

const state = require('../src/state');

const WS = 'workspace-abc';

test('blocked marker round-trips and clears', () => {
  assert.strictEqual(state.getBlocked(WS), null);
  state.setBlocked(WS, 'needs key', 'detail');
  const m = state.getBlocked(WS);
  assert.strictEqual(m.reason, 'needs key');
  assert.strictEqual(m.details, 'detail');
  assert.ok(typeof m.ts === 'number');
  state.clearBlocked(WS);
  assert.strictEqual(state.getBlocked(WS), null);
});

test('run counter increments, decrements and floors at zero', () => {
  const ws = 'runs-ws';
  assert.strictEqual(state.readRuns(ws), 0);
  assert.strictEqual(state.incrRuns(ws), 1);
  assert.strictEqual(state.incrRuns(ws), 2);
  assert.strictEqual(state.decrRuns(ws), 1);
  assert.strictEqual(state.decrRuns(ws), 0);
  assert.strictEqual(state.decrRuns(ws), 0, 'never goes negative');
});

test('resetRuns zeroes the counter', () => {
  const ws = 'reset-ws';
  state.incrRuns(ws);
  state.incrRuns(ws);
  assert.strictEqual(state.resetRuns(ws), 0);
  assert.strictEqual(state.readRuns(ws), 0);
});

test('recentlySpoke dedupes same reason within window', () => {
  const ws = 'voice-ws';
  assert.strictEqual(state.recentlySpoke(ws, 'hi', 60), false);
  assert.strictEqual(state.recentlySpoke(ws, 'hi', 60), true);
  // Different reason is not deduped.
  assert.strictEqual(state.recentlySpoke(ws, 'bye', 60), false);
  // Zero window never dedupes.
  assert.strictEqual(state.recentlySpoke(ws, 'bye', 0), false);
});
