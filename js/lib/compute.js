// Main-thread API for the compute worker.
//   run(task, args)       → Promise of the task result (worker, or main thread as fallback)
//   latest(channel)       → a runner whose promises resolve only for the newest call on that
//                           channel; superseded calls never resolve, so stale results are dropped
import { TASKS } from './tasks.js';

let worker, nextId = 0;
const pending = new Map();

// A job is settled exactly once: its entry leaves `pending` before resolve or reject.
function settle(id, ok, value) {
  const p = pending.get(id);
  if (!p) return;
  pending.delete(id);
  ok ? p.resolve(value) : p.reject(value);
}
const onReply = (e) => { const { id, result, error } = e.data; settle(id, !error, error ? new Error(error) : result); };
// Jobs of a worker that failed: re-run on the main thread, unless their buffers were handed over
// (transferred data is gone, so such a job cannot be repeated and is rejected).
function rescue(w) {
  for (const [id, p] of pending) {
    if (p.worker !== w) continue;
    if (p.transfer && p.transfer.length) settle(id, false, new Error(`compute worker failed during ${p.task}`));
    else { pending.delete(id); runLocal(p.task, p.args).then(p.resolve, p.reject); }
  }
}
// Post a job to worker w, or reject it if the message cannot be sent (e.g. uncloneable data).
function post(w, task, args, transfer = []) {
  const id = ++nextId;
  return new Promise((resolve, reject) => {
    pending.set(id, { resolve, reject, task, args, worker: w, transfer });
    try { w.postMessage({ id, task, args }, transfer); } catch (e) { settle(id, false, e); }
  });
}

function getWorker() {
  if (worker !== undefined) return worker;
  try {
    const w = new Worker(new URL('../workers/compute.js', import.meta.url), { type: 'module' });
    w.onmessage = onReply;
    w.onerror = (e) => { // e.g. module workers unsupported: fall back for this and later jobs
      e.preventDefault?.();
      worker = null;
      w.terminate?.();
      rescue(w);
    };
    worker = w;
  } catch { worker = null; }
  return worker;
}

// The main-thread fallback; an exception in the task rejects the promise.
const runLocal = (task, args) => new Promise((resolve, reject) => setTimeout(() => {
  try {
    if (typeof TASKS[task] !== 'function') throw new Error(`unknown compute task ${task}`);
    resolve(TASKS[task](args).result);
  } catch (e) { reject(e); }
}, 0));

export function run(task, args) {
  const w = typeof Worker === 'function' ? getWorker() : null;
  return w ? post(w, task, args) : runLocal(task, args);
}

const channels = new Map();
export function latest(channel) {
  return (task, args) => {
    const ticket = (channels.get(channel) || 0) + 1;
    channels.set(channel, ticket);
    return new Promise((resolve, reject) => run(task, args).then(
      (r) => { if (channels.get(channel) === ticket) resolve(r); },
      (e) => { if (channels.get(channel) === ticket) reject(e); }));
  };
}

// ── Worker pool for parallel work ─────────────────────────────────────────────────────────
// Up to four workers (one core is left to the page). runOn(i, …) sends a task to pool worker i,
// so a task can find there what an earlier task cached (see the tilt–shift tasks); parallel()
// spreads a list of jobs over the pool. Without workers both run on the main thread.
let pool;
export const poolSize = () => (typeof Worker === 'function' ? Math.max(1, Math.min(4, (navigator.hardwareConcurrency || 2) - 1)) : 1);
function getPool() {
  if (pool !== undefined) return pool;
  try {
    const ws = Array.from({ length: poolSize() }, () => new Worker(new URL('../workers/compute.js', import.meta.url), { type: 'module' }));
    for (const w of ws) {
      w.onmessage = onReply;
      // a failed worker is terminated and its jobs rescued; later jobs run on the main thread
      w.onerror = (e) => { e.preventDefault?.(); pool = null; w.terminate?.(); rescue(w); };
    }
    pool = ws;
  } catch { pool = null; }
  return pool;
}

// transfer: ArrayBuffers handed to the worker (they become unusable here)
export function runOn(i, task, args, transfer = []) {
  const p = typeof Worker === 'function' ? getPool() : null;
  return p ? post(p[i % p.length], task, args, transfer) : runLocal(task, args);
}
export const parallel = (task, jobs) => Promise.all(jobs.map((args, i) => runOn(i, task, args)));

// Row bands [y0, y1) that split H rows evenly over n workers.
export const rowBands = (H, n = poolSize()) => Array.from({ length: n }, (_, i) => [Math.round((i * H) / n), Math.round(((i + 1) * H) / n)]);
