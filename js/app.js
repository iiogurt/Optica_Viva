// Optica Viva — router and module registry.
import { h } from './lib/ui.js';

// Laboratories that are implemented; the rest show an 'under construction' notice.
export const READY = new Set(['home', 'foundations', 'raytracer', 'dof', 'psf', 'zernike', 'chromatic', 'sensor', 'projection', 'mtf', 'bokeh', 'flare', 'seeing']);

export const MODULES = [
  { id: 'home', group: 'Overview', title: 'Introduction', c: '#ffb547' },
  { id: 'foundations', group: 'Overview', title: 'Physical foundations', c: '#ffb547', blurb: 'From Maxwell to Fourier optics: the four models of light every simulation here is built on.' },
  { id: 'catalogue', group: 'Overview', title: 'Catalogue of phenomena', c: '#ffb547', blurb: 'An exhaustive, searchable atlas of optical effects and real-world imaging challenges with their governing equations.' },

  { id: 'raytracer', group: 'Geometric optics', title: 'Real-lens ray tracing', c: '#ffd27a', blurb: 'Exact 3-D Snell ray tracing through real prescriptions: spherical aberration, coma, field curvature and the diffraction PSF of the traced wavefront.' },
  { id: 'dof', group: 'Geometric optics', title: 'Depth of field', c: '#ffd27a', blurb: 'Circle of confusion, hyperfocal distance and a physically framed synthetic photograph that refocuses live.' },
  { id: 'sensor', group: 'Geometric optics', title: 'Sensor size & equivalence', c: '#ffd27a', blurb: 'Crop factor, field of view, equivalent aperture, photon budget and diffraction across formats from phones to IMAX.' },
  { id: 'projection', group: 'Geometric optics', title: 'Fisheye vs rectilinear', c: '#ffd27a', blurb: 'Five projection mappings rendered by inverse ray-casting, with Tissot indicatrices showing local distortion.' },
  { id: 'perspective', group: 'Geometric optics', title: 'Perspective & distortion', c: '#ffd27a', blurb: 'Why perspective depends only on position. Dolly zoom, compression, and Brown–Conrady lens distortion.' },
  { id: 'tiltshift', group: 'Geometric optics', title: 'Tilt–shift & Scheimpflug', c: '#ffd27a', blurb: 'Plane-of-focus geometry, the hinge rule, the depth-of-field wedge, a miniature-effect render and keystone correction.' },
  { id: 'vignetting', group: 'Geometric optics', title: 'Vignetting & relative illumination', c: '#ffd27a', blurb: 'cos⁴ law, mechanical (optical) vignetting by pupil overlap, and pixel acceptance angle.' },

  { id: 'psf', group: 'Wave optics', title: 'Diffraction & the PSF', c: '#6ad7ff', blurb: 'Fraunhofer diffraction by FFT: Airy disks, aperture-blade starbursts and polychromatic PSFs of Hubble, JWST and the ELT.' },
  { id: 'zernike', group: 'Wave optics', title: 'Wavefront aberrations', c: '#6ad7ff', blurb: 'Zernike modes, interferograms, Strehl ratio vs Maréchal, and through-focus PSFs.' },
  { id: 'mtf', group: 'Wave optics', title: 'Sharpness: MTF & resolution', c: '#6ad7ff', blurb: 'Optical transfer function, pixel aperture, OLPF, Nyquist and Rayleigh, applied to a Siemens star.' },
  { id: 'chromatic', group: 'Wave optics', title: 'Chromatic aberration', c: '#6ad7ff', blurb: 'Sellmeier dispersion, Abbe diagram, achromats and apochromats, LoCA fringing and lateral colour.' },
  { id: 'bokeh', group: 'Wave optics', title: 'Bokeh', c: '#6ad7ff', blurb: 'Defocus kernels from blade geometry, cat-eye vignetting, spherical-aberration rims and mirror-lens donuts.' },

  { id: 'flare', group: 'Light, sensor & time', title: 'Flare, ghosts & coatings', c: '#c18cff', blurb: 'Paraxial ghost tracing, Fresnel equations, thin-film coatings by the transfer-matrix method, and diffraction starbursts.' },
  { id: 'sampling', group: 'Light, sensor & time', title: 'Aliasing, moiré & Bayer', c: '#c18cff', blurb: 'Pixel sampling, optical low-pass filters and demosaicing false colour on a zone plate.' },
  { id: 'noise', group: 'Light, sensor & time', title: 'Noise & exposure', c: '#c18cff', blurb: 'Photon transfer: shot, read and dark noise, full-well capacity, dynamic range and ISO, with simulated frames.' },
  { id: 'motion', group: 'Light, sensor & time', title: 'Rolling shutter & time', c: '#c18cff', blurb: 'Rolling-shutter distortion, shutter angle, the wagon-wheel effect and flicker banding.' },

  { id: 'seeing', group: 'Astronomy & space', title: 'Atmospheric seeing & AO', c: '#8fd8ff', blurb: 'Kolmogorov phase screens, Fried parameter, speckle and long-exposure PSFs, and adaptive-optics correction.' },
  { id: 'telescope', group: 'Astronomy & space', title: 'Space telescopes', c: '#8fd8ff', blurb: 'Resolution limits, sampling, light-gathering, and a Lyot coronagraph simulation for exoplanet imaging.' },
  { id: 'lensing', group: 'Astronomy & space', title: 'Gravitational lensing', c: '#8fd8ff', blurb: 'The universe as a lens: Einstein rings, arcs and multiple images by inverse ray-shooting.' },
];

const nav = document.getElementById('nav');
const main = document.getElementById('main');
const sidebar = document.getElementById('sidebar');
document.getElementById('navToggle').addEventListener('click', () => sidebar.classList.toggle('open'));

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

let cleanup = null;
let token = 0;
async function route() {
  const id = (location.hash.replace(/^#\/?/, '').split('?')[0]) || 'home';
  const meta = MODULES.find((m) => m.id === id) || MODULES[0];
  document.querySelectorAll('.nav-link').forEach((a) => a.classList.toggle('active', a.dataset.id === meta.id));
  sidebar.classList.remove('open');
  const my = ++token;
  if (cleanup) { try { cleanup(); } catch (e) { console.error(e); } cleanup = null; }
  main.innerHTML = '';
  const page = h('div.page');
  main.append(page);
  try {
    const mod = await import(`./modules/${meta.id}.js`);
    if (my !== token) return;
    cleanup = (await mod.default(page, meta)) || null;
  } catch (e) {
    console.error(e);
    const missing = /Failed to fetch|Importing a module script failed|error loading dynamically imported module/i.test(e.message);
    page.append(missing
      ? h('header.mod-head', {}, h('div.eyebrow', {}, meta.group), h('h1', {}, meta.title), h('p.lede', {}, meta.blurb || ''),
        h('div.callout', { style: { marginTop: '24px' } }, 'This laboratory is under construction and will arrive in an upcoming release. See CHANGELOG.md for progress.'))
      : h('pre', { style: { color: 'var(--warn)', whiteSpace: 'pre-wrap' } }, 'Failed to load module: ' + e.message + '\n' + (e.stack || '')));
  }
  document.title = meta.id === 'home' ? 'Optica Viva' : `${meta.title} · Optica Viva`;
  window.scrollTo(0, 0);
}

buildNav();
window.addEventListener('hashchange', route);
route();
