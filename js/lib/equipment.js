// Real equipment presets shared by the laboratories and missions: camera bodies (sensor size and
// pixel count from the makers' specifications), planetary cameras (pixel pitch) and telescopes
// (aperture and focal length). Generic formats stay in sensors.js.
import { SENSORS } from './sensors.js';

// Sensor width × height (mm) and effective megapixels.
export const CAMERAS = {
  a7iv: { name: 'Sony α7 IV', w: 35.9, h: 23.9, mp: 33.0 },
  a7siii: { name: 'Sony α7S III', w: 35.6, h: 23.8, mp: 12.1 },
  r5: { name: 'Canon EOS R5', w: 36.0, h: 24.0, mp: 45.0 },
  z8: { name: 'Nikon Z8', w: 35.9, h: 23.9, mp: 45.7 },
  gfx100ii: { name: 'Fujifilm GFX100 II', w: 43.8, h: 32.9, mp: 102 },
  xt5: { name: 'Fujifilm X-T5', w: 23.5, h: 15.6, mp: 40.2 },
  r7: { name: 'Canon EOS R7', w: 22.3, h: 14.8, mp: 32.5 },
  om1: { name: 'OM System OM-1', w: 17.4, h: 13.0, mp: 20.4 },
  rx100: { name: 'Sony RX100 VII', w: 13.2, h: 8.8, mp: 20.1 },
};
// Planetary and astronomy cameras: pixel pitch (µm) and resolution.
export const ASTROCAMS = {
  asi224: { name: 'ZWO ASI224MC', pitch: 3.75, nx: 1304, ny: 976 },
  asi462: { name: 'ZWO ASI462MC', pitch: 2.9, nx: 1936, ny: 1096 },
  asi585: { name: 'ZWO ASI585MC', pitch: 2.9, nx: 3840, ny: 2160 },
  asi678: { name: 'ZWO ASI678MC', pitch: 2.0, nx: 3840, ny: 2160 },
};
// Telescopes: aperture and focal length (mm).
export const TELESCOPES = {
  redcat51: { name: 'William Optics RedCat 51', D: 51, f: 250 },
  ed80: { name: 'Sky-Watcher Evostar 80ED', D: 80, f: 600 },
  dob8: { name: 'Sky-Watcher 200P (8″ Newtonian)', D: 200, f: 1200 },
  rasa8: { name: 'Celestron RASA 8', D: 203, f: 400 },
  c8: { name: 'Celestron C8', D: 203, f: 2032 },
  c925: { name: 'Celestron C9.25', D: 235, f: 2350 },
  c11: { name: 'Celestron C11', D: 280, f: 2800 },
};

// Options for a camera select: generic formats first, then real bodies (keys "cam:<id>").
export const cameraOptions = (formats) => [...formats.map((k) => [k, SENSORS[k].name]), ...Object.entries(CAMERAS).map(([k, c]) => ['cam:' + k, `${c.name} (${c.mp} MP)`])];
// A format key or a "cam:<id>" key → { name, w, h, mp }.
export const resolveCamera = (key) => (key.startsWith('cam:') ? CAMERAS[key.slice(4)] : SENSORS[key]);
export const pitchOf = (c) => Math.sqrt((c.w * c.h) / (c.mp * 1e6)) * 1000; // µm
