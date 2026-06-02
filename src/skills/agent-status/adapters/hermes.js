'use strict';

/**
 * Hermes adapter for the agent-status skill.
 *
 * SCOPE (v0.2): cmux now ships native agent hooks (`cmux hooks hermes-agent
 * install`) that own the *lifecycle* — running/idle state, notifications, Feed
 * approval cards, and session restore. We no longer install a competing Hermes
 * lifecycle hook; doing so would double-fire against the native config.yaml
 * hooks.
 *
 * What this adapter installs now is the one thing cmux's native hooks do NOT do:
 * the agent-authored "I'm blocked — here's why" escalation. It appends short,
 * idempotent guidance to SOUL.md telling the agent to run
 *   hermes-cmux block "<reason>"   when it needs a human, and
 *   hermes-cmux clear              once it's unblocked
 * which drives the red tab + reason + sound + spoken voice readout.
 *
 * It also cleans up the legacy lifecycle hook dir from older versions so the two
 * mechanisms can't fight.
 */

const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');

const SOUL_BEGIN = '<!-- BEGIN cmux-skills:agent-status -->';
const SOUL_END = '<!-- END cmux-skills:agent-status -->';

function hermesHome() {
  return process.env.HERMES_HOME || path.join(os.homedir(), '.hermes');
}

/** Legacy lifecycle-hook dir installed by cmux-skills <= 0.1. */
function legacyHookDir() {
  return path.join(hermesHome(), 'hooks', 'cmux-tab-state');
}

function soulPath() {
  return path.join(hermesHome(), 'SOUL.md');
}

/**
 * Resolve how to invoke this CLI from a foreign process (the agent's shell).
 * Prefer the Hermes-specific `hermes-cmux` on PATH; keep `cmux-skills` as a
 * backwards-compatible alias; otherwise fall back to node + this entrypoint.
 */
function resolveSelf() {
  for (const bin of ['hermes-cmux', 'cmux-skills']) {
    const onPath = spawnSync(`command -v ${bin}`, {
      shell: true,
      encoding: 'utf8',
    });
    if (onPath.status === 0 && (onPath.stdout || '').trim()) {
      return { argv: [bin], display: bin };
    }
  }
  const node = process.execPath;
  const cli = path.resolve(__dirname, '..', '..', '..', '..', 'bin', 'cmux-skills.js');
  return { argv: [node, cli], display: `${node} ${cli}` };
}

function soulBlock(display) {
  return [
    SOUL_BEGIN,
    '## Workspace status signal (cmux)',
    '',
    'cmux already shows when Hermes is running, idle, or awaiting approval. Hermes',
    'can add the missing human context: what it is working on, and why it is stuck.',
    '',
    'When your active workstream meaningfully changes, update the cmux subtext with',
    'one polished present-tense sentence under ~140 characters:',
    '',
    '```',
    `${display} summary "<what Hermes is working on now>"`,
    '```',
    '',
    'When you are blocked and need the human to act — waiting on a decision or',
    'approval, a missing credential/secret, or an error you cannot resolve — run',
    'this so your cmux tab turns red, names the reason, and speaks the requested',
    'action (voice + sound):',
    '',
    '```',
    `${display} block "<concise reason>"`,
    '```',
    '',
    'When the human has unblocked you and you resume, clear it:',
    '',
    '```',
    `${display} clear`,
    '```',
    '',
    'Keep the reason to a few words; it is shown on the tab and read aloud. Put',
    'extra context in your final message. You do NOT need to signal running/idle —',
    'cmux handles the Hermes lifecycle automatically.',
    SOUL_END,
  ].join('\n');
}

function removeLegacyHook() {
  const dir = legacyHookDir();
  try {
    if (fs.existsSync(dir)) {
      fs.rmSync(dir, { recursive: true, force: true });
      return `Removed legacy cmux-skills lifecycle hook: ${dir}`;
    }
  } catch (e) {
    return `WARNING: could not remove legacy hook dir (${dir}): ${e.message}`;
  }
  return null;
}

function install({ soul = true } = {}) {
  const lines = [];
  const self = resolveSelf();

  const cleaned = removeLegacyHook();
  if (cleaned) lines.push(cleaned);

  if (soul) {
    lines.push(updateSoul(self.display));
  } else {
    lines.push('Skipped SOUL.md guidance (--no-soul).');
  }

  if (self.argv.length > 1) {
    lines.push(
      '\nNote: `hermes-cmux` was not found on PATH, so an absolute path was baked\n' +
        '      into SOUL.md. For a cleaner setup: npm i -g hermes-cmux',
    );
  }

  lines.push(
    '\nLifecycle (running/idle/approvals/restore) is handled by cmux natively.',
    'Enable it once for Hermes:',
    '  cmux hooks hermes-agent install',
    '  hermes gateway restart        # reload config.yaml so both take effect',
  );
  return lines.join('\n');
}

function updateSoul(display) {
  const p = soulPath();
  let content = '';
  try {
    content = fs.readFileSync(p, 'utf8');
  } catch (_) {
    /* new file */
  }
  const block = soulBlock(display);
  const re = new RegExp(`${SOUL_BEGIN}[\\s\\S]*?${SOUL_END}`);
  let next;
  if (re.test(content)) {
    next = content.replace(re, block);
  } else {
    next = (content.trimEnd() + '\n\n' + block + '\n').replace(/^\n+/, '');
  }
  try {
    fs.mkdirSync(path.dirname(p), { recursive: true });
    fs.writeFileSync(p, next, 'utf8');
    return `Updated SOUL.md guidance: ${p}`;
  } catch (e) {
    return `WARNING: could not update SOUL.md (${p}): ${e.message}`;
  }
}

function uninstall() {
  const lines = [];

  const cleaned = removeLegacyHook();
  if (cleaned) lines.push(cleaned);

  // Strip the SOUL.md block.
  const p = soulPath();
  try {
    let content = fs.readFileSync(p, 'utf8');
    const re = new RegExp(`\\n*${SOUL_BEGIN}[\\s\\S]*?${SOUL_END}\\n*`);
    if (re.test(content)) {
      content = content.replace(re, '\n').replace(/\n{3,}/g, '\n\n').trimStart();
      fs.writeFileSync(p, content, 'utf8');
      lines.push(`Removed SOUL.md guidance: ${p}`);
    }
  } catch (_) {
    /* no soul file / nothing to do */
  }

  if (!lines.length) lines.push('Nothing to remove.');
  lines.push(
    '\nThis does not touch cmux native hooks. To remove those:',
    '  cmux hooks hermes-agent uninstall',
  );
  return lines.join('\n');
}

module.exports = { install, uninstall, legacyHookDir, soulPath, resolveSelf };
