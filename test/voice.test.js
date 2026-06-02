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

test('renderTemplate substitutes blocked action fields', () => {
  assert.strictEqual(
    voice.renderTemplate('Hermes needs you. {action}: {reason}. {details}', {
      action: 'No real action required',
      reason: 'smoke test',
      details: 'voice includes the action',
    }),
    'Hermes needs you. No real action required: smoke test. voice includes the action',
  );
  assert.strictEqual(voice.renderTemplate(undefined, 'x'), 'x');
});

function withFakeSay(fn) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cmux-hermes-fake-say-'));
  const sayPath = path.join(dir, 'say');
  fs.writeFileSync(sayPath, '#!/bin/sh\nexit 0\n');
  fs.chmodSync(sayPath, 0o755);
  const oldPath = process.env.PATH;
  process.env.PATH = `${dir}:${oldPath || ''}`;
  try {
    return fn();
  } finally {
    process.env.PATH = oldPath;
  }
}

test('provider none is a legacy alias that falls back to say', () => {
  withFakeSay(() => {
    const cfg = config.deepMerge(config.DEFAULTS, { voice: { provider: 'none', broker: { enabled: false }, dedupeSeconds: 0 } });
    assert.strictEqual(voice.speak('hi', cfg, 'ws-none'), 'say');
  });
});

test('speak dedupes repeats within the window', () => {
  // Use the "command" provider with an inert command so nothing real runs,
  // then confirm the second identical call is deduped.
  const cfg = config.deepMerge(config.DEFAULTS, {
    voice: { provider: 'command', command: ':', broker: { enabled: false }, dedupeSeconds: 60 },
  });
  assert.strictEqual(voice.speak('same', cfg, 'ws-dedupe'), 'command');
  assert.strictEqual(voice.speak('same', cfg, 'ws-dedupe'), 'deduped');
});

test('elevenlabs with unsafe voiceId falls back to say (no shell built)', () => {
  withFakeSay(() => {
    const cfg = config.deepMerge(config.DEFAULTS, {
      voice: {
        provider: 'elevenlabs',
        broker: { enabled: false },
        dedupeSeconds: 0,
        elevenlabs: { voiceId: 'bad id; rm -rf /', modelId: 'eleven_flash_v2_5' },
      },
    });
    assert.strictEqual(voice.speak('boom', cfg, 'ws-evil'), 'say');
  });
});

test('elevenlabs without API key falls back to say', () => {
  withFakeSay(() => {
    const old = process.env.ELEVENLABS_API_KEY;
    delete process.env.ELEVENLABS_API_KEY;
    try {
      const cfg = config.deepMerge(config.DEFAULTS, {
        voice: { provider: 'elevenlabs', broker: { enabled: false }, dedupeSeconds: 0 },
      });
      assert.strictEqual(voice.speak('missing key', cfg, 'ws-no-key'), 'say');
    } finally {
      if (old !== undefined) process.env.ELEVENLABS_API_KEY = old;
    }
  });
});

test('elevenlabs HTTP failures are not treated as playable MP3s', () => {
  const cfg = config.deepMerge(config.DEFAULTS, {
    voice: { provider: 'elevenlabs', broker: { enabled: false }, dedupeSeconds: 0, timeoutSeconds: 1 },
  });
  const generated = voice._elevenLabsScript('fallback text', cfg);
  assert.ok(generated, 'safe ElevenLabs config builds a provider script');
  assert.match(generated.script, /curl -fsS/);
  assert.match(generated.script, /command -v say/);
  assert.match(generated.script, /exec say "\$CMUX_HERMES_TEXT"/);
});

test('speak queues through the broker when broker is enabled', () => {
  const broker = require('../src/voice/broker');
  const oldSpawnWorker = broker.spawnWorker;
  broker.spawnWorker = () => true;
  try {
    const cfg = config.deepMerge(config.DEFAULTS, {
      voice: { provider: 'say', broker: { enabled: true, priority: 80, ttlSeconds: 60 }, dedupeSeconds: 0 },
    });
    assert.strictEqual(
      voice.speak('UltraPlan needs input', cfg, 'ws-broker', {
        action: 'Open the Claude web session',
        details: 'Answer the broker routing question.',
      }),
      'broker',
    );
    const next = broker.popNext();
    assert.strictEqual(next.workspace, 'ws-broker');
    assert.strictEqual(next.priority, 80);
    assert.ok(next.text.includes('Open the Claude web session'));
    assert.ok(next.text.includes('UltraPlan needs input'));
  } finally {
    broker.spawnWorker = oldSpawnWorker;
  }
});
