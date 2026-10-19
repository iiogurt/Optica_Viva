// Exercises with checked answers. Each one draws its numbers from a seeded generator, computes
// the answer with the same functions the laboratory uses, and can set the laboratory's controls
// so that its readouts show the answer. Shown after the simulation on the laboratories listed here.
import { h, setControl } from './ui.js';
import { uniform } from './random.js';
import { hyperfocal, dofLimits } from './optics.js';
import { SENSORS, diag } from './sensors.js';
import { t } from './i18n.js';

const pick = (u, a) => a[Math.floor(u() * a.length)];
const C_FF = diag(SENSORS.ff) / 1500; // mm, the dof laboratory's default criterion
const num = (v, p = 3) => String(+v.toPrecision(p));

export const EXERCISES = {
  dof: [
    {
      id: 'hyperfocal', title: 'Hyperfocal distance',
      gen: (u) => ({ f: pick(u, [20, 24, 28, 35, 50]), N: pick(u, [5.6, 8, 11, 16]) }),
      q: ({ f, N }) => `A ${f} mm lens on a full-frame camera at f/${N}, with the classic circle of confusion c = ${num(C_FF * 1000)} µm. At what distance should you focus so that everything from half that distance to infinity looks sharp?`,
      answer: ({ f, N }) => hyperfocal(f, N, C_FF) / 1000, unit: 'm', tol: 0.03,
      hint: 'The hyperfocal distance is the focal length squared divided by (f-number × circle of confusion), plus the focal length. Keep everything in millimetres.',
      solution: ({ f, N }) => `H = f²/(N c) + f = ${f}² / (${N} × ${num(C_FF, 4)} mm) + ${f} mm = ${num(hyperfocal(f, N, C_FF))} mm ≈ ${num(hyperfocal(f, N, C_FF) / 1000)} m. Everything from ${num(hyperfocal(f, N, C_FF) / 2000)} m to infinity is acceptably sharp.`,
      set: ({ f, N }) => ({ sensor: 'ff', coc: '1500', f, N, s: Math.min(100, +(hyperfocal(f, N, C_FF) / 1000).toPrecision(4)) }),
    },
    {
      id: 'dof-total', title: 'Depth of a portrait',
      gen: (u) => ({ f: pick(u, [50, 85, 105, 135]), N: pick(u, [1.4, 2, 2.8, 4]), s: pick(u, [1.5, 2, 2.5, 3]) }),
      q: ({ f, N, s }) => `A ${f} mm lens at f/${N} on full frame (c = ${num(C_FF * 1000)} µm), focused at ${s} m. How deep is the zone that looks sharp, in centimetres?`,
      answer: ({ f, N, s }) => { const L = dofLimits(f, N, C_FF, s * 1000); return (L.far - L.near) / 10; }, unit: 'cm', tol: 0.05,
      hint: 'Far from the hyperfocal distance, depth of field ≈ 2 N c s² / f². Use millimetres throughout, then convert.',
      solution: ({ f, N, s }) => { const L = dofLimits(f, N, C_FF, s * 1000); return `Near limit s f²/(f² + N c (s − f)) = ${num(L.near / 1000, 4)} m, far limit s f²/(f² − N c (s − f)) = ${num(L.far / 1000, 4)} m, so the depth is ${num((L.far - L.near) / 10)} cm. The shortcut 2 N c s²/f² gives ${num(2 * N * C_FF * (s * 1000) ** 2 / f ** 2 / 10)} cm.`; },
      set: ({ f, N, s }) => ({ sensor: 'ff', coc: '1500', f, N, s }),
    },
  ],
  mtf: [
    {
      id: 'cutoff', title: 'Diffraction cut-off',
      gen: (u) => ({ N: pick(u, [2.8, 4, 5.6, 8, 11, 16, 22]) }),
      q: ({ N }) => `A perfect lens at f/${N} in green light (550 nm). What is the finest pattern, in cycles per millimetre, that it passes with any contrast at all?`,
      answer: ({ N }) => 1 / (0.00055 * N), unit: 'cy/mm', tol: 0.02,
      hint: 'The cut-off frequency is 1 / (wavelength × f-number), with the wavelength in millimetres.',
      solution: ({ N }) => `ν_c = 1/(λN) = 1 / (0.00055 mm × ${N}) = ${num(1 / (0.00055 * N))} cycles/mm.`,
      set: ({ N }) => ({ N, lam: '550', defocus: 0, sa: 0 }),
    },
    {
      id: 'match', title: 'Diffraction meets the pixels',
      gen: (u) => ({ p: pick(u, [2, 2.9, 3.76, 4.3, 5.9]) }),
      q: ({ p }) => `A sensor has ${p} µm pixels. At which f-number does the diffraction cut-off (550 nm) fall to the sensor's Nyquist frequency, the finest pattern the pixels can record?`,
      answer: ({ p }) => (2 * p) / 0.55, unit: 'f-number', tol: 0.03,
      hint: 'Set 1/(λN) equal to 1/(2p) and solve for N.',
      solution: ({ p }) => `1/(λN) = 1/(2p) gives N = 2p/λ = 2 × ${p} µm / 0.55 µm = ${num((2 * p) / 0.55)}.`,
      set: ({ p }) => ({ p, N: Math.min(32, +((2 * p) / 0.55).toPrecision(3)), lam: '550' }),
    },
  ],
  psf: [
    {
      id: 'airy', title: 'Size of a star image',
      gen: (u) => ({ N: pick(u, [2.8, 4, 5.6, 8, 11, 16]) }),
      q: ({ N }) => `A perfect round lens at f/${N} images a star in 550 nm light. How wide, in micrometres, is the bright core out to its first dark ring?`,
      answer: ({ N }) => 2.44 * 0.55 * N, unit: 'µm', tol: 0.03,
      hint: 'The Airy disk diameter is 2.44 × wavelength × f-number.',
      solution: ({ N }) => `d = 2.44 λ N = 2.44 × 0.55 µm × ${N} = ${num(2.44 * 0.55 * N)} µm, or ${num((2.44 * 0.55 * N) / 4.3)} pixels of 4.3 µm.`,
      set: ({ N }) => ({ preset: 'circle', band: 'mono', N }),
    },
    {
      id: 'rayleigh', title: 'Telescope resolution',
      gen: (u) => pick(u, [{ key: 'hubble', name: 'Hubble', D: 2.4 }, { key: 'jwst', name: 'James Webb', D: 6.6 }, { key: 'keck', name: 'Keck', D: 10.95 }, { key: 'elt', name: 'Extremely Large', D: 39.3 }]),
      q: ({ name, D }) => `The ${name} Telescope has a ${D} m aperture. What is its Rayleigh resolution at 550 nm, in milliarcseconds?`,
      answer: ({ D }) => (1.22 * 0.55e-6 / D) * 206265 * 1000, unit: 'mas', tol: 0.03,
      hint: 'θ = 1.22 λ / D in radians; one radian is 206 265 arcseconds.',
      solution: ({ D }) => `θ = 1.22 × 0.55 × 10⁻⁶ m / ${D} m = ${num(1.22 * 0.55 / D)} µrad = ${num((1.22 * 0.55e-6 / D) * 206265 * 1000)} mas.`,
      set: ({ key }) => ({ preset: key, band: 'mono' }),
    },
  ],
  flare: [
    {
      id: 'ghosts', title: 'Counting ghosts',
      gen: (u) => ({ k: pick(u, [4, 6, 8, 10, 12, 14, 16, 20]) }),
      q: ({ k }) => `A lens has ${k} glass–air surfaces. A ghost forms when light reflects off one surface, back off an earlier one, and then reaches the sensor. How many such two-reflection ghosts are there?`,
      answer: ({ k }) => (k * (k - 1)) / 2, unit: 'ghosts', tol: 0,
      hint: 'Every pair of surfaces makes one ghost. How many pairs can you choose from k surfaces?',
      solution: ({ k }) => `Each pair of surfaces gives one ghost: k(k − 1)/2 = ${k} × ${k - 1} / 2 = ${(k * (k - 1)) / 2}.`,
      set: ({ k }) => (k === 10 ? { lens: 'double-gauss' } : k === 6 ? { lens: 'cooke' } : null),
    },
  ],
};

// Read a typed number: accepts a decimal comma and trailing units.
export const parseAnswer = (s) => parseFloat(String(s).trim().replace(/\s/g, '').replace(',', '.'));
export function check(ex, v, typed) {
  const want = ex.answer(v), got = parseAnswer(typed);
  if (!isFinite(got)) return null;
  return ex.tol ? Math.abs(got - want) <= ex.tol * Math.abs(want) : Math.round(got) === Math.round(want) && Math.abs(got - Math.round(got)) < 1e-9;
}

function card(ex, seed0) {
  let seed = seed0, v, tries = 0;
  const q = h('p.ex-q'), input = h('input.ex-in', { type: 'text', inputmode: 'decimal', autocomplete: 'off', 'aria-label': t('Your answer') });
  const verdict = h('p.ex-verdict', { 'aria-live': 'polite' }), sol = h('p.ex-sol');
  const show = h('button.tour-btn', { type: 'button', onClick: () => { sol.textContent = ex.solution(v); sol.hidden = false; } }, t('Show solution'));
  const inLab = h('button.tour-btn', { type: 'button', title: t('Set the controls above so the readouts show this case'), onClick: () => {
    const s = ex.set(v);
    for (const [k, x] of Object.entries(s || {})) if (!setControl(k, x)) console.error(`exercise ${ex.id}: no control "${k}"`);
    (document.querySelector('figure.stage') || document.querySelector('.controls'))?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  } }, t('Set it up in the lab'));
  function fresh() {
    v = ex.gen(uniform(seed));
    tries = 0; q.textContent = ex.q(v); input.value = ''; verdict.textContent = ''; verdict.className = 'ex-verdict';
    sol.hidden = true; inLab.hidden = !ex.set(v);
  }
  const submit = (e) => {
    e.preventDefault();
    const ok = check(ex, v, input.value);
    if (ok === null) { verdict.textContent = t('Type a number.'); return; }
    tries++;
    verdict.className = 'ex-verdict ' + (ok ? 'right' : 'wrong');
    verdict.textContent = ok ? t('Right: {value} {unit}.', { value: num(ex.answer(v), 4), unit: ex.unit }) : tries === 1 ? t('Not yet. Hint:') + ' ' + ex.hint : t('Not yet. Try again, or look at the solution.');
  };
  fresh();
  return h('div.ex', {}, h('h3', {}, ex.title), q,
    h('form.ex-form', { onSubmit: submit }, input, h('span.ex-unit', {}, ex.unit), h('button.tour-btn.primary', { type: 'submit' }, t('Check'))),
    verdict, h('div.ex-tools', {}, show, inLab, h('button.tour-btn', { type: 'button', onClick: () => { seed = (seed + 0x9e3779b9) >>> 0; fresh(); } }, t('New numbers'))), sol);
}

// Called by the router after a page mounts; inserts the exercises before the rule of thumb.
export function exercises(page, id, seed = (Date.now() >>> 0)) {
  const list = EXERCISES[id];
  if (!list) return;
  const el = h('section.block.exercises', { 'aria-label': t('Exercises') }, h('h2', {}, t('Try it yourself')),
    h('p.note', {}, t('Work it out on paper, type your answer, then check it in the laboratory.')),
    h('div.ex-grid', {}, ...list.map((ex, i) => card(ex, seed + i * 7919))));
  const before = page.querySelector('.rung-rule');
  if (before) before.before(el); else page.append(el);
}
