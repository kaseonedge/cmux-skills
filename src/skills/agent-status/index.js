'use strict';

/**
 * agent-status skill — drive the cmux workspace tab from an agent's lifecycle.
 *
 *   working  -> tab GREEN  (a run is in progress)
 *   done     -> tab YELLOW (idle / finished this turn) unless still blocked
 *   blocked  -> tab RED + reason on the tab + notification + sound + voice
 *   clear    -> remove all signals (neutral tab)
 *   normalize-> recovery: clear stale state when no longer blocked
 *
 * "done" means "idle after this turn", not "goal achieved" — Hermes-style
 * agents have no goal-complete signal, so yellow == waiting for you.
 *
 * Blocked precedence: a blocked marker is sticky. `done` will NOT override
 * red while the marker is present; `working` (a new run starting) clears it.
 * Overlapping runs are tracked with a counter so the first `done` of two
 * concurrent runs doesn't flip the tab early.
 */

const { spawn } = require('child_process');
const cmux = require('../../cmux');
const state = require('../../state');
const voice = require('../../voice');

function playSound(cfg) {
  const s = cfg.sound || {};
  if (s.mode === 'none') return;
  const file = s.file || '/System/Library/Sounds/Funk.aiff';
  try {
    // Pass the path as an argv (no shell) so it can never be interpreted.
    const child = spawn('afplay', [file], {
      detached: true,
      stdio: 'ignore',
    });
    child.on('error', () => {});
    child.unref();
  } catch (_) {
    /* best-effort */
  }
}

function working(cfg, workspace) {
  // A new run starting means any prior blocked state is being addressed.
  state.clearBlocked(workspace);
  state.incrRuns(workspace);
  if (cfg.pill && cfg.pill.key) cmux.clearStatus(cfg.pill.key, workspace);
  cmux.setColor(cfg.colors.working, workspace);
  return { state: 'working' };
}

function done(cfg, workspace) {
  const remaining = state.decrRuns(workspace);
  if (remaining > 0) {
    // Another run is still active in this workspace; stay green.
    return { state: 'working', reason: 'overlapping-run' };
  }
  if (state.getBlocked(workspace)) {
    // Still blocked — keep red, don't override.
    return { state: 'blocked', reason: 'sticky-blocked' };
  }
  cmux.setColor(cfg.colors.done, workspace);
  if (cfg.done && cfg.done.clearDescription) cmux.setDescription('', workspace);
  return { state: 'done' };
}


function compactText(text, maxLength) {
  const oneLine = String(text || '').replace(/\s+/g, ' ').trim();
  const limit = Math.max(20, Number(maxLength) || 140);
  if (oneLine.length <= limit) return oneLine;
  return oneLine.slice(0, Math.max(0, limit - 1)).trimEnd() + '…';
}

function summary(cfg, workspace, text) {
  const s = cfg.summary || {};
  const body = compactText(text || 'Working…', s.maxLength);
  const display = `${s.prefix || ''}${body}`;
  if (s.setDescription !== false) cmux.setDescription(display, workspace);
  if (s.statusKey) {
    cmux.setStatus(
      s.statusKey,
      body,
      { icon: s.icon, color: s.color, priority: s.priority },
      workspace,
    );
  }
  return { state: 'summary', summary: body };
}

function clearSummary(cfg, workspace) {
  const s = cfg.summary || {};
  if (s.statusKey) cmux.clearStatus(s.statusKey, workspace);
  cmux.setDescription('', workspace);
  return { state: 'summary-clear' };
}

function blocked(cfg, workspace, reason, details) {
  const why = (reason || 'Needs human input').trim();
  state.setBlocked(workspace, why, details || '');

  cmux.setColor(cfg.colors.blocked, workspace);

  if (cfg.pill && cfg.pill.key) {
    cmux.setStatus(
      cfg.pill.key,
      why,
      { icon: cfg.pill.icon, color: cfg.pill.color, priority: cfg.pill.priority },
      workspace,
    );
  }

  const b = cfg.blocked || {};
  if (b.setDescription) cmux.setDescription(why, workspace);
  if (b.renameTitle) cmux.rename(`🔴 ${why}`, workspace);
  if (b.notify) {
    cmux.notify(
      { title: 'Agent blocked — needs you', subtitle: why, body: details || why },
      workspace,
    );
  }
  if (b.flash) cmux.triggerFlash(workspace);
  if (b.sound) playSound(cfg);

  const action = 'Human action required';
  const spoke = voice.speak(why, cfg, workspace, { action, details: details || '' });
  return { state: 'blocked', reason: why, voice: spoke };
}

function clear(cfg, workspace) {
  state.clearBlocked(workspace);
  state.resetRuns(workspace);
  if (cfg.pill && cfg.pill.key) cmux.clearStatus(cfg.pill.key, workspace);
  cmux.setDescription('', workspace);
  cmux.clearColor(workspace);
  return { state: 'clear' };
}

/** Recovery: called on startup/session reset to drop stale non-blocked state. */
function normalize(cfg, workspace) {
  state.resetRuns(workspace);
  if (state.getBlocked(workspace)) {
    // Preserve a genuine blocked signal across restarts.
    return { state: 'blocked', reason: 'preserved' };
  }
  if (cfg.pill && cfg.pill.key) cmux.clearStatus(cfg.pill.key, workspace);
  cmux.clearColor(workspace);
  return { state: 'normalized' };
}

/**
 * Dispatch a state transition. `opts` = {reason, details, workspace}.
 * No-ops (returns {state:'skipped'}) when not inside a cmux pane.
 */
function apply(stateName, cfg, opts = {}) {
  const workspace = opts.workspace || cmux.currentWorkspace();
  if (!workspace) return { state: 'skipped', reason: 'not-in-cmux' };

  switch (stateName) {
    case 'working':
      return working(cfg, workspace);
    case 'done':
      return done(cfg, workspace);
    case 'blocked':
      return blocked(cfg, workspace, opts.reason, opts.details);
    case 'summary':
      return summary(cfg, workspace, opts.summary || opts.reason);
    case 'summary-clear':
      return clearSummary(cfg, workspace);
    case 'clear':
      return clear(cfg, workspace);
    case 'normalize':
      return normalize(cfg, workspace);
    default:
      return { state: 'skipped', reason: `unknown:${stateName}` };
  }
}

module.exports = { apply, working, done, blocked, summary, clearSummary, clear, normalize, compactText };
