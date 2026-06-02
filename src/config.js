'use strict';

/**
 * Configuration loading and defaults.
 *
 * Precedence (low -> high):
 *   built-in DEFAULTS  <  ~/.config/cmux-hermes/config.json  <  env (CMUX_HERMES_*)
 *
 * The config is intentionally small and scoped to Hermes/OpenClaw: cmux owns
 * lifecycle; this tool adds agent-authored summaries, blocked reasons, and
 * voice-first escalation.
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
  summary: {
    setDescription: true,
    statusKey: 'hermes_summary',
    icon: 'sparkles',
    color: '#3498DB',
    priority: 50,
    maxLength: 140,
    prefix: 'Hermes: ',
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
    // 'say' (macOS TTS fallback) | 'elevenlabs' | 'command'.
    // Legacy 'none' is normalized to 'say' because voice is a core feature.
    provider: 'say',
    // Spoken when blocked. Placeholders: {action}, {reason}, {details}
    template: 'Hermes needs you. {action}: {reason}. {details}',
    // Min seconds between voice readouts for the same workspace+reason.
    dedupeSeconds: 30,
    // Hard timeout (seconds) for any voice subprocess.
    timeoutSeconds: 30,
    elevenlabs: {
      apiKeyEnv: 'ELEVENLABS_API_KEY',
      voiceId: 'iP95p4xoKVk53GoZ742B',
      modelId: 'eleven_flash_v2_5',
    },
    // Cross-session broker serializes voice from all cmux panes.
    broker: {
      enabled: true,
      priority: 100,
      ttlSeconds: 300,
      lockStaleSeconds: 300,
    },
    // For provider 'command': a shell command; the text is passed on stdin
    // and also available as $CMUX_SKILLS_TEXT.
    command: '',
  },
};

function configBaseDir() {
  return process.env.XDG_CONFIG_HOME || path.join(os.homedir(), '.config');
}

function stateBaseDir() {
  return process.env.XDG_STATE_HOME || path.join(os.homedir(), '.local', 'state');
}

function configDir() {
  return path.join(configBaseDir(), 'cmux-hermes');
}

function legacyConfigDir() {
  return path.join(configBaseDir(), 'cmux-skills');
}

function configPath() {
  return path.join(configDir(), 'config.json');
}

function legacyConfigPath() {
  return path.join(legacyConfigDir(), 'config.json');
}

function stateDir() {
  return path.join(stateBaseDir(), 'cmux-hermes');
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

function normalizeLegacyConfig(cfg) {
  const out = deepMerge(cfg, {});
  if (out.voice && out.voice.template === 'Agent blocked. {reason}') {
    out.voice.template = DEFAULTS.voice.template;
  }
  if (out.voice && (!out.voice.provider || out.voice.provider === 'none')) {
    out.voice.provider = 'say';
  }
  return out;
}

function applyEnvOverrides(cfg) {
  const env = process.env;
  const out = deepMerge(cfg, {});
  const voiceProvider = env.CMUX_HERMES_VOICE_PROVIDER || env.CMUX_SKILLS_VOICE_PROVIDER;
  const soundMode = env.CMUX_HERMES_SOUND_MODE || env.CMUX_SKILLS_SOUND_MODE;
  const colorWorking = env.CMUX_HERMES_COLOR_WORKING || env.CMUX_SKILLS_COLOR_WORKING;
  const colorDone = env.CMUX_HERMES_COLOR_DONE || env.CMUX_SKILLS_COLOR_DONE;
  const colorBlocked = env.CMUX_HERMES_COLOR_BLOCKED || env.CMUX_SKILLS_COLOR_BLOCKED;
  if (voiceProvider) out.voice.provider = voiceProvider;
  if (soundMode) out.sound.mode = soundMode;
  if (colorWorking) out.colors.working = colorWorking;
  if (colorDone) out.colors.done = colorDone;
  if (colorBlocked) out.colors.blocked = colorBlocked;
  return out;
}

function load() {
  let cfg = deepMerge(DEFAULTS, {});
  const paths = [configPath(), legacyConfigPath()];
  for (const p of paths) {
    try {
      const raw = fs.readFileSync(p, 'utf8');
      const user = JSON.parse(raw);
      cfg = deepMerge(cfg, user);
      break;
    } catch (_) {
      /* try the next config path */
    }
  }
  return applyEnvOverrides(normalizeLegacyConfig(cfg));
}

function ensureConfig() {
  const p = configPath();
  if (fs.existsSync(p)) return { path: p, created: false };
  const legacy = legacyConfigPath();
  if (fs.existsSync(legacy)) {
    fs.mkdirSync(configDir(), { recursive: true });
    try {
      const raw = fs.readFileSync(legacy, 'utf8');
      const migrated = normalizeLegacyConfig(deepMerge(DEFAULTS, JSON.parse(raw)));
      fs.writeFileSync(p, JSON.stringify(migrated, null, 2) + '\n', 'utf8');
    } catch (_) {
      fs.copyFileSync(legacy, p);
    }
    return { path: p, created: true, migratedFrom: legacy };
  }
  fs.mkdirSync(configDir(), { recursive: true });
  fs.writeFileSync(p, JSON.stringify(DEFAULTS, null, 2) + '\n', 'utf8');
  return { path: p, created: true };
}

module.exports = {
  DEFAULTS,
  configDir,
  configPath,
  legacyConfigPath,
  stateDir,
  deepMerge,
  load,
  ensureConfig,
  normalizeLegacyConfig,
};
