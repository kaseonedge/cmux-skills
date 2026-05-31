'use strict';

/**
 * Thin wrapper around the cmux control CLI.
 *
 * cmux ships a `cmux` binary that talks to the running app over a Unix socket.
 * It only authenticates from inside a cmux-owned terminal pane, where cmux
 * injects CMUX_WORKSPACE_ID (the caller's workspace) into the environment.
 *
 * Every method here is best-effort: if cmux is missing or the call fails we
 * never throw, so a status signal can never break the host agent.
 */

const { spawnSync } = require('child_process');
const fs = require('fs');

const FALLBACK_BINARIES = [
  '/Applications/cmux.app/Contents/Resources/bin/cmux',
  `${process.env.HOME || ''}/Applications/cmux.app/Contents/Resources/bin/cmux`,
];

let _cachedBinary;

/** Resolve the cmux binary path, or null if not found. */
function resolveBinary() {
  if (_cachedBinary !== undefined) return _cachedBinary;

  // 1. On PATH?
  const which = spawnSync('command -v cmux', {
    shell: true,
    encoding: 'utf8',
  });
  if (which.status === 0) {
    const p = (which.stdout || '').trim().split('\n')[0];
    if (p) {
      _cachedBinary = p;
      return p;
    }
  }

  // 2. Known app-bundle locations.
  for (const cand of FALLBACK_BINARIES) {
    try {
      fs.accessSync(cand, fs.constants.X_OK);
      _cachedBinary = cand;
      return cand;
    } catch (_) {
      /* keep looking */
    }
  }

  _cachedBinary = null;
  return null;
}

/** True when we appear to be running inside a cmux pane. */
function insideCmux() {
  return Boolean(process.env.CMUX_WORKSPACE_ID);
}

/**
 * The workspace this process belongs to. Prefer the env fingerprint
 * (the *caller* workspace, zero socket round-trip); fall back to
 * `cmux identify` which returns the caller workspace authoritatively.
 */
function currentWorkspace() {
  if (process.env.CMUX_WORKSPACE_ID) return process.env.CMUX_WORKSPACE_ID;

  const bin = resolveBinary();
  if (!bin) return null;
  const res = spawnSync(bin, ['identify'], { encoding: 'utf8', timeout: 4000 });
  if (res.status !== 0 || !res.stdout) return null;
  try {
    const data = JSON.parse(res.stdout);
    return (data.caller && data.caller.workspace_ref) || null;
  } catch (_) {
    return null;
  }
}

/** Run a cmux subcommand best-effort. Returns {ok, stdout, stderr}. */
function run(args, { timeout = 6000 } = {}) {
  const bin = resolveBinary();
  if (!bin) return { ok: false, stdout: '', stderr: 'cmux binary not found' };
  const res = spawnSync(bin, args, { encoding: 'utf8', timeout });
  return {
    ok: res.status === 0,
    stdout: res.stdout || '',
    stderr: res.stderr || '',
  };
}

function withWorkspace(args, workspace) {
  const ws = workspace || currentWorkspace();
  if (ws) return args.concat(['--workspace', ws]);
  return args;
}

// --- High-level operations -------------------------------------------------

function setColor(color, workspace) {
  return run(
    withWorkspace(
      ['workspace-action', '--action', 'set-color', '--color', String(color)],
      workspace,
    ),
  );
}

function clearColor(workspace) {
  return run(
    withWorkspace(['workspace-action', '--action', 'clear-color'], workspace),
  );
}

function setDescription(text, workspace) {
  return run(
    withWorkspace(
      ['workspace-action', '--action', 'set-description', '--description', String(text)],
      workspace,
    ),
  );
}

function rename(title, workspace) {
  return run(
    withWorkspace(
      ['workspace-action', '--action', 'rename', '--title', String(title)],
      workspace,
    ),
  );
}

function setStatus(key, value, { icon, color, priority } = {}, workspace) {
  let args = ['set-status', String(key), String(value)];
  if (icon) args.push('--icon', String(icon));
  if (color) args.push('--color', String(color));
  if (priority != null) args.push('--priority', String(priority));
  return run(withWorkspace(args, workspace));
}

function clearStatus(key, workspace) {
  return run(withWorkspace(['clear-status', String(key)], workspace));
}

function notify({ title, subtitle, body } = {}, workspace) {
  let args = ['notify', '--title', String(title || 'cmux')];
  if (subtitle) args.push('--subtitle', String(subtitle));
  if (body) args.push('--body', String(body));
  return run(withWorkspace(args, workspace));
}

function triggerFlash(workspace) {
  return run(withWorkspace(['trigger-flash'], workspace));
}

function listWorkspaces() {
  return run(['list-workspaces']);
}

module.exports = {
  resolveBinary,
  insideCmux,
  currentWorkspace,
  run,
  setColor,
  clearColor,
  setDescription,
  rename,
  setStatus,
  clearStatus,
  notify,
  triggerFlash,
  listWorkspaces,
};
