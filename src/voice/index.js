'use strict';

/**
 * Voice readout providers. Voice is a core feature, not an optional extra.
 *
 * Providers:
 *   say         - macOS built-in TTS fallback
 *   elevenlabs  - ElevenLabs TTS -> mp3 -> afplay; falls back to say if not configured
 *   command     - arbitrary shell command; text on stdin and $CMUX_HERMES_TEXT/$CMUX_SKILLS_TEXT
 *   none        - legacy alias treated as say
 *
 * By default `speak()` enqueues into the cross-session broker so multiple
 * cmux panes speak one at a time. The broker worker calls `speakNowText()` to
 * execute the provider synchronously inside that worker.
 */

const { spawn, spawnSync } = require('child_process');
const state = require('../state');
const broker = require('./broker');

function renderTemplate(template, fields) {
  const data = typeof fields === 'object' && fields !== null
    ? fields
    : { reason: fields || '' };
  return String(template || '{reason}').replace(/\{([A-Za-z0-9_]+)\}/g, (_, key) => {
    const value = data[key];
    return value === undefined || value === null ? '' : String(value);
  });
}

function childEnv(text, extraEnv) {
  return { ...process.env, CMUX_HERMES_TEXT: text, CMUX_SKILLS_TEXT: text, ...(extraEnv || {}) };
}

/** Detached fire-and-forget `sh -c <script>` with text piped on stdin. */
function detachedShell(script, text, extraEnv) {
  try {
    const child = spawn('/bin/sh', ['-c', script], {
      detached: true,
      stdio: ['pipe', 'ignore', 'ignore'],
      env: childEnv(text, extraEnv),
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

/** Blocking shell runner used only by the broker worker to serialize speech. */
function blockingShell(script, text, extraEnv, timeoutSeconds) {
  try {
    const res = spawnSync('/bin/sh', ['-c', script], {
      input: text,
      stdio: ['pipe', 'ignore', 'ignore'],
      env: childEnv(text, extraEnv),
      timeout: Math.max(1, Number(timeoutSeconds) || 30) * 1000,
    });
    return res.status === 0 || res.status === null;
  } catch (_) {
    return false;
  }
}

const SAFE_ID = /^[A-Za-z0-9_-]+$/;
const SAFE_ENV = /^[A-Za-z_][A-Za-z0-9_]*$/;

function elevenLabsScript(text, cfg) {
  const el = cfg.voice.elevenlabs || {};
  const keyEnv = el.apiKeyEnv || 'ELEVENLABS_API_KEY';
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
  // `curl --fail` is deliberate: HTTP 401/429/etc. must not be treated as a
  // playable MP3. If ElevenLabs fails at runtime, fall back to macOS `say`
  // inside this same script so detached broker workers still speak.
  return {
    script: [
      'set +e',
      `KEY="$${keyEnv}"`,
      '[ -n "$KEY" ] || { command -v say >/dev/null 2>&1 && exec say "$CMUX_HERMES_TEXT"; exit 0; }',
      'OUT="$(mktemp -t cmux-skills-voice.XXXXXX).mp3"',
      'trap \'rm -f "$OUT"\' EXIT',
      `if curl -fsS --max-time ${timeout} -X POST "https://api.elevenlabs.io/v1/text-to-speech/${voiceId}" -H "xi-api-key: $KEY" -H "Content-Type: application/json" -d "$CMUX_SKILLS_TTS_BODY" -o "$OUT" && command -v afplay >/dev/null 2>&1 && afplay "$OUT"; then exit 0; fi`,
      'command -v say >/dev/null 2>&1 && exec say "$CMUX_HERMES_TEXT"',
      'exit 0',
    ].join('\n'),
    env: { CMUX_SKILLS_TTS_BODY: body },
  };
}

function speakNowText(text, cfg, { detached = true } = {}) {
  const v = cfg.voice || {};
  const provider = v.provider || 'say';
  const timeout = v.timeoutSeconds || 30;

  const runShell = (script, extraEnv) => detached
    ? detachedShell(script, text, extraEnv)
    : blockingShell(script, text, extraEnv, timeout);

  const speakWithSay = () => {
    runShell('exec say', {});
    return 'say';
  };

  if (provider === 'elevenlabs') {
    const keyEnv = (cfg.voice.elevenlabs || {}).apiKeyEnv || 'ELEVENLABS_API_KEY';
    const el = elevenLabsScript(text, cfg);
    if (!el || !process.env[keyEnv]) return speakWithSay();
    runShell(el.script, el.env);
    return 'elevenlabs';
  }
  if (provider === 'command') {
    if (!v.command) return speakWithSay();
    runShell(v.command, {});
    return 'command';
  }
  return speakWithSay();
}

/**
 * Speak the blocked reason. Returns the provider actually used, or `broker`
 * when the message has been accepted by the global cross-session broker.
 */
function speak(reason, cfg, workspace, fields = {}) {
  const v = cfg.voice || {};

  const data = {
    action: 'Human action required',
    reason: reason || '',
    details: '',
    ...fields,
  };
  const dedupeKey = [data.action, data.reason, data.details].filter(Boolean).join(' | ');

  // De-dupe rapid repeats of the same message on the same workspace before
  // queueing, so duplicates don't wake the broker worker.
  if (state.recentlySpoke(workspace, dedupeKey, v.dedupeSeconds || 0)) {
    return 'deduped';
  }

  const text = renderTemplate(v.template, data);

  const b = v.broker || {};
  if (b.enabled !== false) {
    const event = broker.createVoiceEvent({
      workspace,
      text,
      reason: data.reason,
      action: data.action,
      details: data.details,
      priority: b.priority == null ? 100 : b.priority,
      ttlSeconds: b.ttlSeconds || 300,
      dedupeKey,
    });
    const queued = broker.enqueue(event);
    if (queued.queued) {
      broker.spawnWorker();
      return 'broker';
    }
    // If the broker is unavailable, preserve the voice-first guarantee by
    // falling back to direct speech instead of silently dropping the alert.
  }

  return speakNowText(text, cfg, { detached: true });
}

module.exports = { speak, speakNowText, renderTemplate, _elevenLabsScript: elevenLabsScript };
