'use strict';

const os = require('os');
const fs = require('fs');
const path = require('path');

const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'cmux-skills-voice-test-'));
process.env.XDG_STATE_HOME = path.join(TMP, 'state');

const { test } = require('node:test');
const assert = require('node:assert');

const voice = require('../src/voice');
const config = require('../src/config');

test('renderTemplate substitutes {reason}', () => {
  assert.strictEqual(
    voice.renderTemplate('Agent blocked. {reason}', 'no key'),
    'Agent blocked. no key',
  );
  assert.strictEqual(voice.renderTemplate(undefined, 'x'), 'x');
});

test('speak is a no-op for provider "none"', () => {
  const cfg = config.deepMerge(config.DEFAULTS, { voice: { provider: 'none' } });
  assert.strictEqual(voice.speak('hi', cfg, 'ws-none'), 'none');
});

test('speak dedupes repeats within the window', () => {
  // Use the "command" provider with an inert command so nothing real runs,
  // then confirm the second identical call is deduped.
  const cfg = config.deepMerge(config.DEFAULTS, {
    voice: { provider: 'command', command: ':', dedupeSeconds: 60 },
  });
  assert.strictEqual(voice.speak('same', cfg, 'ws-dedupe'), 'command');
  assert.strictEqual(voice.speak('same', cfg, 'ws-dedupe'), 'deduped');
});

test('elevenlabs with unsafe voiceId is rejected (no shell built)', () => {
  const cfg = config.deepMerge(config.DEFAULTS, {
    voice: {
      provider: 'elevenlabs',
      dedupeSeconds: 0,
      elevenlabs: { voiceId: 'bad id; rm -rf /', modelId: 'eleven_flash_v2_5' },
    },
  });
  assert.strictEqual(voice.speak('boom', cfg, 'ws-evil'), 'none');
});
