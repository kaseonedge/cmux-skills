'use strict';

const os = require('os');
const fs = require('fs');
const path = require('path');

// Point the adapter at a throwaway HERMES_HOME before requiring it.
const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'cmux-skills-hermes-'));
process.env.HERMES_HOME = TMP;

const { test } = require('node:test');
const assert = require('node:assert');

const hermes = require('../src/skills/agent-status/adapters/hermes');

const soul = () => path.join(TMP, 'SOUL.md');
const legacyDir = () => path.join(TMP, 'hooks', 'cmux-tab-state');

test('install writes SOUL.md block/clear guidance and no lifecycle hook', () => {
  const msg = hermes.install();
  const content = fs.readFileSync(soul(), 'utf8');
  assert.ok(content.includes('<!-- BEGIN cmux-skills:agent-status -->'));
  assert.ok(content.includes('block "<concise reason>"'));
  assert.ok(content.includes('clear'));
  // We must NOT install a competing lifecycle hook anymore.
  assert.ok(!fs.existsSync(legacyDir()), 'legacy lifecycle hook must not be created');
  // It should point users at the native lifecycle setup.
  assert.ok(msg.includes('cmux hooks hermes-agent install'));
});

test('install is idempotent (single guidance block)', () => {
  hermes.install();
  hermes.install();
  const content = fs.readFileSync(soul(), 'utf8');
  const count = content.split('<!-- BEGIN cmux-skills:agent-status -->').length - 1;
  assert.strictEqual(count, 1);
});

test('install removes a legacy lifecycle hook dir from older versions', () => {
  fs.mkdirSync(legacyDir(), { recursive: true });
  fs.writeFileSync(path.join(legacyDir(), 'handler.py'), '# stale', 'utf8');
  const msg = hermes.install();
  assert.ok(!fs.existsSync(legacyDir()), 'legacy hook dir should be cleaned up');
  assert.ok(msg.includes('Removed legacy'));
});

test('uninstall strips the SOUL.md guidance block', () => {
  hermes.install();
  hermes.uninstall();
  const content = fs.readFileSync(soul(), 'utf8');
  assert.ok(!content.includes('<!-- BEGIN cmux-skills:agent-status -->'));
});
