// Main-thread API for the compute worker.
//   run(task, args)       → Promise of the task result (worker, or main thread as fallback)
//   latest(channel)       → a runner whose promises resolve only for the newest call on that
//                           channel; superseded calls never resolve, so stale results are dropped
import { TASKS } from './tasks.js';

let worker, nextId = 0;
const pending = new Map();

function getWorker() {
  if (worker !== undefined) return worker;
  try {
    worker = new Worker(new URL('../workers/compute.js', import.meta.url), { type: 'module' });
    worker.onmessage = (e) => {
      const { id, result, error } = e.data, p = pending.get(id);
      if (!p) return;
      pending.delete(id);
      error ? p.reject(new Error(error)) : p.resolve(result);
    };
    worker.onerror = (e) => { // e.g. module workers unsupported: fall back for this and later jobs
      e.preventDefault?.();
      worker = null;
      for (const [id, p] of pending) { pending.delete(id); runLocal(p.task, p.args).then(p.resolve, p.reject); }
    };
  } catch { worker = null; }
  return worker;
}

const runLocal = (task, args) => new Promise((resolve) => setTimeout(() => resolve(TASKS[task](args).result), 0));

export function run(task, args) {
  const w = typeof Worker === 'function' ? getWorker() : null;
  if (!w) return runLocal(task, args);
  const id = ++nextId;
  return new Promise((resolve, reject) => { pending.set(id, { resolve, reject, task, args }); w.postMessage({ id, task, args }); });
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
    pool = Array.from({ length: poolSize() }, () => {
      const w = new Worker(new URL('../workers/compute.js', import.meta.url), { type: 'module' });
      w.onmessage = (e) => {
        const { id, result, error } = e.data, p = pending.get(id);
        if (!p) return;
        pending.delete(id);
        error ? p.reject(new Error(error)) : p.resolve(result);
      };
      w.onerror = (e) => { e.preventDefault?.(); pool = null; };
      return w;
    });
  } catch { pool = null; }
  return pool;
}

// transfer: ArrayBuffers handed to the worker (they become unusable here)
export function runOn(i, task, args, transfer = []) {
  const p = typeof Worker === 'function' ? getPool() : null;
  if (!p) return runLocal(task, args);
  const id = ++nextId;
  return new Promise((resolve, reject) => { pending.set(id, { resolve, reject, task, args }); p[i % p.length].postMessage({ id, task, args }, transfer); });
}
export const parallel = (task, jobs) => Promise.all(jobs.map((args, i) => runOn(i, task, args)));

// Row bands [y0, y1) that split H rows evenly over n workers.
export const rowBands = (H, n = poolSize()) => Array.from({ length: n }, (_, i) => [Math.round((i * H) / n), Math.round(((i + 1) * H) / n)]);
