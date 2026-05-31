'use strict';

/**
 * Hermes adapter for the agent-status skill.
 *
 * Installs a Hermes hook (~/.hermes/hooks/cmux-tab-state/) that maps the agent
 * lifecycle to cmux tab colors by shelling out to this package's CLI:
 *   agent:start    -> working (green)
 *   agent:end      -> done    (yellow, unless blocked)
 *   session:end    -> clear
 *   gateway:startup-> normalize (recovery)
 *
 * Blocked/red is NOT automated from a lifecycle event (Hermes agents have no
 * goal/blocked signal). Instead we append a short instruction to SOUL.md telling
 * the agent to run `cmux-skills block "<reason>"` when it needs a human.
 *
 * After install you must reload Hermes so the hook is picked up:
 *   hermes gateway restart
 */

const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');

const TEMPLATE_DIR = path.join(__dirname, '..', 'templates');

const SOUL_BEGIN = '<!-- BEGIN cmux-skills:agent-status -->';
const SOUL_END = '<!-- END cmux-skills:agent-status -->';

function hermesHome() {
  return process.env.HERMES_HOME || path.join(os.homedir(), '.hermes');
}

function hookDir() {
  return path.join(hermesHome(), 'hooks', 'cmux-tab-state');
}

function soulPath() {
  return path.join(hermesHome(), 'SOUL.md');
}

/**
 * Resolve how to invoke this CLI from a foreign process (the Hermes hook /
 * the agent's shell). Prefer a `cmux-skills` on PATH; otherwise fall back to
 * the absolute node + entrypoint that is running right now.
 */
function resolveSelf() {
  const onPath = spawnSync('command -v cmux-skills', {
    shell: true,
    encoding: 'utf8',
  });
  if (onPath.status === 0 && (onPath.stdout || '').trim()) {
    return { argv: ['cmux-skills'], display: 'cmux-skills' };
  }
  const node = process.execPath;
  const cli = path.resolve(__dirname, '..', '..', '..', '..', 'bin', 'cmux-skills.js');
  return { argv: [node, cli], display: `${node} ${cli}` };
}

function pyList(argv) {
  return '[' + argv.map((a) => JSON.stringify(a)).join(', ') + ']';
}

function soulBlock(display) {
  return [
    SOUL_BEGIN,
    '## Workspace status signal (cmux)',
    '',
    'When you are blocked and need the human to act — waiting on a decision or',
    'approval, a missing credential/secret, or an error you cannot resolve —',
    'run this in your terminal so your cmux tab turns red and alerts them:',
    '',
    '```',
    `${display} block "<concise reason>"`,
    '```',
    '',
    'Keep the reason to a few words; it is shown on the tab. You do NOT need to',
    'signal working/done — that is automatic. When you resume after the human',
    'replies, the tab returns to normal on its own.',
    SOUL_END,
  ].join('\n');
}

function install({ soul = true } = {}) {
  const lines = [];
  const dir = hookDir();
  fs.mkdirSync(dir, { recursive: true });

  const self = resolveSelf();

  // HOOK.yaml (verbatim)
  const yaml = fs.readFileSync(path.join(TEMPLATE_DIR, 'HOOK.yaml'), 'utf8');
  fs.writeFileSync(path.join(dir, 'HOOK.yaml'), yaml, 'utf8');

  // handler.py with the CLI invocation baked in
  let handler = fs.readFileSync(path.join(TEMPLATE_DIR, 'handler.py'), 'utf8');
  handler = handler.replace('__CLI_COMMAND__', pyList(self.argv));
  fs.writeFileSync(path.join(dir, 'handler.py'), handler, 'utf8');

  lines.push(`Installed Hermes hook: ${dir}`);
  lines.push(`  CLI invocation: ${self.display}`);

  if (soul) {
    lines.push(updateSoul(self.display));
  } else {
    lines.push('Skipped SOUL.md guidance (--no-soul).');
  }

  if (self.argv.length > 1) {
    lines.push(
      '\nNote: `cmux-skills` was not found on PATH, so an absolute path was baked in.\n' +
        '      For a cleaner setup, install globally: npm i -g cmux-skills',
    );
  }

  lines.push('\nNext: reload Hermes to activate the hook:\n  hermes gateway restart');
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
  const dir = hookDir();
  try {
    fs.rmSync(dir, { recursive: true, force: true });
    lines.push(`Removed Hermes hook: ${dir}`);
  } catch (e) {
    lines.push(`Could not remove hook dir: ${e.message}`);
  }

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

  lines.push('\nReload Hermes to deactivate:\n  hermes gateway restart');
  return lines.join('\n');
}

module.exports = { install, uninstall, hookDir, soulPath, resolveSelf };
