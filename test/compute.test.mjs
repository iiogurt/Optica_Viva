// The compute API settles every promise: local task exceptions, a failing pool or single worker,
// and messages that cannot be posted (#191). A fake Worker stands in for the browser's.
import { test } from 'node:test';
import assert from 'node:assert/strict';

const SIM = { nx: 30, ny: 30, lam: 8, scene: 'film', p: { w: 0, n: 1 } }; // a cheap real task: waveInit
const within = (p, ms = 3000) => Promise.race([p, new Promise((_, rej) => setTimeout(() => rej(new Error('still pending')), ms))]);
let fresh = 0;
const load = () => import(`../js/lib/compute.js?case=${++fresh}`);

class FakeWorker {
  static all = [];
  static throwOnPost = false;
  constructor() { this.posted = []; this.terminated = false; FakeWorker.all.push(this); }
  postMessage(m) { if (FakeWorker.throwOnPost) throw new Error('DataCloneError'); this.posted.push(m); }
  terminate() { this.terminated = true; }
  crash() { this.onerror({ preventDefault() {} }); }
}

test('main thread: a task that throws, or an unknown task, rejects instead of hanging', async () => {
  delete globalThis.Worker;
  const C = await load();
  await assert.rejects(within(C.run('__no_such_task__', {})), /unknown compute task/);
  await assert.rejects(within(C.run('waveInit', { nx: 10, ny: 10, lam: 8, scene: 'nonsense' })));
  const ok = await within(C.run('waveInit', SIM));
  assert.ok(ok.eps.length === 900);
});

test('pool worker crash: its jobs are re-run locally, transferred jobs rejected, the worker terminated', async () => {
  globalThis.Worker = FakeWorker; FakeWorker.all = []; // Node's own navigator gives hardwareConcurrency
  const C = await load();
  const a = C.runOn(0, 'waveInit', SIM), b = C.runOn(0, 'waveInit', SIM, [new ArrayBuffer(8)]);
  const w = FakeWorker.all[0], bRejected = assert.rejects(within(b), /compute worker failed/);
  w.crash();
  assert.ok(w.terminated);
  const r = await within(a); assert.equal(r.eps.length, 900);
  await bRejected;
  // later jobs run on the main thread
  const later = await within(C.runOn(1, 'waveInit', SIM)); assert.equal(later.eps.length, 900);
});

test('single worker crash while a job is pending: it settles from the main-thread fallback', async () => {
  globalThis.Worker = FakeWorker; FakeWorker.all = [];
  const C = await load();
  const job = C.run('waveInit', SIM);
  FakeWorker.all[0].crash();
  const r = await within(job); assert.equal(r.eps.length, 900);
});

test('a message that cannot be posted rejects its job and leaves nothing pending', async () => {
  globalThis.Worker = FakeWorker; FakeWorker.all = []; FakeWorker.throwOnPost = true;
  const C = await load();
  await assert.rejects(within(C.runOn(0, 'waveInit', SIM)), /DataCloneError/);
  FakeWorker.throwOnPost = false;
  delete globalThis.Worker;
});
