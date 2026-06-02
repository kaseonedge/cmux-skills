'use strict';

const os = require('os');
const fs = require('fs');
const path = require('path');

// Isolate config/state on disk before requiring any modules.
const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'cmux-skills-test-'));
process.env.XDG_CONFIG_HOME = path.join(TMP, 'config');
process.env.XDG_STATE_HOME = path.join(TMP, 'state');

const { test } = require('node:test');
const assert = require('node:assert');

const config = require('../src/config');

test('deepMerge merges nested objects without mutating base', () => {
  const base = { a: 1, b: { c: 2, d: 3 } };
  const out = config.deepMerge(base, { b: { c: 20 }, e: 5 });
  assert.deepStrictEqual(out, { a: 1, b: { c: 20, d: 3 }, e: 5 });
  assert.strictEqual(base.b.c, 2, 'base untouched');
});

test('deepMerge replaces arrays wholesale', () => {
  const out = config.deepMerge({ list: [1, 2, 3] }, { list: [9] });
  assert.deepStrictEqual(out.list, [9]);
});

test('load returns defaults when no user config exists', () => {
  const cfg = config.load();
  assert.strictEqual(cfg.colors.working, 'Green');
  assert.strictEqual(cfg.colors.blocked, 'Red');
  assert.strictEqual(cfg.voice.provider, 'none');
  assert.strictEqual(cfg.voice.elevenlabs.apiKeyEnv, 'ELEVENLABS_API_KEY');
});

test('env overrides win over defaults', () => {
  process.env.CMUX_SKILLS_COLOR_WORKING = 'Teal';
  process.env.CMUX_SKILLS_VOICE_PROVIDER = 'say';
  try {
    const cfg = config.load();
    assert.strictEqual(cfg.colors.working, 'Teal');
    assert.strictEqual(cfg.voice.provider, 'say');
  } finally {
    delete process.env.CMUX_SKILLS_COLOR_WORKING;
    delete process.env.CMUX_SKILLS_VOICE_PROVIDER;
  }
});

test('ensureConfig writes the config file once', () => {
  const r1 = config.ensureConfig();
  assert.strictEqual(r1.created, true);
  assert.ok(fs.existsSync(r1.path));
  const r2 = config.ensureConfig();
  assert.strictEqual(r2.created, false);
});
