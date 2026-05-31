'use strict';

const os = require('os');
const fs = require('fs');
const path = require('path');

const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'cmux-skills-skill-'));
process.env.XDG_STATE_HOME = path.join(TMP, 'state');

const { test } = require('node:test');
const assert = require('node:assert');

const cmux = require('../src/cmux');
const config = require('../src/config');
const agentStatus = require('../src/skills/agent-status');

// Disable real audio during tests; keep every visual signal on.
const cfg = config.deepMerge(config.DEFAULTS, { sound: { mode: 'none' } });

// Record cmux calls and stub them so tests never touch the real binary.
let calls;
function stubCmux(workspace) {
  calls = [];
  const noop = (name) => (...args) => {
    calls.push([name, ...args]);
    return { ok: true, stdout: '', stderr: '' };
  };
  cmux.currentWorkspace = () => workspace;
  cmux.setColor = noop('setColor');
  cmux.clearColor = noop('clearColor');
  cmux.setDescription = noop('setDescription');
  cmux.rename = noop('rename');
  cmux.setStatus = noop('setStatus');
  cmux.clearStatus = noop('clearStatus');
  cmux.notify = noop('notify');
  cmux.triggerFlash = noop('triggerFlash');
}

function colorCalls() {
  return calls.filter((c) => c[0] === 'setColor').map((c) => c[1]);
}

test('apply no-ops when not inside a cmux pane', () => {
  stubCmux(null);
  const r = agentStatus.apply('working', cfg);
  assert.deepStrictEqual(r, { state: 'skipped', reason: 'not-in-cmux' });
  assert.strictEqual(calls.length, 0);
});

test('working sets green and clears any blocked state', () => {
  stubCmux('ws-1');
  const r = agentStatus.apply('working', cfg);
  assert.strictEqual(r.state, 'working');
  assert.deepStrictEqual(colorCalls(), [cfg.colors.working]);
});

test('blocked is sticky: done keeps red until next working', () => {
  const ws = 'ws-sticky';
  stubCmux(ws);
  agentStatus.apply('working', cfg); // run counter -> 1
  agentStatus.apply('blocked', cfg, { reason: 'need approval' });
  // done should NOT override red while blocked marker is present.
  const done = agentStatus.apply('done', cfg);
  assert.strictEqual(done.state, 'blocked');
  assert.strictEqual(done.reason, 'sticky-blocked');
  // A new working run clears the marker and goes green.
  const work = agentStatus.apply('working', cfg);
  assert.strictEqual(work.state, 'working');
});

test('overlapping runs stay green until the last done', () => {
  const ws = 'ws-overlap';
  stubCmux(ws);
  agentStatus.apply('working', cfg); // 1
  agentStatus.apply('working', cfg); // 2
  const first = agentStatus.apply('done', cfg); // -> 1 remaining
  assert.strictEqual(first.state, 'working');
  assert.strictEqual(first.reason, 'overlapping-run');
  const last = agentStatus.apply('done', cfg); // -> 0 remaining
  assert.strictEqual(last.state, 'done');
});

test('blocked emits the full signal set', () => {
  stubCmux('ws-signals');
  agentStatus.apply('blocked', cfg, { reason: 'disk full', details: 'free space' });
  const names = calls.map((c) => c[0]);
  assert.ok(names.includes('setColor'));
  assert.ok(names.includes('setStatus'));
  assert.ok(names.includes('setDescription'));
  assert.ok(names.includes('notify'));
  assert.ok(names.includes('triggerFlash'));
  assert.ok(colorCalls().includes(cfg.colors.blocked));
});

test('normalize preserves a genuine blocked marker', () => {
  const ws = 'ws-normalize';
  stubCmux(ws);
  agentStatus.apply('blocked', cfg, { reason: 'still stuck' });
  const r = agentStatus.apply('normalize', cfg);
  assert.strictEqual(r.state, 'blocked');
  assert.strictEqual(r.reason, 'preserved');
});

test('clear resets everything to neutral', () => {
  stubCmux('ws-clear');
  agentStatus.apply('blocked', cfg, { reason: 'x' });
  const r = agentStatus.apply('clear', cfg);
  assert.strictEqual(r.state, 'clear');
  assert.ok(calls.map((c) => c[0]).includes('clearColor'));
});
