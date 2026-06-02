#!/usr/bin/env node
'use strict';

/**
 * cmux-voice — voice-first CLI entrypoint.
 *
 *   cmux-voice init                 Create default config + show status
 *   cmux-voice doctor               Diagnose cmux / config / workspace
 *   cmux-voice status <state>       working|done|blocked|clear|normalize
 *   cmux-voice summary "<text>"    Update cmux subtext with current work
 *   cmux-voice block "<reason>"    Shortcut for: status blocked --reason ...
 *   cmux-voice clear                Shortcut for: status clear
 *   cmux-voice install hermes
 *   cmux-voice uninstall hermes
 *   cmux-voice voice-test [opts]    Speak a sample blocked-action sentence
 *   cmux-voice broker <status|drain> Inspect or drain the cross-session voice queue
 *   cmux-voice config <path|show>   Inspect configuration
 *   cmux-voice version
 */

const fs = require('fs');
const path = require('path');

const config = require('../src/config');
const cmux = require('../src/cmux');
const agentStatus = require('../src/skills/agent-status');
const voice = require('../src/voice');
const broker = require('../src/voice/broker');
const hermesAdapter = require('../src/skills/agent-status/adapters/hermes');

const pkg = require('../package.json');

function parseFlags(argv) {
  const flags = {};
  const positional = [];
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a.startsWith('--')) {
      const key = a.slice(2);
      const next = argv[i + 1];
      if (next === undefined || next.startsWith('--')) {
        flags[key] = true;
      } else {
        flags[key] = next;
        i++;
      }
    } else {
      positional.push(a);
    }
  }
  return { flags, positional };
}

function out(obj) {
  process.stdout.write(
    (typeof obj === 'string' ? obj : JSON.stringify(obj, null, 2)) + '\n',
  );
}

const CLI_NAME = path.basename(process.argv[1] || 'cmux-voice') === 'cmux-skills' ? 'cmux-voice' : path.basename(process.argv[1] || 'cmux-voice');

const USAGE = `${CLI_NAME} v${pkg.version}

Voice-first "needs-a-human" alerts and dynamic subtext for Hermes Agent and OpenClaw in cmux.

cmux native hooks show running/idle/approvals. cmux-voice adds the higher-level
agent context: polished subtext plus a spoken "I'm blocked — here's what you
need to do" alert → voice + red tab + reason + notification + sound.

Usage:
  ${CLI_NAME} init                     Create or migrate config and show status
  ${CLI_NAME} doctor                   Diagnose cmux install, config, workspace
  ${CLI_NAME} summary "<text>" [opts]  Update subtext/status with current work
  ${CLI_NAME} summary clear            Clear dynamic summary subtext
  ${CLI_NAME} block "<reason>" [opts]  Mark blocked (red + reason + notify + sound + voice)
  ${CLI_NAME} clear                    Clear all signals on the current tab
  ${CLI_NAME} voice-test [opts]        Speak a sample blocked-action sentence
  ${CLI_NAME} broker <status|drain>    Inspect or drain the cross-session voice queue
  ${CLI_NAME} install hermes           Add Hermes SOUL.md guidance (--no-soul to skip SOUL.md)
  ${CLI_NAME} uninstall hermes         Remove Hermes SOUL.md guidance
  ${CLI_NAME} config <path|show>       Inspect configuration
  ${CLI_NAME} version

Options for summary/block:
  --text "<text>"      Summary text for summary
  --reason "<text>"    Why the agent is blocked (shown on the tab)
  --action "<text>"    What the human should do next (description / title / voice)
  --details "<text>"   Longer note (notification body / voice)
  --workspace <id>     Target a specific workspace (default: current pane)

Options for voice-test:
  --reason "<text>"    Default: ElevenLabs smoke test
  --details "<text>"   Default includes the action the human should take
  --provider <name>     Override configured voice provider for one test; none falls back to say
  --dry-run             Print the exact spoken text without playing audio

First, let cmux own the Hermes lifecycle:  cmux hooks hermes-agent install
Docs: ${pkg.homepage}
`;

function detectNativeHooks() {
  // cmux native agent hooks record sessions under ~/.cmuxterm/<agent>-hook-sessions.json.
  const home = process.env.HOME || '';
  if (!home) return [];
  try {
    return fs
      .readdirSync(path.join(home, '.cmuxterm'))
      .filter((f) => f.endsWith('-hook-sessions.json'))
      .map((f) => f.replace('-hook-sessions.json', ''));
  } catch (_) {
    return [];
  }
}

function cmdDoctor() {
  const bin = cmux.resolveBinary();
  const ws = cmux.currentWorkspace();
  const cfg = config.load();
  const nativeHooks = detectNativeHooks();
  const elevenlabsApiKeyEnv = cfg.voice.elevenlabs?.apiKeyEnv || 'ELEVENLABS_API_KEY';
  const report = {
    cmuxBinary: bin || 'NOT FOUND',
    insideCmuxPane: cmux.insideCmux(),
    currentWorkspace: ws || '(none — signals will no-op)',
    nativeHooksDetected: nativeHooks.length ? nativeHooks : '(none — run `cmux hooks setup`)',
    configPath: config.configPath(),
    configExists: fs.existsSync(config.configPath()),
    stateDir: config.stateDir(),
    voiceProvider: cfg.voice.provider,
    voiceBroker: cfg.voice.broker?.enabled !== false ? 'enabled' : 'disabled',
    brokerQueued: broker.status().queued,
    elevenlabsApiKeyEnv,
    elevenlabsApiKeyPresent: Boolean(process.env[elevenlabsApiKeyEnv]),
    soundMode: cfg.sound.mode,
    colors: cfg.colors,
  };
  out(report);
  if (!bin) {
    out('\n⚠  cmux CLI not found. Install cmux from https://cmux.com');
  } else if (!ws) {
    out(
      '\nℹ  Not inside a cmux pane right now (CMUX_WORKSPACE_ID unset). ' +
        'Status calls will safely no-op until run inside a cmux terminal.',
    );
  } else {
    if (!nativeHooks.length) {
      out(
        '\nℹ  No native cmux agent hooks detected. For running/idle/approvals/restore,\n' +
          '   run `cmux hooks hermes-agent install` (hermes-cmux adds only the block/voice layer).',
      );
    }
    out('\n✓ Ready. Try: cmux-voice voice-test --dry-run && cmux-voice block "Smoke test" && cmux-voice clear');
  }
}

function readStdinIfPiped() {
  if (process.stdin.isTTY) return '';
  try {
    return fs.readFileSync(0, 'utf8').trim();
  } catch (_) {
    return '';
  }
}

function cmdStatus(positional, flags) {
  const stateName = positional[0];
  if (!stateName) {
    out('error: status requires a state (working|done|blocked|clear|normalize)');
    process.exitCode = 1;
    return;
  }
  const cfg = config.load();
  const result = agentStatus.apply(stateName, cfg, {
    reason: typeof flags.reason === 'string' ? flags.reason : undefined,
    details: typeof flags.details === 'string' ? flags.details : undefined,
    action: typeof flags.action === 'string' ? flags.action : undefined,
    workspace: typeof flags.workspace === 'string' ? flags.workspace : undefined,
    summary: typeof flags.text === 'string' ? flags.text : undefined,
  });
  out(result);
}


function cmdVoiceTest(flags) {
  const cfg = config.load();
  if (typeof flags.provider === 'string') cfg.voice.provider = flags.provider;
  const reason = typeof flags.reason === 'string' ? flags.reason : 'ElevenLabs smoke test';
  const details = typeof flags.details === 'string'
    ? flags.details
    : 'This is a test of the Hermes/OpenClaw cmux voice-first blocked alert. If you hear this sentence, voice is working, fallback is available, and the spoken action is included.';
  const action = 'No real action required';
  const text = voice.renderTemplate(cfg.voice.template, { action, reason, details });
  if (flags['dry-run']) {
    out({ state: 'dry-run', provider: cfg.voice.provider, broker: cfg.voice.broker?.enabled !== false, text });
    return;
  }
  const workspace = typeof flags.workspace === 'string' ? flags.workspace : `voice-test-${Date.now()}`;
  const spoke = voice.speak(reason, cfg, workspace, { action, details });
  out({ state: 'voice-test', provider: spoke, text });
}

function cmdBroker(positional, flags) {
  const sub = positional[0] || 'status';
  if (sub === 'status') {
    out({ state: 'broker-status', ...broker.status() });
    return;
  }
  if (sub === 'drain') {
    const cfg = config.load();
    const result = broker.drain((event) => voice.speakNowText(event.text, cfg, { detached: false }), {
      maxEvents: flags.max ? Number(flags.max) : 100,
      lockStaleSeconds: cfg.voice.broker?.lockStaleSeconds || 300,
    });
    out({ state: flags.worker ? 'broker-worker' : 'broker-drain', ...result });
    return;
  }
  out('error: broker requires status or drain');
  process.exitCode = 1;
}

function main() {
  const [, , command, ...rest] = process.argv;
  const { flags, positional } = parseFlags(rest);

  switch (command) {
    case undefined:
    case 'help':
    case '-h':
    case '--help':
      out(USAGE);
      return;

    case 'version':
    case '-v':
    case '--version':
      out(pkg.version);
      return;

    case 'init': {
      const r = config.ensureConfig();
      out(r.migratedFrom ? `Created config: ${r.path} (migrated from ${r.migratedFrom})` : (r.created ? `Created config: ${r.path}` : `Config exists: ${r.path}`));
      cmdDoctor();
      return;
    }

    case 'doctor':
      cmdDoctor();
      return;

    case 'config': {
      const sub = positional[0] || 'show';
      if (sub === 'path') {
        out(config.configPath());
      } else {
        out(config.load());
      }
      return;
    }

    case 'status':
      cmdStatus(positional, flags);
      return;

    case 'summary': {
      const sub = positional[0];
      if (sub === 'clear') {
        cmdStatus(['summary-clear'], flags);
        return;
      }
      const text = positional.join(' ') || (typeof flags.text === 'string' ? flags.text : '') || readStdinIfPiped();
      cmdStatus(['summary'], { ...flags, text });
      return;
    }

    case 'block': {
      const reason = positional[0] || (typeof flags.reason === 'string' ? flags.reason : '');
      cmdStatus(['blocked'], { ...flags, reason });
      return;
    }

    case 'clear':
      cmdStatus(['clear'], flags);
      return;

    case 'voice-test':
    case 'test-voice':
      cmdVoiceTest(flags);
      return;

    case 'broker':
      cmdBroker(positional, flags);
      return;

    case 'install': {
      const adapter = positional[0];
      const opts = { soul: flags['no-soul'] ? false : true };
      if (adapter === 'hermes') {
        out(hermesAdapter.install(opts));
      } else {
        out('error: unknown adapter. Supported: hermes');
        process.exitCode = 1;
      }
      return;
    }

    case 'uninstall': {
      const adapter = positional[0];
      if (adapter === 'hermes') {
        out(hermesAdapter.uninstall());
      } else {
        out('error: unknown adapter. Supported: hermes');
        process.exitCode = 1;
      }
      return;
    }

    default:
      out(`error: unknown command '${command}'\n\n${USAGE}`);
      process.exitCode = 1;
  }
}

main();
