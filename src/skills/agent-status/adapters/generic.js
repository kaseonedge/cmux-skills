'use strict';

/**
 * Generic adapter for the agent-status skill.
 *
 * For agents/frameworks without a dedicated adapter (Claude Code, Codex, custom
 * loops, shell scripts). It doesn't install anything — it prints the exact
 * commands to wire status signals into whatever lifecycle hooks you have.
 */

const { resolveSelf } = require('./hermes');

function install() {
  const self = resolveSelf();
  const c = self.display;
  return [
    'cmux-skills — generic wiring',
    '',
    'There is nothing to install for the generic adapter. Call the CLI from your',
    "agent's lifecycle (run these *inside* the cmux pane the agent runs in):",
    '',
    `  # when a run/turn starts:`,
    `  ${c} status working`,
    '',
    `  # when the run/turn finishes (idle):`,
    `  ${c} status done`,
    '',
    `  # when the agent is blocked and needs a human:`,
    `  ${c} block "<concise reason>"`,
    '',
    `  # to reset the tab (e.g. new session):`,
    `  ${c} status clear`,
    '',
    `  # recovery on startup (drops stale, non-blocked state):`,
    `  ${c} status normalize`,
    '',
    'All commands safely no-op when not inside a cmux pane (CMUX_WORKSPACE_ID',
    'unset), so they are safe to leave in headless/CI runs.',
    '',
    'Examples:',
    `  - Claude Code: call \`${c} status working\` from a pre-run hook and`,
    `    \`${c} status done\` from a post-run/stop hook.`,
    `  - A shell agent loop: bracket the loop body with working/done and emit`,
    `    \`${c} block "..."\` on the error/needs-input path.`,
  ].join('\n');
}

module.exports = { install };
