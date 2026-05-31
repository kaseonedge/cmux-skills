#!/usr/bin/env node
'use strict';

/**
 * cmux-skills — CLI entrypoint.
 *
 *   cmux-skills init                 Create default config + show status
 *   cmux-skills doctor               Diagnose cmux / config / workspace
 *   cmux-skills status <state>       working|done|blocked|clear|normalize
 *   cmux-skills block "<reason>"     Shortcut for: status blocked --reason ...
 *   cmux-skills clear                Shortcut for: status clear
 *   cmux-skills install <adapter>    hermes | generic
 *   cmux-skills uninstall <adapter>  hermes
 *   cmux-skills config <path|show>   Inspect configuration
 *   cmux-skills version
 */

const fs = require('fs');
const path = require('path');

const config = require('../src/config');
const cmux = require('../src/cmux');
const agentStatus = require('../src/skills/agent-status');
const hermesAdapter = require('../src/skills/agent-status/adapters/hermes');
const genericAdapter = require('../src/skills/agent-status/adapters/generic');

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

const USAGE = `cmux-skills v${pkg.version}

Signal AI coding-agent state on the cmux workspace tab.

Usage:
  cmux-skills init                     Create default config and show status
  cmux-skills doctor                   Diagnose cmux install, config, workspace
  cmux-skills status <state> [opts]    state: working|done|blocked|clear|normalize
  cmux-skills block "<reason>" [opts]  Mark blocked (red + reason + notify + sound)
  cmux-skills clear                    Clear all signals on the current tab
  cmux-skills install <adapter>        hermes | generic   (--no-soul to skip prompt)
  cmux-skills uninstall <adapter>      hermes
  cmux-skills config <path|show>       Inspect configuration
  cmux-skills version

Options for status/block:
  --reason "<text>"    Why the agent is blocked (shown on the tab)
  --details "<text>"   Longer note (notification body / voice)
  --workspace <id>     Target a specific workspace (default: current pane)

Docs: ${pkg.homepage}
`;

function cmdDoctor() {
  const bin = cmux.resolveBinary();
  const ws = cmux.currentWorkspace();
  const cfg = config.load();
  const report = {
    cmuxBinary: bin || 'NOT FOUND',
    insideCmuxPane: cmux.insideCmux(),
    currentWorkspace: ws || '(none — signals will no-op)',
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
    out('\n✓ Ready. Try: cmux-skills block "Smoke test" && cmux-skills clear');
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
  });
  out(result);
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
      out(r.created ? `Created config: ${r.path}` : `Config exists: ${r.path}`);
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

    case 'block': {
      const reason = positional[0] || (typeof flags.reason === 'string' ? flags.reason : '');
      cmdStatus(['blocked'], { ...flags, reason });
      return;
    }

    case 'clear':
      cmdStatus(['clear'], flags);
      return;

    case 'install': {
      const adapter = positional[0];
      const opts = { soul: flags['no-soul'] ? false : true };
      if (adapter === 'hermes') {
        out(hermesAdapter.install(opts));
      } else if (adapter === 'generic') {
        out(genericAdapter.install(opts));
      } else {
        out('error: unknown adapter. Supported: hermes | generic');
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
