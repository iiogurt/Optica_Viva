// Rolling shutter on a live camera feed. A rolling-shutter sensor reads its rows one after another,
// so row y shows the scene at time t − (y/H)·T_readout. With a buffer of recent camera frames
// (each with its capture time), every output row is taken from the scene at its own time, blended
// linearly between the two buffered frames around it. Pure: frames are RGBA byte arrays.

// frames: [{ t, data }] in any order (t in ms, data = Uint8ClampedArray W·H·4); now: the time of the
// top row; readout: top-to-bottom delay in ms; dir: 'down' (rows) or 'right' (columns).
export function composeRolling(frames, W, H, now, readout, dir = 'down', out = new Uint8ClampedArray(W * H * 4)) {
  const fs = [...frames].sort((a, b) => b.t - a.t); // newest first
  if (!fs.length) return out;
  const lines = dir === 'down' ? H : W;
  for (let i = 0; i < lines; i++) {
    const tt = now - (lines > 1 ? i / (lines - 1) : 0) * readout;
    // the newest frame not later than tt, and the next newer one
    let k = fs.findIndex((f) => f.t <= tt);
    let a, b, u;
    if (k === -1) { a = b = fs[fs.length - 1]; u = 0; } // older than the buffer: the oldest frame
    else if (k === 0) { a = b = fs[0]; u = 0; } // at or after the newest frame
    else { a = fs[k]; b = fs[k - 1]; u = (tt - a.t) / (b.t - a.t || 1); }
    if (dir === 'down') {
      const o = i * W * 4;
      for (let j = 0; j < W * 4; j++) out[o + j] = a.data[o + j] + (b.data[o + j] - a.data[o + j]) * u;
    } else {
      for (let y = 0; y < H; y++) { const o = (y * W + i) * 4; for (let c = 0; c < 4; c++) out[o + c] = a.data[o + c] + (b.data[o + c] - a.data[o + c]) * u; }
    }
  }
  return out;
}

// How many frames the buffer must hold for a readout time at a camera frame period (both in ms).
export const framesNeeded = (readout, period) => Math.min(120, Math.ceil(readout / Math.max(1, period)) + 2);
