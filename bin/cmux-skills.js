#!/usr/bin/env node
'use strict';

/**
 * hermes-cmux — CLI entrypoint.
 *
 *   hermes-cmux init                 Create default config + show status
 *   hermes-cmux doctor               Diagnose cmux / config / workspace
 *   hermes-cmux status <state>       working|done|blocked|clear|normalize
 *   hermes-cmux summary "<text>"   Update cmux subtext with current work
 *   hermes-cmux block "<reason>"     Shortcut for: status blocked --reason ...
 *   hermes-cmux clear                Shortcut for: status clear
 *   hermes-cmux install hermes
 *   hermes-cmux uninstall hermes
 *   hermes-cmux voice-test [opts]     Speak a sample blocked-action sentence
 *   hermes-cmux config <path|show>   Inspect configuration
 *   hermes-cmux version
 */

const fs = require('fs');
const path = require('path');

const config = require('../src/config');
const cmux = require('../src/cmux');
const agentStatus = require('../src/skills/agent-status');
const voice = require('../src/voice');
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

const USAGE = `hermes-cmux v${pkg.version}

Spoken, reasoned "needs-a-human" alerts for Hermes Agent in cmux.

cmux's native Hermes hooks (cmux hooks hermes-agent install) already show running/idle/approvals.
hermes-cmux adds the one thing they don't: a Hermes-authored "I'm blocked —
here's why and what you need to do" → red tab + reason + sound + voice.

Usage:
  hermes-cmux init                     Create or migrate config and show status
  hermes-cmux doctor                   Diagnose cmux install, config, workspace
  hermes-cmux summary "<text>" [opts]  Update subtext/status with current work
  hermes-cmux summary clear             Clear dynamic summary subtext
  hermes-cmux block "<reason>" [opts]  Mark blocked (red + reason + notify + sound + voice)
  hermes-cmux clear                    Clear all signals on the current tab
  hermes-cmux voice-test [opts]        Speak a sample blocked-action sentence
  hermes-cmux install hermes           Add Hermes SOUL.md guidance (--no-soul to skip SOUL.md)
  hermes-cmux uninstall hermes         Remove Hermes SOUL.md guidance
  hermes-cmux config <path|show>       Inspect configuration
  hermes-cmux version

Options for summary/block:
  --text "<text>"      Summary text for summary
  --reason "<text>"    Why the agent is blocked (shown on the tab)
  --details "<text>"   Longer note (notification body / voice)
  --workspace <id>     Target a specific workspace (default: current pane)

Options for voice-test:
  --reason "<text>"    Default: ElevenLabs smoke test
  --details "<text>"   Default includes the action the human should take
  --provider <name>     Override configured voice provider for one test
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
  const report = {
    cmuxBinary: bin || 'NOT FOUND',
    insideCmuxPane: cmux.insideCmux(),
    currentWorkspace: ws || '(none — signals will no-op)',
    nativeHooksDetected: nativeHooks.length ? nativeHooks : '(none — run `cmux hooks setup`)',
    configPath: config.configPath(),
    configExists: fs.existsSync(config.configPath()),
    stateDir: config.stateDir(),
    voiceProvider: cfg.voice.provider,
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
    out('\n✓ Ready. Try: hermes-cmux voice-test --dry-run && hermes-cmux block "Smoke test" && hermes-cmux clear');
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
    : 'This is a test of the Hermes cmux blocked-alert voice. If you hear this sentence, voice is working and the spoken action is included.';
  const action = 'No real action required';
  const text = voice.renderTemplate(cfg.voice.template, { action, reason, details });
  if (flags['dry-run']) {
    out({ state: 'dry-run', provider: cfg.voice.provider, text });
    return;
  }
  const workspace = typeof flags.workspace === 'string' ? flags.workspace : `voice-test-${Date.now()}`;
  const spoke = voice.speak(reason, cfg, workspace, { action, details });
  out({ state: 'voice-test', provider: spoke, text });
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
