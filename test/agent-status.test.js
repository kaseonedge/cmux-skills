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
const cfg = config.deepMerge(config.DEFAULTS, { sound: { mode: 'none' }, voice: { broker: { enabled: false } } });

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

test('blocked emits the full signal set with actionable detail', () => {
  stubCmux('ws-signals');
  agentStatus.apply('blocked', cfg, {
    reason: 'Claude UltraPlan needs input',
    action: 'Open the Claude web session and answer the routing question',
    details: 'Question: what should route through the global broker vs stay direct?',
  });
  const names = calls.map((c) => c[0]);
  assert.ok(names.includes('setColor'));
  assert.ok(names.includes('setStatus'));
  assert.ok(names.includes('setDescription'));
  assert.ok(names.includes('notify'));
  assert.ok(names.includes('triggerFlash'));
  assert.ok(colorCalls().includes(cfg.colors.blocked));

  const description = calls.find((c) => c[0] === 'setDescription');
  assert.strictEqual(
    description[1],
    'Claude UltraPlan needs input — Open the Claude web session and answer the routing question',
  );
  const notification = calls.find((c) => c[0] === 'notify');
  assert.deepStrictEqual(notification[1], {
    title: 'Agent blocked — Open the Claude web session and answer the routing question',
    subtitle: 'Claude UltraPlan needs input',
    body: 'Question: what should route through the global broker vs stay direct?',
  });
});



test('summary sets polished subtext and status without blocking', () => {
  stubCmux('ws-summary');
  const r = agentStatus.apply('summary', cfg, {
    summary: 'reviewing Hermes cmux dynamic summary implementation and tests',
  });
  assert.strictEqual(r.state, 'summary');
  assert.strictEqual(r.summary, 'reviewing Hermes cmux dynamic summary implementation and tests');
  const desc = calls.find((c) => c[0] === 'setDescription');
  assert.ok(desc, 'sets workspace description/subtext');
  assert.strictEqual(desc[1], 'Hermes: reviewing Hermes cmux dynamic summary implementation and tests');
  assert.ok(calls.map((c) => c[0]).includes('setStatus'));
});

test('summary text is compacted for tab subtext', () => {
  assert.strictEqual(agentStatus.compactText('  a\n\n b   c ', 140), 'a b c');
  assert.strictEqual(agentStatus.compactText('x'.repeat(30), 20), 'x'.repeat(19) + '…');
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
