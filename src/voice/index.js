'use strict';

/**
 * Optional voice readout providers.
 *
 * Providers:
 *   none        - disabled (default)
 *   say         - macOS built-in TTS (`say`)
 *   elevenlabs  - ElevenLabs TTS -> mp3 -> afplay
 *   command     - arbitrary shell command; text on stdin and $CMUX_SKILLS_TEXT
 *
 * Speaking is always fire-and-forget and detached: we spawn the child,
 * unref it, and return immediately so the host agent's lifecycle is never
 * blocked or delayed by audio/network.
 */

const { spawn } = require('child_process');
const state = require('../state');

function renderTemplate(template, reason) {
  return String(template || '{reason}').replace(/\{reason\}/g, reason || '');
}

/** Detached fire-and-forget `sh -c <script>` with text piped on stdin. */
function detachedShell(script, text, extraEnv) {
  try {
    const child = spawn('/bin/sh', ['-c', script], {
      detached: true,
      stdio: ['pipe', 'ignore', 'ignore'],
      env: { ...process.env, CMUX_SKILLS_TEXT: text, ...(extraEnv || {}) },
    });
    if (child.stdin) {
      // The reader may exit before/while we write (e.g. a fast-exiting TTS
      // command like `:`), which emits an async EPIPE on the stdin stream.
      // Swallow it: voice is best-effort and must never crash the host.
      child.stdin.on('error', () => {});
      try {
        child.stdin.write(text);
        child.stdin.end();
      } catch (_) {
        /* pipe already torn down — ignore */
      }
    }
    child.on('error', () => {});
    child.unref();
    return true;
  } catch (_) {
    return false;
  }
}

const SAFE_ID = /^[A-Za-z0-9_-]+$/;
const SAFE_ENV = /^[A-Za-z_][A-Za-z0-9_]*$/;

function elevenLabsScript(text, cfg) {
  const el = cfg.voice.elevenlabs || {};
  const keyEnv = el.apiKeyEnv || 'ELEVEN_API_KEY';
  const voiceId = el.voiceId || '';
  const modelId = el.modelId || 'eleven_flash_v2_5';
  const timeout = Math.max(1, cfg.voice.timeoutSeconds || 30);

  // Reject anything that isn't a plain identifier so nothing user-controlled
  // is ever interpolated into the shell script.
  if (!SAFE_ENV.test(keyEnv) || !SAFE_ID.test(voiceId) || !SAFE_ID.test(modelId)) {
    return null;
  }

  // The request body (including the free-text reason) is built in JS with
  // JSON.stringify and handed to the script via the environment, so no
  // user-controlled text is ever concatenated into shell source.
  const body = JSON.stringify({
    text,
    model_id: modelId,
    voice_settings: {
      stability: 0.5,
      similarity_boost: 0.75,
      style: 0.3,
      use_speaker_boost: true,
    },
  });

  // Read the API key from the env var by (validated) name; play and clean up.
  return {
    script: [
      'set -e',
      `KEY="$${keyEnv}"`,
      '[ -n "$KEY" ] || exit 0',
      'OUT="$(mktemp -t cmux-skills-voice.XXXXXX).mp3"',
      'trap \'rm -f "$OUT"\' EXIT',
      `curl -sS --max-time ${timeout} -X POST "https://api.elevenlabs.io/v1/text-to-speech/${voiceId}" -H "xi-api-key: $KEY" -H "Content-Type: application/json" -d "$CMUX_SKILLS_TTS_BODY" -o "$OUT" || exit 0`,
      'command -v afplay >/dev/null 2>&1 && afplay "$OUT" || true',
    ].join('\n'),
    env: { CMUX_SKILLS_TTS_BODY: body },
  };
}

/**
 * Speak the blocked reason if a voice provider is configured.
 * Returns the provider used, or 'none'.
 */
function speak(reason, cfg, workspace) {
  const v = cfg.voice || {};
  const provider = v.provider || 'none';
  if (provider === 'none') return 'none';

  // De-dupe rapid repeats of the same reason on the same workspace.
  if (state.recentlySpoke(workspace, reason, v.dedupeSeconds || 0)) {
    return 'deduped';
  }

  const text = renderTemplate(v.template, reason);

  if (provider === 'say') {
    detachedShell('exec say', text);
    return 'say';
  }
  if (provider === 'elevenlabs') {
    const el = elevenLabsScript(text, cfg);
    if (!el) return 'none';
    detachedShell(el.script, text, el.env);
    return 'elevenlabs';
  }
  if (provider === 'command') {
    if (!v.command) return 'none';
    detachedShell(v.command, text);
    return 'command';
  }
  return 'none';
}

module.exports = { speak, renderTemplate };
