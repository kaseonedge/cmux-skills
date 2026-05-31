'use strict';

/**
 * Configuration loading and defaults.
 *
 * Precedence (low -> high):
 *   built-in DEFAULTS  <  ~/.config/cmux-skills/config.json  <  env (CMUX_SKILLS_*)
 *
 * The config is intentionally small and provider-agnostic so the package is
 * useful outside any single agent framework.
 */

const fs = require('fs');
const os = require('os');
const path = require('path');

const DEFAULTS = {
  // Tab colors per state. cmux accepts named colors (Red, Amber, Green, ...)
  // or #RRGGBB hex.
  colors: {
    working: 'Green',
    done: '#F1C40F', // yellow (cmux has no named "Yellow"; hex is accepted)
    blocked: 'Red',
  },
  // Status pill shown on the tab when blocked.
  pill: {
    key: 'agent_status',
    icon: 'exclamationmark.triangle.fill',
    color: '#C0392B',
    priority: 100,
  },
  blocked: {
    notify: true, // fire a cmux notification (desktop alert + sidebar text)
    flash: true, // trigger the attention flash
    sound: true, // play a sound (see voice/sound config below)
    // Put the reason in the workspace description (subtitle) — preserves the
    // user's tab title. Set renameTitle: true to also prefix the title.
    setDescription: true,
    renameTitle: false,
  },
  done: {
    // Clear the blocked description when returning to "done".
    clearDescription: true,
  },
  sound: {
    // 'system' plays a bundled macOS sound via afplay; 'none' disables;
    // or set `file` to an absolute path to a sound file.
    mode: 'system',
    file: '/System/Library/Sounds/Funk.aiff',
  },
  voice: {
    // 'none' | 'say' (macOS TTS) | 'elevenlabs' | 'command'
    provider: 'none',
    // Spoken when blocked. Placeholders: {reason}
    template: 'Agent blocked. {reason}',
    // Min seconds between voice readouts for the same workspace+reason.
    dedupeSeconds: 30,
    // Hard timeout (seconds) for any voice subprocess.
    timeoutSeconds: 30,
    elevenlabs: {
      apiKeyEnv: 'ELEVEN_API_KEY',
      voiceId: 'iP95p4xoKVk53GoZ742B',
      modelId: 'eleven_flash_v2_5',
    },
    // For provider 'command': a shell command; the text is passed on stdin
    // and also available as $CMUX_SKILLS_TEXT.
    command: '',
  },
};

function configDir() {
  const base =
    process.env.XDG_CONFIG_HOME || path.join(os.homedir(), '.config');
  return path.join(base, 'cmux-skills');
}

function configPath() {
  return path.join(configDir(), 'config.json');
}

function stateDir() {
  const base =
    process.env.XDG_STATE_HOME || path.join(os.homedir(), '.local', 'state');
  return path.join(base, 'cmux-skills');
}

function deepMerge(base, override) {
  if (
    typeof base !== 'object' ||
    base === null ||
    Array.isArray(base) ||
    typeof override !== 'object' ||
    override === null ||
    Array.isArray(override)
  ) {
    return override === undefined ? base : override;
  }
  const out = Array.isArray(base) ? base.slice() : { ...base };
  for (const key of Object.keys(override)) {
    out[key] = deepMerge(base[key], override[key]);
  }
  return out;
}

function applyEnvOverrides(cfg) {
  const env = process.env;
  const out = deepMerge(cfg, {});
  if (env.CMUX_SKILLS_VOICE_PROVIDER)
    out.voice.provider = env.CMUX_SKILLS_VOICE_PROVIDER;
  if (env.CMUX_SKILLS_SOUND_MODE) out.sound.mode = env.CMUX_SKILLS_SOUND_MODE;
  if (env.CMUX_SKILLS_COLOR_WORKING)
    out.colors.working = env.CMUX_SKILLS_COLOR_WORKING;
  if (env.CMUX_SKILLS_COLOR_DONE) out.colors.done = env.CMUX_SKILLS_COLOR_DONE;
  if (env.CMUX_SKILLS_COLOR_BLOCKED)
    out.colors.blocked = env.CMUX_SKILLS_COLOR_BLOCKED;
  return out;
}

function load() {
  let cfg = deepMerge(DEFAULTS, {});
  try {
    const raw = fs.readFileSync(configPath(), 'utf8');
    const user = JSON.parse(raw);
    cfg = deepMerge(cfg, user);
  } catch (_) {
    /* no user config yet — use defaults */
  }
  return applyEnvOverrides(cfg);
}

function ensureConfig() {
  const p = configPath();
  if (fs.existsSync(p)) return { path: p, created: false };
  fs.mkdirSync(configDir(), { recursive: true });
  fs.writeFileSync(p, JSON.stringify(DEFAULTS, null, 2) + '\n', 'utf8');
  return { path: p, created: true };
}

module.exports = {
  DEFAULTS,
  configDir,
  configPath,
  stateDir,
  deepMerge,
  load,
  ensureConfig,
};
