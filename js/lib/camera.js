// Your own camera as a light source for a laboratory: a button that asks for the camera, grabs its
// frames into a small RGBA buffer (centre crop to w × h) and hands each one to onFrame(data, now).
// The video never leaves the device; the page's cleanup calls stop(), which releases the camera.
import { h } from './ui.js';
import { t } from './i18n.js';

// The acquisition state machine, free of the DOM so it can be tested. Only one request runs at a
// time; a stream that arrives after stop() or dispose(), or whose playback fails, has its tracks
// stopped at once, so no camera stays on behind the reader's back. stop() allows a later restart;
// dispose() (the page leaving) refuses any further start.
export function cameraSession({ request, play, onStart = () => {}, onStop = () => {}, onError = () => {} }) {
  let gen = 0, stream = null, pending = false, disposed = false;
  const halt = (s) => { if (s) s.getTracks().forEach((tr) => tr.stop()); };
  async function start() {
    if (pending || stream || disposed) return;
    const my = ++gen;
    pending = true;
    let s = null;
    try {
      s = await request();
      if (my !== gen || disposed) { halt(s); return; }
      await play(s);
      if (my !== gen || disposed) { halt(s); return; }
      stream = s;
      onStart(s);
    } catch (e) {
      halt(s);
      if (my === gen && !disposed) onError(e);
    } finally {
      if (my === gen) pending = false;
    }
  }
  function stop() { gen++; pending = false; const s = stream; stream = null; halt(s); onStop(); }
  function dispose() { disposed = true; stop(); }
  return { start, stop, dispose, active: () => !!stream, pending: () => pending };
}

export function cameraFeed({ w, h: H, onFrame, onStop = () => {} }) {
  const video = h('video', { muted: true, playsInline: true }), grab = h('canvas', { width: w, height: H }), gctx = grab.getContext('2d', { willReadFrequently: true });
  const note = h('p.note', { role: 'status' }, t('The camera stays on this device: nothing is recorded or sent. Wave a hand or pan the camera.'));
  const button = h('button.btn', { type: 'button', onClick: () => (session.active() ? session.stop() : session.start()) }, t('Use my camera'));
  let raf = 0;
  const session = cameraSession({
    request: () => {
      if (!navigator.mediaDevices?.getUserMedia) throw new Error('unsupported');
      return navigator.mediaDevices.getUserMedia({ video: { width: 640, height: 480 }, audio: false });
    },
    play: async (s) => { video.srcObject = s; await video.play(); },
    onStart: () => { button.textContent = t('Stop camera'); raf = requestAnimationFrame(loop); },
    onStop: () => { cancelAnimationFrame(raf); raf = 0; video.srcObject = null; button.textContent = t('Use my camera'); onStop(); },
    onError: (e) => {
      video.srcObject = null;
      note.textContent = e.message === 'unsupported' ? t('This browser offers no camera access.') : t('No camera available ({e}).', { e: e.name || e.message });
    },
  });
  function loop(now) {
    if (!session.active()) { raf = 0; return; }
    raf = requestAnimationFrame(loop);
    if (video.readyState < 2) return;
    const vw = video.videoWidth, vh = video.videoHeight, s = Math.min(vw / w, vh / H);
    gctx.drawImage(video, (vw - w * s) / 2, (vh - H * s) / 2, w * s, H * s, 0, 0, w, H);
    onFrame(gctx.getImageData(0, 0, w, H).data, now);
  }
  // stop() is the page's cleanup: it releases the camera and cancels any request still in flight
  return { button, note, stop: session.dispose, active: session.active };
}
