'use strict';

/**
 * Cross-session voice broker for hermes-cmux.
 *
 * v1 is intentionally dependency-light: all cmux panes append work to one JSON
 * queue under the repo-owned state dir, then lazily spawn a singleton drain
 * worker. The worker holds a lock and speaks one item at a time, so two agents
 * cannot talk over each other.
 */

const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');
const { stateDir } = require('../config');

const DEFAULT_TTL_SECONDS = 300;
const DEFAULT_PRIORITY = 50;

function ensureDir() {
  const d = stateDir();
  fs.mkdirSync(d, { recursive: true });
  return d;
}

function queueFile() {
  return path.join(ensureDir(), 'voice-broker-queue.json');
}

function lockFile(name = 'voice-broker') {
  return path.join(ensureDir(), `${name}.lock`);
}

function readQueue() {
  try {
    const parsed = JSON.parse(fs.readFileSync(queueFile(), 'utf8'));
    return Array.isArray(parsed) ? parsed.filter((e) => e && e.type === 'voice') : [];
  } catch (_) {
    return [];
  }
}

function writeQueue(events) {
  const tmp = `${queueFile()}.${process.pid}.${Date.now()}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(events, null, 2) + '\n', 'utf8');
  fs.renameSync(tmp, queueFile());
}

function withLock(name, fn, opts = {}) {
  const file = lockFile(name);
  const staleMs = Math.max(1, opts.staleSeconds || 120) * 1000;
  const deadline = Date.now() + Math.max(1, opts.waitMs || 1500);
  while (true) {
    try {
      const fd = fs.openSync(file, 'wx');
      try {
        fs.writeFileSync(fd, JSON.stringify({ pid: process.pid, ts: Date.now() }) + '\n', 'utf8');
        return fn();
      } finally {
        try { fs.closeSync(fd); } catch (_) {}
        try { fs.unlinkSync(file); } catch (_) {}
      }
    } catch (_) {
      try {
        const stat = fs.statSync(file);
        if (Date.now() - stat.mtimeMs > staleMs) {
          try { fs.unlinkSync(file); } catch (_) {}
          continue;
        }
      } catch (_) {
        continue;
      }
      if (Date.now() >= deadline) return null;
      Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 25);
    }
  }
}

function fresh(events, now = Date.now()) {
  return events.filter((e) => !e.expiresAt || e.expiresAt > now);
}

function compareEvents(a, b) {
  const ap = Number.isFinite(Number(a.priority)) ? Number(a.priority) : DEFAULT_PRIORITY;
  const bp = Number.isFinite(Number(b.priority)) ? Number(b.priority) : DEFAULT_PRIORITY;
  if (bp !== ap) return bp - ap;
  return (Number(a.createdAt) || 0) - (Number(b.createdAt) || 0);
}

function createVoiceEvent({
  workspace,
  text,
  reason = '',
  action = '',
  details = '',
  priority = DEFAULT_PRIORITY,
  ttlSeconds = DEFAULT_TTL_SECONDS,
  dedupeKey = '',
} = {}) {
  const now = Date.now();
  return {
    id: `voice-${now}-${process.pid}-${Math.random().toString(36).slice(2, 10)}`,
    type: 'voice',
    workspace: workspace || 'unknown',
    text: String(text || ''),
    reason: String(reason || ''),
    action: String(action || ''),
    details: String(details || ''),
    priority: Number.isFinite(Number(priority)) ? Number(priority) : DEFAULT_PRIORITY,
    createdAt: now,
    expiresAt: now + Math.max(1, Number(ttlSeconds) || DEFAULT_TTL_SECONDS) * 1000,
    dedupeKey: String(dedupeKey || ''),
  };
}

function enqueue(event) {
  if (!event || !event.text) return { queued: false, reason: 'empty-event' };
  const saved = withLock('voice-broker-queue', () => {
    const now = Date.now();
    let events = fresh(readQueue(), now);
    if (event.dedupeKey) {
      events = events.filter(
        (e) => !(e.workspace === event.workspace && e.dedupeKey === event.dedupeKey),
      );
    }
    events.push(event);
    writeQueue(events);
    return events.length;
  });
  if (saved == null) return { queued: false, reason: 'queue-lock-busy' };
  return { queued: true, id: event.id, queuedCount: saved };
}

function popNext() {
  return withLock('voice-broker-queue', () => {
    const events = fresh(readQueue()).sort(compareEvents);
    const next = events.shift() || null;
    writeQueue(events);
    return next;
  });
}

function status() {
  const events = fresh(readQueue()).sort(compareEvents);
  return {
    queueFile: queueFile(),
    queued: events.length,
    next: events[0] || null,
  };
}

function spawnWorker() {
  const bin = path.resolve(__dirname, '..', '..', 'bin', 'cmux-skills.js');
  try {
    const child = spawn(process.execPath, [bin, 'broker', 'drain', '--worker'], {
      detached: true,
      stdio: 'ignore',
      env: process.env,
    });
    child.on('error', () => {});
    child.unref();
    return true;
  } catch (_) {
    return false;
  }
}

function drain(processEvent, opts = {}) {
  const maxEvents = Math.max(1, Number(opts.maxEvents) || 100);
  return withLock('voice-broker-worker', () => {
    let processed = 0;
    const results = [];
    while (processed < maxEvents) {
      const event = popNext();
      if (!event) break;
      const result = processEvent(event);
      results.push({ id: event.id, result });
      processed += 1;
    }
    return { processed, results, remaining: status().queued };
  }, { waitMs: 100, staleSeconds: opts.lockStaleSeconds || 300 }) || { processed: 0, results: [], remaining: status().queued, reason: 'worker-lock-busy' };
}

module.exports = {
  createVoiceEvent,
  enqueue,
  popNext,
  status,
  spawnWorker,
  drain,
  readQueue,
  queueFile,
};
