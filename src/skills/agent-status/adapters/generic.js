'use strict';

/**
 * Generic adapter for the agent-status skill.
 *
 * For agents/frameworks that cmux does NOT support natively (custom loops, shell
 * agents, CI pipelines, or a brand-new CLI cmux hasn't added yet). It installs
 * nothing — it prints the exact commands to wire status signals into whatever
 * lifecycle hooks you have.
 *
 * If your agent IS on cmux's native list (claude, codex, grok, opencode, pi,
 * amp, cursor, gemini, kiro, rovodev, copilot, codebuddy, factory, qoder,
 * hermes-agent), let cmux own the lifecycle with `cmux hooks setup` and use
 * cmux-skills only for the `block`/voice escalation — you do not need the
 * working/done wiring below.
 */

const { resolveSelf } = require('./hermes');

function install() {
  const self = resolveSelf();
  const c = self.display;
  return [
    'cmux-skills — generic wiring (agents cmux does not support natively)',
    '',
    'If your agent is on cmux\'s native list, prefer `cmux hooks setup` for the',
    'running/idle lifecycle and use only `block`/`clear` below for escalation.',
    '',
    "Otherwise, call the CLI from your agent's lifecycle (run these *inside* the",
    'cmux pane the agent runs in):',
    '',
    `  # when a run/turn starts:`,
    `  ${c} status working`,
    '',
    `  # when the run/turn finishes (idle):`,
    `  ${c} status done`,
    '',
    `  # when the agent is blocked and needs a human (the main event):`,
    `  ${c} block "<concise reason>"`,
    '',
    `  # once a human has unblocked you and you resume:`,
    `  ${c} clear`,
    '',
    `  # recovery on startup (drops stale, non-blocked state):`,
    `  ${c} status normalize`,
    '',
    'All commands safely no-op when not inside a cmux pane (CMUX_WORKSPACE_ID',
    'unset), so they are safe to leave in headless/CI runs.',
    '',
    'Examples:',
    `  - A shell agent loop: bracket the loop body with \`${c} status working\``,
    `    / \`${c} status done\`, and emit \`${c} block "..."\` on the`,
    `    error/needs-input path.`,
    `  - A natively-supported agent: run \`cmux hooks setup\` once, then only add`,
    `    \`${c} block "..."\` where the agent decides it needs a human.`,
  ].join('\n');
}

module.exports = { install };
