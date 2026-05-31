'use strict';

/**
 * Per-workspace state store.
 *
 * Keeps two things on disk (not /tmp, so it survives reboots and is
 * inspectable) keyed by the workspace id:
 *   - blocked marker: {reason, details, ts} when the agent is blocked.
 *   - active-run counter: number of in-flight agent runs, so overlapping or
 *     nested runs don't prematurely flip the tab to "done".
 *
 * All operations are best-effort and never throw.
 */

const fs = require('fs');
const path = require('path');
const { stateDir } = require('./config');

function safeKey(workspace) {
  return String(workspace || 'unknown').replace(/[^A-Za-z0-9_.:-]/g, '_');
}

function dir() {
  const d = stateDir();
  try {
    fs.mkdirSync(d, { recursive: true });
  } catch (_) {
    /* ignore */
  }
  return d;
}

function blockedFile(workspace) {
  return path.join(dir(), `${safeKey(workspace)}.blocked.json`);
}

function runsFile(workspace) {
  return path.join(dir(), `${safeKey(workspace)}.runs`);
}

function readJSON(file) {
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch (_) {
    return null;
  }
}

function setBlocked(workspace, reason, details) {
  try {
    fs.writeFileSync(
      blockedFile(workspace),
      JSON.stringify({ reason, details, ts: Date.now() }) + '\n',
      'utf8',
    );
  } catch (_) {
    /* ignore */
  }
}

function getBlocked(workspace) {
  return readJSON(blockedFile(workspace));
}

function clearBlocked(workspace) {
  try {
    fs.unlinkSync(blockedFile(workspace));
  } catch (_) {
    /* already gone */
  }
}

function readRuns(workspace) {
  try {
    const n = parseInt(fs.readFileSync(runsFile(workspace), 'utf8'), 10);
    return Number.isFinite(n) ? n : 0;
  } catch (_) {
    return 0;
  }
}

function writeRuns(workspace, n) {
  const v = Math.max(0, n | 0);
  try {
    if (v === 0) {
      fs.unlinkSync(runsFile(workspace));
    } else {
      fs.writeFileSync(runsFile(workspace), String(v), 'utf8');
    }
  } catch (_) {
    /* ignore */
  }
  return v;
}

/** Increment the active-run counter; returns the new value. */
function incrRuns(workspace) {
  return writeRuns(workspace, readRuns(workspace) + 1);
}

/** Decrement the active-run counter (floored at 0); returns the new value. */
function decrRuns(workspace) {
  return writeRuns(workspace, readRuns(workspace) - 1);
}

function resetRuns(workspace) {
  return writeRuns(workspace, 0);
}

/** Voice de-dupe: returns true if a readout for this key fired recently. */
function recentlySpoke(workspace, reason, windowSeconds) {
  const file = path.join(
    dir(),
    `${safeKey(workspace)}.voice`,
  );
  const prev = readJSON(file);
  const now = Date.now();
  const sameReason = prev && prev.reason === reason;
  const within =
    prev && now - prev.ts < Math.max(0, windowSeconds) * 1000;
  if (sameReason && within) return true;
  try {
    fs.writeFileSync(file, JSON.stringify({ reason, ts: now }) + '\n', 'utf8');
  } catch (_) {
    /* ignore */
  }
  return false;
}

module.exports = {
  setBlocked,
  getBlocked,
  clearBlocked,
  readRuns,
  incrRuns,
  decrRuns,
  resetRuns,
  recentlySpoke,
};
