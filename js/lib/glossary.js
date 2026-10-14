// Glossary: one-sentence, plain-language definitions of the technical terms used across the pages.
// The first use of each term in a page's text gets a dotted underline; hovering, focusing or tapping
// it shows the definition and, where one exists, a link to the laboratory that simulates it.
// `match` lists regular-expression alternatives (whole words only); an alternative with a capital
// letter, such as an abbreviation, is case-sensitive, the others are not.

export const GLOSSARY = [
  // ── Geometric optics ──
  { term: 'Focal length', match: ['focal lengths?'], lab: 'raytracer', def: 'The distance behind a lens at which it focuses light from very far away. Longer focal lengths magnify more and see a narrower view.' },
  { term: 'Aperture', match: ['apertures?'], lab: 'dof', def: 'The opening that lets light into a lens or telescope. A wider aperture gathers more light and can show finer detail.' },
  { term: 'f-number', match: ['f-numbers?'], lab: 'dof', def: 'The focal length divided by the width of the lens opening, written f/2.8 or f/8. A larger f-number means a smaller opening and less light.' },
  { term: 'Depth of field', match: ['depth of field'], lab: 'dof', def: 'The range of distances in front of and behind the focus that still looks sharp in the picture.' },
  { term: 'Circle of confusion', match: ['circles? of confusion'], lab: 'dof', def: 'The largest blur spot that still looks like a sharp point to a viewer; about 0.03 mm on a full-frame sensor.' },
  { term: 'Hyperfocal distance', match: ['hyperfocal distances?'], lab: 'dof', def: 'The focus distance at which everything from half that distance to infinity looks sharp.' },
  { term: 'Crop factor', match: ['crop factors?'], lab: 'sensor', def: 'How much smaller a sensor is than a full-frame (36 × 24 mm) one, measured along the diagonal.' },
  { term: 'Entrance pupil', match: ['entrance pupils?'], lab: 'panorama', def: 'The image of the lens opening as seen from the front of the lens. Its width and position set how much light enters and the point of perspective.' },
  { term: 'Exit pupil', match: ['exit pupils?'], lab: 'vignetting', def: 'The image of the lens opening as seen from the sensor; light seems to arrive from it.' },
  { term: 'Magnification', match: ['magnifications?'], lab: 'macro', def: 'How large the image on the sensor is compared with the real object; 1 : 1 means life size.' },
  { term: 'Refractive index', match: ['refractive indices', 'refractive index(?:es)?'], lab: 'raytracer', def: 'How much slower light travels in a material than in vacuum, which sets how strongly the material bends light: about 1.5 for glass and 1.33 for water.' },
  { term: 'Paraxial', match: ['paraxial'], lab: 'raytracer', def: 'Describes rays that stay close to the axis and make small angles with it, where the simple lens formulas are accurate.' },
  { term: 'Vignetting', match: ['vignetting'], lab: 'vignetting', def: 'The darkening of an image towards its corners.' },
  { term: 'Perspective', match: ['perspective'], lab: 'perspective', def: 'How the sizes of near and far things compare in a picture; it depends only on where the camera stands.' },
  { term: 'Distortion', match: ['distortion'], lab: 'perspective', def: 'A lens error that bends straight lines in the image, outwards (barrel) or inwards (pincushion), without blurring them.' },
  { term: 'Parallax', match: ['parallax'], lab: 'panorama', def: 'The apparent shift of a near object against a distant background when the viewpoint moves.' },
  // ── Aberrations and wave optics ──
  { term: 'Aberration', match: ['aberrations?'], lab: 'zernike', def: 'Any way in which a real lens or mirror fails to bring light from one point to one point.' },
  { term: 'Spherical aberration', match: ['spherical aberration'], lab: 'raytracer', def: 'An error of round lens surfaces: rays through the edge focus at a different distance from rays through the middle.' },
  { term: 'Coma', match: ['coma'], lab: 'fieldpsf', def: 'An off-axis lens error that turns stars near the edge of the picture into little comet shapes.' },
  { term: 'Astigmatism', match: ['astigmatism'], lab: 'zernike', def: 'A lens error that focuses lines in two directions at different distances, stretching points into short lines or crosses.' },
  { term: 'Field curvature', match: ['field curvature'], lab: 'raytracer', def: 'A lens error in which the sharp image lies on a curved surface, so a flat sensor cannot be in focus everywhere.' },
  { term: 'Chromatic aberration', match: ['chromatic aberrations?'], lab: 'chromatic', def: 'A lens error caused by glass bending each colour differently, which gives coloured fringes.' },
  { term: 'Dispersion', match: ['dispersion'], lab: 'chromatic', def: 'The way a material bends different colours by different amounts, which spreads white light into a spectrum.' },
  { term: 'Abbe number', match: ['abbe numbers?'], lab: 'chromatic', def: 'A measure of how little a glass spreads colours; high values (60 or more) mean low dispersion.' },
  { term: 'Wavefront', match: ['wavefronts?'], lab: 'zernike', def: 'A surface on which light waves are all in step; a perfect lens makes it a sphere centred on the image point.' },
  { term: 'Diffraction', match: ['diffraction'], lab: 'psf', def: 'The spreading of light waves as they pass an edge or an opening; it sets the finest detail any lens can show.' },
  { term: 'Airy disk', match: ['airy disks?', 'airy patterns?'], lab: 'psf', def: 'The bright central spot and faint rings into which a perfect round lens turns a point of light.' },
  { term: 'Point-spread function', match: ['point-spread functions?', 'PSFs?'], lab: 'psf', def: 'The image a lens or telescope makes of a single point of light; every image is built from it.' },
  { term: 'Strehl ratio', match: ['strehl ratios?'], lab: 'zernike', def: 'The peak brightness of a star image compared with what a perfect optical system would give; 1 is perfect, 0.8 counts as diffraction-limited.' },
  { term: 'Diffraction-limited', match: ['diffraction-limited'], lab: 'psf', def: 'So well made that diffraction, not lens errors, sets the sharpness.' },
  { term: 'MTF', match: ['MTF', 'modulation transfer functions?'], lab: 'mtf', def: 'A curve showing how much contrast a lens or camera keeps for patterns of increasing fineness.' },
  { term: 'Interference', match: ['interference'], lab: 'interferometry', def: 'Light waves adding up where their crests meet and cancelling where crest meets trough.' },
  { term: 'Polarisation', match: ['polari[sz]ation', 'polari[sz]ed'], lab: 'polarisation', def: 'The direction in which a light wave vibrates, across its direction of travel.' },
  { term: 'Bokeh', match: ['bokeh'], lab: 'bokeh', def: 'The look of out-of-focus parts of a picture, especially the discs made by points of light.' },
  // ── Light, sensor and time ──
  { term: 'Pixel pitch', match: ['pixel pitch(?:es)?'], lab: 'sampling', def: 'The distance from the centre of one pixel to the next.' },
  { term: 'Nyquist limit', match: ['nyquist(?: limit| frequency)?'], lab: 'sampling', def: 'The finest pattern a grid of pixels can record correctly: one dark and one light line per two pixels.' },
  { term: 'Aliasing', match: ['aliasing', 'aliases'], lab: 'sampling', def: 'Detail too fine for the pixel grid coming back as a false, coarser pattern.' },
  { term: 'Moiré', match: ['moiré'], lab: 'sampling', def: 'Wavy false patterns that appear when a fine regular pattern is recorded by a pixel grid.' },
  { term: 'Bayer filter', match: ['bayer(?: filters?| sensors?| mosaics?)?'], lab: 'sampling', def: 'A grid of red, green and blue filters over the pixels that lets one sensor record colour.' },
  { term: 'Shot noise', match: ['shot noise'], lab: 'noise', def: 'The random scatter in the number of photons that arrive, the main noise in dim light.' },
  { term: 'Read noise', match: ['read noise'], lab: 'noise', def: 'Noise added by the sensor electronics each time a pixel is read out.' },
  { term: 'Signal-to-noise ratio', match: ['signal-to-noise ratios?', 'SNR'], lab: 'noise', def: 'How much larger the real signal is than the random noise; above about 10 a picture looks clean.' },
  { term: 'Dynamic range', match: ['dynamic range'], lab: 'hdr', def: 'The ratio between the brightest and the darkest light a sensor can record in one shot, usually counted in stops.' },
  { term: 'ISO', match: ['ISO'], lab: 'noise', def: 'The camera setting that amplifies the signal; it does not collect more light.' },
  { term: 'Photon', match: ['photons?'], lab: 'noise', def: 'A single packet of light energy. Light is detected one photon at a time.' },
  { term: 'Rolling shutter', match: ['rolling shutters?'], lab: 'motion', def: 'A sensor that reads its picture line by line, so fast motion is recorded at slightly different times in different lines.' },
  { term: 'Metamerism', match: ['metamerism'], lab: 'colour', def: 'Two different spectra that look like the same colour to one viewer or light but not to another.' },
  { term: 'Colour temperature', match: ['colou?r temperatures?'], lab: 'colour', def: 'How warm (orange) or cool (blue) a white light looks, given as the temperature of a glowing body of that colour.' },
  { term: 'Coating', match: ['coatings?'], lab: 'flare', def: 'Thin layers on a lens surface that make reflected light cancel itself, so less light is reflected.' },
  // ── Astronomy and space ──
  { term: 'Seeing', match: ['seeing'], lab: 'seeing', def: 'The blurring of stars by turbulence in the air; also the size of the blurred star image.' },
  { term: 'Fried parameter', match: ['fried parameters?'], lab: 'seeing', def: 'The width of a patch of air that bends light nearly uniformly, 10–20 cm at a good site in visible light.' },
  { term: 'Adaptive optics', match: ['adaptive optics'], lab: 'wfs', def: 'A system that measures the blurring by the air and cancels it with a flexible mirror, hundreds of times per second.' },
  { term: 'Deformable mirror', match: ['deformable mirrors?'], lab: 'wfs', def: 'A thin mirror whose shape is changed by many small actuators to correct a distorted wavefront.' },
  { term: 'Wavefront sensor', match: ['wavefront sensors?', 'shack–hartmann'], lab: 'wfs', def: 'A device that measures how distorted the incoming light is, usually with a grid of tiny lenses.' },
  { term: 'Coronagraph', match: ['coronagraphs?'], lab: 'telescope', def: 'An instrument inside a telescope that blocks a star\'s light so that faint things next to it can be seen.' },
  { term: 'Spectrum', match: ['spectrum', 'spectra'], lab: 'spectro', def: 'Light spread out by wavelength, from violet to red and beyond.' },
  { term: 'Resolving power', match: ['resolving power'], lab: 'spectro', def: 'How finely a spectrograph separates two nearby wavelengths: the wavelength divided by the smallest difference it can tell apart.' },
  { term: 'Zenith', match: ['zenith'], lab: 'adc', def: 'The point in the sky directly overhead.' },
  { term: 'Arcsecond', match: ['arcseconds?'], lab: 'seeing', def: 'A tiny angle: 1/3600 of a degree, the size of a coin seen from about 5 km.' },
  { term: 'Magnitude', match: ['(?<!of )magnitudes?'], lab: 'stacking', def: 'Astronomers\' brightness scale: 5 magnitudes are a factor of 100, and larger numbers are fainter.' },
  { term: 'Fresnel number', match: ['fresnel numbers?'], lab: 'starshade', def: 'A number that says whether a screen\'s shadow is sharp and geometric (large values) or blurred by diffraction (small values).' },
  { term: 'Einstein ring', match: ['einstein rings?'], lab: 'lensing', def: 'A ring-shaped image of a distant galaxy formed when a massive galaxy lies exactly in front of it.' },
  { term: 'Exoplanet', match: ['exoplanets?'], lab: 'telescope', def: 'A planet orbiting a star other than the Sun.' },
];

const esc = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
// alternatives longest first, so "spherical aberration" wins over "aberration"
const ALTS = GLOSSARY.flatMap((g, i) => g.match.map((m) => ({ i, m }))).sort((a, b) => b.m.length - a.m.length);
const ANY = new RegExp(`(?<![\\w-])(?:${ALTS.map((a) => a.m).join('|')})(?![\\w-])`, 'gi');
const EACH = ALTS.map((a) => ({ i: a.i, re: new RegExp(`^(?:${a.m})$`, /[A-Z]/.test(a.m) ? '' : 'i') }));

// Split `text` into plain strings and {i, text} for the first unseen use of each term.
export function markTerms(text, seen = new Set()) {
  const out = [];
  let last = 0;
  for (const m of text.matchAll(ANY)) {
    const hit = EACH.find((e) => e.re.test(m[0]));
    if (!hit || seen.has(hit.i)) continue;
    seen.add(hit.i);
    if (m.index > last) out.push(text.slice(last, m.index));
    out.push({ i: hit.i, text: m[0] });
    last = m.index + m[0].length;
  }
  if (last < text.length) out.push(text.slice(last));
  return out;
}

const SKIP = 'a, button, code, h1, h2, h3, h4, .katex, .katex-display, .term, .eq';

// Marks the first use of each term inside the page's text blocks and wires the definition
// popover. Returns a cleanup function.
export function glossary(page, labId, labTitle = (id) => id) {
  const seen = new Set();
  const blocks = page.querySelectorAll('.idea-text, .try, .rung-rule .prose, [data-rung="full"] .prose');
  for (const block of blocks) {
    const walker = document.createTreeWalker(block, NodeFilter.SHOW_TEXT, {
      acceptNode: (n) => (n.nodeValue.trim() && !n.parentElement.closest(SKIP) ? NodeFilter.FILTER_ACCEPT : NodeFilter.FILTER_REJECT),
    });
    const nodes = [];
    while (walker.nextNode()) nodes.push(walker.currentNode);
    for (const node of nodes) {
      const parts = markTerms(node.nodeValue, seen);
      if (parts.length === 1 && typeof parts[0] === 'string') continue;
      const frag = document.createDocumentFragment();
      for (const p of parts) {
        if (typeof p === 'string') { frag.append(p); continue; }
        const b = document.createElement('button');
        b.type = 'button';
        b.className = 'term';
        b.dataset.term = p.i;
        b.setAttribute('aria-describedby', 'gloss-tip');
        b.textContent = p.text;
        frag.append(b);
      }
      node.replaceWith(frag);
    }
  }
  if (!seen.size) return () => {};

  const tip = document.getElementById('gloss-tip') || Object.assign(document.createElement('div'), { id: 'gloss-tip', className: 'gloss-tip', role: 'tooltip', hidden: true });
  tip.setAttribute('role', 'tooltip');
  if (!tip.isConnected) document.body.append(tip);
  let current = null, hideTimer = 0;
  const show = (b) => {
    clearTimeout(hideTimer);
    const g = GLOSSARY[+b.dataset.term];
    tip.innerHTML = '';
    const head = document.createElement('strong');
    head.textContent = g.term;
    tip.append(head, ' ', g.def);
    if (g.lab && g.lab !== labId) {
      const a = document.createElement('a');
      a.href = '#/' + g.lab;
      a.textContent = labTitle(g.lab) + ' →';
      tip.append(document.createElement('br'), a);
    }
    tip.hidden = false;
    const r = b.getBoundingClientRect(), w = Math.min(320, innerWidth - 32);
    tip.style.width = w + 'px';
    tip.style.left = Math.max(16, Math.min(innerWidth - w - 16, r.left + r.width / 2 - w / 2)) + 'px';
    const below = r.bottom + 8, h = tip.offsetHeight;
    tip.style.top = (below + h > innerHeight - 8 ? r.top - h - 8 : below) + 'px';
    current = b;
  };
  const hide = (now) => { clearTimeout(hideTimer); hideTimer = setTimeout(() => { tip.hidden = true; current = null; }, now ? 0 : 180); };
  const over = (e) => { const b = e.target.closest?.('.term'); if (b && page.contains(b)) show(b); };
  const out = (e) => { if (e.target.closest?.('.term')) hide(); };
  const click = (e) => {
    const b = e.target.closest?.('.term');
    if (b && page.contains(b)) show(b);
    else if (!tip.contains(e.target)) hide(true);
  };
  const key = (e) => { if (e.key === 'Escape') hide(true); };
  const keepOpen = () => clearTimeout(hideTimer);
  const leaveTip = () => hide();
  const scrolled = () => hide(true);
  page.addEventListener('mouseover', over);
  page.addEventListener('mouseout', out);
  page.addEventListener('focusin', over);
  page.addEventListener('focusout', out);
  document.addEventListener('click', click);
  document.addEventListener('keydown', key);
  tip.addEventListener('mouseenter', keepOpen);
  tip.addEventListener('mouseleave', leaveTip);
  addEventListener('scroll', scrolled, { passive: true });
  return () => {
    hide(true);
    document.removeEventListener('click', click);
    document.removeEventListener('keydown', key);
    tip.removeEventListener('mouseenter', keepOpen);
    tip.removeEventListener('mouseleave', leaveTip);
    removeEventListener('scroll', scrolled);
  };
}
