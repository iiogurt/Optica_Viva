// Your own camera as a light source for a laboratory: a button that asks for the camera, grabs its
// frames into a small RGBA buffer (centre crop to w × h) and hands each one to onFrame(data, now).
// The video never leaves the device; stop() (called by the page's cleanup) releases the camera.
import { h } from './ui.js';
import { t } from './i18n.js';

export function cameraFeed({ w, h: H, onFrame, onStop = () => {} }) {
  const video = h('video', { muted: true, playsInline: true }), grab = h('canvas', { width: w, height: H }), gctx = grab.getContext('2d', { willReadFrequently: true });
  const note = h('p.note', { role: 'status' }, t('The camera stays on this device: nothing is recorded or sent. Wave a hand or pan the camera.'));
  const button = h('button.btn', { type: 'button', onClick: () => (stream ? stop() : start()) }, t('Use my camera'));
  let stream = null, raf = 0;
  async function start() {
    if (!navigator.mediaDevices?.getUserMedia) { note.textContent = t('This browser offers no camera access.'); return; }
    try {
      stream = await navigator.mediaDevices.getUserMedia({ video: { width: 640, height: 480 }, audio: false });
      video.srcObject = stream; await video.play();
      button.textContent = t('Stop camera');
      raf = requestAnimationFrame(loop);
    } catch (e) { stream = null; note.textContent = t('No camera available ({e}).', { e: e.name || e.message }); }
  }
  function stop() {
    cancelAnimationFrame(raf); raf = 0;
    if (stream) stream.getTracks().forEach((tr) => tr.stop());
    stream = null; video.srcObject = null; button.textContent = t('Use my camera'); onStop();
  }
  function loop(now) {
    raf = requestAnimationFrame(loop);
    if (!stream || video.readyState < 2) return;
    const vw = video.videoWidth, vh = video.videoHeight, s = Math.min(vw / w, vh / H);
    gctx.drawImage(video, (vw - w * s) / 2, (vh - H * s) / 2, w * s, H * s, 0, 0, w, H);
    onFrame(gctx.getImageData(0, 0, w, H).data, now);
  }
  return { button, note, stop, active: () => !!stream };
}
