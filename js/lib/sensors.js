// Image-sensor and film formats (active area in mm, representative resolution).
export const SENSORS = {
  'lf45':   { name: 'Large format 4×5″ film', w: 120, h: 96, mp: 400, kind: 'film' },
  'imax':   { name: 'IMAX 15/70 film', w: 70.41, h: 52.63, mp: 200, kind: 'cine' },
  'mf':     { name: 'Medium format 44×33', w: 43.8, h: 32.9, mp: 102 },
  'ff':     { name: 'Full frame 36×24', w: 36, h: 24, mp: 45 },
  's35':    { name: 'Super 35 (cine)', w: 24.89, h: 18.66, mp: 18, kind: 'cine' },
  'apsc':   { name: 'APS-C 23.5×15.6', w: 23.5, h: 15.6, mp: 26 },
  'mft':    { name: 'Micro Four Thirds', w: 17.3, h: 13.0, mp: 20 },
  'one':    { name: '1″ type', w: 13.2, h: 8.8, mp: 20 },
  'phone':  { name: 'Phone main 1/1.3″', w: 9.8, h: 7.35, mp: 50 },
  'phone2': { name: 'Phone tele 1/3.5″', w: 4.0, h: 3.0, mp: 12 },
};
export const FF_DIAG = Math.hypot(36, 24);
export const diag = (s) => Math.hypot(s.w, s.h);
export const crop = (s) => FF_DIAG / diag(s);
export const pitchUm = (s) => Math.sqrt((s.w * s.h) / (s.mp * 1e6)) * 1000;
