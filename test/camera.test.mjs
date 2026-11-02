// The camera session never leaves a camera running: late permission after cleanup, failed playback,
// repeated clicks, stop and restart (#190).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { cameraSession } from '../js/lib/camera.js';

const fakeStream = () => { const tr = { stopped: 0, stop() { this.stopped++; } }; return { tr, getTracks: () => [tr] }; };
const deferred = () => { let res, rej; const p = new Promise((a, b) => { res = a; rej = b; }); return { p, res, rej }; };

test('permission granted after the page was cleaned up: the late stream is stopped at once', async () => {
  const d = deferred(), s = fakeStream(), session = cameraSession({ request: () => d.p, play: async () => {} });
  const started = session.start();
  session.dispose(); // the reader leaves while the browser still asks for permission
  d.res(s); await started;
  assert.equal(s.tr.stopped, 1); assert.equal(session.active(), false);
  await session.start(); assert.equal(session.active(), false, 'no restart after dispose');
});

test('playback fails after the stream was granted: its tracks are stopped and the error reported', async () => {
  const s = fakeStream(); let err = null;
  const session = cameraSession({ request: async () => s, play: async () => { throw new Error('NotAllowedError'); }, onError: (e) => (err = e) });
  await session.start();
  assert.equal(s.tr.stopped, 1); assert.equal(session.active(), false); assert.ok(err);
});

test('repeated clicks ask once; stop releases the camera; a later start works again', async () => {
  let asked = 0; const streams = [];
  const session = cameraSession({ request: async () => { asked++; const s = fakeStream(); streams.push(s); return s; }, play: async () => {} });
  await Promise.all([session.start(), session.start(), session.start()]);
  assert.equal(asked, 1); assert.equal(session.active(), true);
  session.stop(); assert.equal(streams[0].tr.stopped, 1); assert.equal(session.active(), false);
  await session.start(); assert.equal(session.active(), true); assert.equal(asked, 2);
  session.dispose(); assert.equal(streams[1].tr.stopped, 1);
});

test('stop while the request is pending: the stream that arrives later is stopped', async () => {
  const d = deferred(), s = fakeStream(), session = cameraSession({ request: () => d.p, play: async () => {} });
  const started = session.start();
  session.stop();
  d.res(s); await started;
  assert.equal(s.tr.stopped, 1); assert.equal(session.active(), false);
});
