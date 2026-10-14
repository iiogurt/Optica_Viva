// Optica Viva — router and module registry.
import { h, resetUrlState } from './lib/ui.js';
import { ladder } from './lib/page.js';
import { glossary } from './lib/glossary.js';

// Laboratories that are implemented; the rest show an 'under construction' notice.
export const READY = new Set(['home', 'mission-milkyway', 'mission-jupiter', 'foundations', 'raytracer', 'dof', 'psf', 'zernike', 'chromatic', 'sensor', 'projection', 'mtf', 'bokeh', 'flare', 'seeing', 'lucky', 'wfs', 'spectro', 'interferometry', 'detectors', 'adc', 'stacking', 'starshade', 'fieldpsf', 'telescope', 'lensing', 'sampling', 'noise', 'hdr', 'colour', 'cinema', 'motion', 'shake', 'film', 'vp', 'vignetting', 'perspective', 'tiltshift', 'panorama', 'macro', 'eye', 'polarisation', 'catalogue']);

export const MODULES = [
  { id: 'home', group: 'Overview', title: 'Introduction', c: '#ffb547' },
  { id: 'foundations', group: 'Overview', title: 'Physical foundations', c: '#ffb547', blurb: 'From Maxwell to Fourier optics: the four models of light every simulation here is built on.' },
  { id: 'catalogue', group: 'Overview', title: 'Catalogue of phenomena', c: '#ffb547', blurb: 'An exhaustive, searchable atlas of optical effects and real-world imaging challenges with their governing equations.' },

  { id: 'mission-milkyway', group: 'Missions', title: 'Photograph the Milky Way', c: '#9db4ff', blurb: 'A plan for your camera and sky: the longest exposure before stars trail, the right ISO, and how many frames to stack.' },
  { id: 'mission-jupiter', group: 'Missions', title: 'Image Jupiter from your garden', c: '#e8b48a', blurb: 'The focal ratio for your camera, frames short enough to freeze the air, how long before Jupiter\'s rotation blurs it, and when you need a dispersion corrector.' },
  { id: 'raytracer', group: 'Geometric optics', title: 'Real-lens ray tracing', c: '#ffd27a', blurb: 'Exact 3-D Snell ray tracing through real prescriptions: spherical aberration, coma, field curvature and the diffraction PSF of the traced wavefront.' },
  { id: 'dof', group: 'Geometric optics', title: 'Depth of field', c: '#ffd27a', blurb: 'Circle of confusion, hyperfocal distance and a physically framed synthetic photograph that refocuses live.' },
  { id: 'sensor', group: 'Geometric optics', title: 'Sensor size & equivalence', c: '#ffd27a', blurb: 'Crop factor, field of view, equivalent aperture, photon budget and diffraction across formats from phones to IMAX.' },
  { id: 'projection', group: 'Geometric optics', title: 'Fisheye vs rectilinear', c: '#ffd27a', blurb: 'Five projection mappings rendered by inverse ray-casting, with Tissot indicatrices showing local distortion.' },
  { id: 'perspective', group: 'Geometric optics', title: 'Perspective & distortion', c: '#ffd27a', blurb: 'Why perspective depends only on position. Dolly zoom, compression, and Brown–Conrady lens distortion.' },
  { id: 'tiltshift', group: 'Geometric optics', title: 'Tilt–shift & Scheimpflug', c: '#ffd27a', blurb: 'Plane-of-focus geometry, the hinge rule, the depth-of-field wedge, a miniature-effect render and keystone correction.' },
  { id: 'panorama', group: 'Geometric optics', title: 'Panorama & parallax', c: '#ffd27a', blurb: 'Why panoramas must rotate about the entrance pupil, not the nodal point: ray-cast frames stitched with and without parallax.' },
  { id: 'macro', group: 'Geometric optics', title: 'Macro & magnification', c: '#ffd27a', blurb: 'Bellows factor and pupil magnification, depth of field in microns, the diffraction-limited optimum aperture and focus stacking on a tilted ruler.' },
  { id: 'eye', group: 'Geometric optics', title: 'The human eye', c: '#ffd27a', blurb: "Le Grand's schematic eye, its chromatic aberration, the best pupil size, cone sampling, and where the circle of confusion comes from." },
  { id: 'vignetting', group: 'Geometric optics', title: 'Vignetting & relative illumination', c: '#ffd27a', blurb: 'cos⁴ law, mechanical (optical) vignetting by pupil overlap, and pixel acceptance angle.' },

  { id: 'psf', group: 'Wave optics', title: 'Diffraction & the PSF', c: '#6ad7ff', blurb: 'Fraunhofer diffraction by FFT: Airy disks, aperture-blade starbursts and polychromatic PSFs of Hubble, JWST and the ELT.' },
  { id: 'zernike', group: 'Wave optics', title: 'Wavefront aberrations', c: '#6ad7ff', blurb: 'Zernike modes, interferograms, Strehl ratio vs Maréchal, and through-focus PSFs.' },
  { id: 'mtf', group: 'Wave optics', title: 'Sharpness: MTF & resolution', c: '#6ad7ff', blurb: 'Optical transfer function, pixel aperture, OLPF, Nyquist and Rayleigh, applied to a Siemens star.' },
  { id: 'chromatic', group: 'Wave optics', title: 'Chromatic aberration', c: '#6ad7ff', blurb: 'Sellmeier dispersion, Abbe diagram, achromats and apochromats, LoCA fringing and lateral colour.' },
  { id: 'bokeh', group: 'Wave optics', title: 'Bokeh', c: '#6ad7ff', blurb: 'Defocus kernels from blade geometry, cat-eye vignetting, spherical-aberration rims and mirror-lens donuts.' },
  { id: 'polarisation', group: 'Wave optics', title: 'Polarisation', c: '#6ad7ff', blurb: 'Stokes vectors and Mueller matrices: Malus\'s law, Brewster reflections, the polarised Rayleigh sky and a polariser removing glare from a lake.' },

  { id: 'flare', group: 'Light, sensor & time', title: 'Flare, ghosts & coatings', c: '#c18cff', blurb: 'Paraxial ghost tracing, Fresnel equations, thin-film coatings by the transfer-matrix method, and diffraction starbursts.' },
  { id: 'sampling', group: 'Light, sensor & time', title: 'Aliasing, moiré & Bayer', c: '#c18cff', blurb: 'Pixel sampling, optical low-pass filters and demosaicing false colour on a zone plate.' },
  { id: 'noise', group: 'Light, sensor & time', title: 'Noise & exposure', c: '#c18cff', blurb: 'Photon transfer: shot, read and dark noise, full-well capacity, dynamic range and ISO, with simulated frames.' },
  { id: 'hdr', group: 'Light, sensor & time', title: 'Filters & HDR', c: '#c18cff', blurb: 'Neutral-density and graduated filters, exposure bracketing merged with inverse-variance weights, tone mapping and exposure fusion.' },
  { id: 'colour', group: 'Light, sensor & time', title: 'Colour science', c: '#c18cff', blurb: 'Spectra to colour: CIE colorimetry, correlated colour temperature, the colour rendering index of LEDs and fluorescents, computed from CIE tables.' },
  { id: 'cinema', group: 'Light, sensor & time', title: 'Anamorphic & cinema lenses', c: '#c18cff', blurb: 'Squeeze and oval bokeh, coating-coloured streak flares, focus breathing of real focusing schemes, and T-stops from surface transmission.' },
  { id: 'motion', group: 'Light, sensor & time', title: 'Rolling shutter & time', c: '#c18cff', blurb: 'Rolling-shutter distortion, shutter angle, the wagon-wheel effect and flicker banding.' },
  { id: 'shake', group: 'Light, sensor & time', title: 'Camera shake & stabilisation', c: '#c18cff', blurb: 'Hand-held angular motion, the reciprocal rule as a probability, and what a gyro-driven stabiliser can and cannot remove.' },
  { id: 'film', group: 'Light, sensor & time', title: 'Film & grain', c: '#c18cff', blurb: 'Silver-halide grains as threshold photon counters: the H&D curve, grain vs speed, Selwyn granularity, DQE and reciprocity failure.' },
  { id: 'vp', group: 'Light, sensor & time', title: 'Virtual production', c: '#c18cff', blurb: 'LED-wall moiré from pixel pitch, defocus and photosite sampling, and PWM refresh banding with a rolling shutter.' },

  { id: 'seeing', group: 'Astronomy & space', title: 'Atmospheric seeing & AO', c: '#8fd8ff', blurb: 'Kolmogorov phase screens, Fried parameter, speckle and long-exposure PSFs, and adaptive-optics correction.' },
  { id: 'lucky', group: 'Astronomy & space', title: 'Lucky imaging', c: '#8fd8ff', blurb: "Thousands of short exposures through turbulence, ranked by Strehl, re-centred and added: Fried's probability of a lucky frame." },
  { id: 'wfs', group: 'Astronomy & space', title: 'Wavefront sensing & AO loop', c: '#8fd8ff', blurb: 'A diffraction Shack–Hartmann sensor with photon and read noise, least-squares modal reconstruction and a closed adaptive-optics loop with its error budget.' },
  { id: 'spectro', group: 'Astronomy & space', title: 'Spectroscopy', c: '#8fd8ff', blurb: 'Prisms and gratings, resolving power R = mN, blaze and overlapping orders, and the spectra of the Sun and of laboratory lamps.' },
  { id: 'interferometry', group: 'Astronomy & space', title: 'Interferometry & aperture synthesis', c: '#8fd8ff', blurb: "Michelson's stellar interferometer and van Cittert–Zernike, Earth-rotation u-v coverage of the VLA, VLTI and EHT, dirty beams and CLEAN." },
  { id: 'detectors', group: 'Astronomy & space', title: 'Detector physics in space', c: '#8fd8ff', blurb: 'Up-the-ramp sampling and cosmic-ray rejection, inter-pixel capacitance, charge-transfer inefficiency trails and persistence.' },
  { id: 'adc', group: 'Astronomy & space', title: 'Atmospheric dispersion & ADC', c: '#8fd8ff', blurb: "The atmosphere as a weak prism: Edlén's refractive index of air, stellar spectra smeared by zenith angle, and the counter-rotating prisms that correct them." },
  { id: 'stacking', group: 'Astronomy & space', title: 'Astrophotography stacking', c: '#8fd8ff', blurb: 'The CCD equation for stacks of sub-exposures: √N, the sky-limited sub length and the cost of light pollution.' },
  { id: 'starshade', group: 'Astronomy & space', title: 'Starshade', c: '#8fd8ff', blurb: 'Fresnel diffraction behind a petalled occulter: the Poisson spot of a round screen, hypergaussian apodisation and 10⁻¹⁰ shadows tens of thousands of kilometres long.' },
  { id: 'fieldpsf', group: 'Astronomy & space', title: 'Field-dependent PSF', c: '#8fd8ff', blurb: 'Seidel sums of Cassegrain, Ritchey–Chrétien and Dall–Kirkham telescopes, PSFs across the field, nodal aberrations of a misaligned secondary and Hubble’s flawed primary.' },
  { id: 'telescope', group: 'Astronomy & space', title: 'Space telescopes', c: '#8fd8ff', blurb: 'Resolution limits, sampling, light-gathering, and a Lyot coronagraph simulation for exoplanet imaging.' },
  { id: 'lensing', group: 'Astronomy & space', title: 'Gravitational lensing', c: '#8fd8ff', blurb: 'The universe as a lens: Einstein rings, arcs and multiple images by inverse ray-shooting.' },
];

const nav = document.getElementById('nav');
const main = document.getElementById('main');
const sidebar = document.getElementById('sidebar');
const navToggle = document.getElementById('navToggle');
navToggle.addEventListener('click', () => navToggle.setAttribute('aria-expanded', String(sidebar.classList.toggle('open'))));

function buildNav() {
  const groups = [...new Set(MODULES.map((m) => m.group))];
  for (const g of groups) {
    nav.append(h('div.nav-group', {},
      h('div.nav-group-title', {}, g),
      ...MODULES.filter((m) => m.group === g).map((m) =>
        h('a.nav-link' + (READY.has(m.id) ? '' : '.soon'), { href: '#/' + (m.id === 'home' ? '' : m.id), 'data-id': m.id, style: { '--c': m.c } }, h('span.nav-dot'), m.title)),
    ));
  }
}

// Pre-filled GitHub issue for the error boundary (no personal data: page, URL state, error, browser).
const issueUrl = (meta, e) => 'https://github.com/iiogurt/Optica_Viva/issues/new?' + new URLSearchParams({
  labels: 'bug', title: `[${meta.id}] ${e.message}`.slice(0, 120),
  body: `**Page:** ${location.href}\n**Browser:** ${navigator.userAgent}\n\n\`\`\`\n${(e.stack || e.message).slice(0, 1500)}\n\`\`\``,
});

let cleanup = null;
let lastId = null;
let token = 0;
async function route() {
  const id = (location.hash.replace(/^#\/?/, '').split('?')[0]) || 'home';
  const meta = MODULES.find((m) => m.id === id) || MODULES[0];
  document.querySelectorAll('.nav-link').forEach((a) => { const on = a.dataset.id === meta.id; a.classList.toggle('active', on); if (on) a.setAttribute('aria-current', 'page'); else a.removeAttribute('aria-current'); });
  sidebar.classList.remove('open');
  navToggle.setAttribute('aria-expanded', 'false');
  const my = ++token;
  if (cleanup) { try { cleanup(); } catch (e) { console.error(e); } cleanup = null; }
  main.innerHTML = '';
  resetUrlState();
  const page = h('div.page');
  main.append(page);
  try {
    const mod = await import(`./modules/${meta.id}.js`);
    if (my !== token) return;
    const done = (await mod.default(page, meta)) || null;
    const unladder = ladder(page);
    const unglossary = meta.id === 'home' || meta.id === 'catalogue' ? () => {} : glossary(page, meta.id, (lab) => MODULES.find((m) => m.id === lab)?.title || lab);
    cleanup = () => { unglossary(); unladder(); if (done) done(); };
  } catch (e) {
    console.error(e);
    const missing = /Failed to fetch|Importing a module script failed|error loading dynamically imported module/i.test(e.message);
    page.append(missing
      ? h('header.mod-head', {}, h('div.eyebrow', {}, meta.group), h('h1', {}, meta.title), h('p.lede', {}, meta.blurb || ''),
        h('div.callout', { style: { marginTop: '24px' } }, 'This laboratory is under construction and will arrive in an upcoming release. See CHANGELOG.md for progress.'))
      : h('div.card', { role: 'alert', style: { marginTop: '24px' } },
        h('h2', { style: { marginTop: 0 } }, 'This laboratory failed to load'),
        h('p.note', {}, 'Please report it so it can be fixed. The link below pre-fills the error details.'),
        h('a', { href: issueUrl(meta, e), target: '_blank', rel: 'noopener' }, 'Report this issue on GitHub →'),
        h('pre', { style: { color: 'var(--warn)', whiteSpace: 'pre-wrap', fontSize: '12px' } }, 'Failed to load module: ' + e.message + '\n' + (e.stack || ''))));
  }
  // remember opened laboratories for the "Start here" ticks (this browser only)
  try { const v = new Set(JSON.parse(localStorage.getItem('ov-visited') || '[]')); v.add(meta.id); localStorage.setItem('ov-visited', JSON.stringify([...v])); } catch { /* storage unavailable */ }
  document.title = meta.id === 'home' ? 'Optica Viva' : `${meta.title} · Optica Viva`;
  if (meta.id !== lastId) window.scrollTo(0, 0);
  lastId = meta.id;
}

buildNav();
// the skip link must not change the hash (that would re-route): focus <main> directly
document.querySelector('.skip-link')?.addEventListener('click', (e) => { e.preventDefault(); main.focus(); });
window.addEventListener('hashchange', route);
route();
