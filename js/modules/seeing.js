import { h, controls, stage, readouts, debounce, imageCanvas, fmt, texNum } from '../lib/ui.js';
import { header, lab, theory, references, liveCalc } from '../lib/page.js';
import { fft2d } from '../lib/fft.js';
import { rasterAperture, psf } from '../lib/pupil.js';
import { lut } from '../lib/color.js';

// Gaussian random numbers (Box–Muller) from a seeded generator
function rng(seed) {
  let s = seed >>> 0;
  const u = () => { s = (s * 1664525 + 1013904223) >>> 0; return (s + 0.5) / 4294967296; };
  return () => Math.sqrt(-2 * Math.log(u())) * Math.cos(2 * Math.PI * u());
}

// von Kármán phase screen (radians at 500 nm), FFT method + 3 levels of subharmonics
// (Lane, Glindemann & Dainty 1992; Schmidt 2010, ft_sh_phase_screen).
function phaseScreen(N, dx, r0, L0, seed) {
  const g = rng(seed);
  const df = 1 / (N * dx);
  const re = new Float64Array(N * N), im = new Float64Array(N * N);
  const PSD = (f) => 0.023 * Math.pow(r0, -5 / 3) * Math.pow(f * f + 1 / (L0 * L0), -11 / 6);
  for (let y = 0; y < N; y++) for (let x = 0; x < N; x++) {
    const fx = (x < N / 2 ? x : x - N) * df, fy = (y < N / 2 ? y : y - N) * df;
    const f = Math.hypot(fx, fy);
    if (f === 0) continue;
    const a = Math.sqrt(PSD(f)) * df;
    re[y * N + x] = g() * a; im[y * N + x] = g() * a;
  }
  fft2d(re, im, N, true);
  const scr = new Float64Array(N * N);
  for (let i = 0; i < N * N; i++) scr[i] = re[i] * N * N; // undo the 1/N² of the inverse transform
  // subharmonics for the low frequencies the FFT grid cannot represent
  const D = N * dx;
  for (let p = 1; p <= 3; p++) {
    const dfp = 1 / (Math.pow(3, p) * D);
    for (let a = -1; a <= 1; a++) for (let b = -1; b <= 1; b++) {
      if (!a && !b) continue;
      const fx = a * dfp, fy = b * dfp, amp = Math.sqrt(PSD(Math.hypot(fx, fy))) * dfp;
      const cr = g() * amp, ci = g() * amp;
      for (let y = 0; y < N; y++) for (let x = 0; x < N; x++) {
        const ph = 2 * Math.PI * (fx * x * dx + fy * y * dx);
        scr[y * N + x] += cr * Math.cos(ph) - ci * Math.sin(ph);
      }
    }
  }
  let m = 0; for (let i = 0; i < N * N; i++) m += scr[i]; m /= N * N;
  for (let i = 0; i < N * N; i++) scr[i] -= m;
  return scr;
}

export default function mount(root, meta) {
  root.append(header({ ...meta, lede: 'Turbulent mixing of air at different temperatures makes the refractive index fluctuate by parts per million. That is enough to corrugate a starlight wavefront by several micrometres across a large telescope, blurring a 0.01″ diffraction pattern into a 1″ seeing disk. Adaptive optics measures the corrugations a thousand times per second and flattens them with a deformable mirror. Space telescopes avoid the problem entirely.', domains: ['space', 'photo'] }));

  const ctl = controls({
    D: { type: 'range', label: 'Telescope diameter D', min: 0.2, max: 10, log: true, value: 4, unit: 'm' },
    r0: { type: 'range', label: 'Fried parameter r₀ at 500 nm', min: 4, max: 30, step: 0.5, value: 12, unit: 'cm' },
    lam: { type: 'range', label: 'Observing wavelength', min: 0.5, max: 2.2, step: 0.01, value: 1.65, unit: 'µm' },
    v: { type: 'range', label: 'Wind speed (frozen flow)', min: 2, max: 40, step: 1, value: 12, unit: 'm/s' },
    ao: { type: 'seg', label: 'Correction', value: 'ao', options: [['off', 'None'], ['tt', 'Tip-tilt'], ['ao', 'Full AO']] },
    nact: { type: 'range', label: 'Actuators across the pupil', min: 4, max: 32, step: 1, value: 16 },
    lag: { type: 'range', label: 'AO servo lag', min: 0, max: 10, step: 0.5, value: 2, unit: 'ms' },
    run: { type: 'toggle', label: 'Animate (frozen-flow turbulence)', value: true },
  }, () => reset());
  const resetBtn = h('button.btn', { type: 'button', onClick: () => reset(true) }, 'New turbulence realisation');
  const ro = h('div');
  const calc = liveCalc();
  const scrSt = stage({ aspect: 3, label: 'Phase screen (pupil window outlined) · residual after correction', draw: drawScreen, minH: 170 });
  const sp = stage({ aspect: 1, label: 'Short exposure (5 ms)', draw: (c, w, hh) => drawPSF(c, w, hh, 'short') });
  const lp = stage({ aspect: 1, label: 'Long exposure', draw: (c, w, hh) => drawPSF(c, w, hh, 'long') });
  const dl = stage({ aspect: 1, label: 'Diffraction limit (space)', draw: (c, w, hh) => drawPSF(c, w, hh, 'ideal') });
  root.append(lab([scrSt.el, h('div.grid-3', {}, sp.el, lp.el, dl.el)], [h('div.card', {}, ctl.el, h('div', { style: { marginTop: '12px' } }, resetBtn)), h('div.card', {}, ro), calc.el]));

  const NS = 512, DP = 64, n = 256; // screen 8D wide, pupil 64 px, PSF grid 256 (Q = 4)
  const amp = rasterAperture({ type: 'circle', obstruction: 0.12 }, n, DP, 3);
  const ideal = psf(amp, null, n, 1);
  let screen = null, base = null, baseKey = '', seed = 7, t = 0, frame = 0, acc = null, accN = 0, hist = [], last = null, raf = 0, P = null;
  const dt = 0.005; // s per animation step

  function reset(newSeed) {
    if (newSeed) seed = (seed * 48271) % 2147483647;
    const st = ctl.state;
    const dx = st.D / DP;
    // the screen depends only on D (pixel scale) and the seed; r₀ rescales it as r₀^(−5/6)
    const key = st.D + ':' + seed;
    if (key !== baseKey) { base = phaseScreen(NS, dx, 0.1, 25, seed); baseKey = key; }
    const k = Math.pow(0.1 / (st.r0 / 100), 5 / 6);
    screen = new Float64Array(base.length); for (let i = 0; i < base.length; i++) screen[i] = base[i] * k;
    t = 0; acc = new Float64Array(n * n); accN = 0; hist = [];
    P = { ...st, dx };
    const lam = st.lam, r0l = (st.r0 / 100) * Math.pow(lam / 0.5, 6 / 5);
    const seeing = (0.98 * lam * 1e-6) / r0l * 206265;
    const dlim = (1.22 * lam * 1e-6) / st.D * 206265;
    const tau0 = (0.314 * r0l) / st.v;
    const d = st.D / st.nact;
    const sFit = 0.28 * Math.pow(d / r0l, 5 / 3);
    const sLag = Math.pow((st.lag / 1000) / tau0, 5 / 3);
    const sTT = 1.03 * Math.pow(st.D / r0l, 5 / 3), sTTres = 0.134 * Math.pow(st.D / r0l, 5 / 3);
    const sTot = st.ao === 'ao' ? sFit + sLag : st.ao === 'tt' ? sTTres : sTT;
    ro.replaceChildren(readouts([
      ['r₀ at λ = ' + lam + ' µm', (r0l * 100).toFixed(1) + ' cm'],
      ['D / r₀', (st.D / r0l).toFixed(1)],
      ['Seeing FWHM 0.98 λ/r₀', seeing.toFixed(3) + '″'],
      ['Diffraction limit 1.22 λ/D', (dlim * 1000).toFixed(1) + ' mas'],
      ['Coherence time τ₀', (tau0 * 1000).toFixed(1) + ' ms'],
      ['Greenwood frequency', (0.43 * st.v / r0l).toFixed(0) + ' Hz'],
      ['Isoplanatic angle (H̄ = 5 km)', ((0.314 * r0l) / 5000 * 206265).toFixed(2) + '″'],
      ['Predicted residual σ² (rad²)', sTot.toFixed(3)],
      ['Predicted Strehl e^(−σ²)', Math.exp(-sTot).toExponential(2)],
      ['Measured long-exp. Strehl', '…'],
    ]));
    calc.set(String.raw`\begin{aligned}
    r_0(\lambda) &= r_0(500)\left(\tfrac{\lambda}{0.5\,\mu m}\right)^{6/5} = ${texNum(r0l * 100, 3)}\ \text{cm}\\
    \sigma^2_\text{fit} &= 0.28\,(d/r_0)^{5/3} = ${texNum(sFit, 3)}\\
    \sigma^2_\text{lag} &= (\tau/\tau_0)^{5/3} = ${texNum(sLag, 3)}\\
    \sigma^2_\text{uncorr} &= 1.03\,(D/r_0)^{5/3} = ${texNum(sTT, 3)}
    \end{aligned}`);
    step(true);
  }

  // sample the periodic screen with bilinear interpolation at an offset (frozen flow along x)
  function pupilPhase(shift) {
    const ph = new Float64Array(n * n);
    const off = (n - DP) / 2;
    const s0 = Math.floor(shift), f = shift - s0;
    for (let y = 0; y < DP + 2; y++) for (let x = 0; x < DP + 2; x++) {
      const sx = ((x + s0) % NS + NS) % NS, sx1 = (sx + 1) % NS, sy = (y + NS / 4) % NS;
      const v = screen[sy * NS + sx] * (1 - f) + screen[sy * NS + sx1] * f;
      if (y < DP + 2 && x < DP + 2 && off + y - 1 >= 0 && off + x - 1 >= 0) ph[(off + y - 1) * n + off + x - 1] = v;
    }
    return ph;
  }

  // deformable mirror: actuators on an (nact+1)² grid, bilinear influence functions
  function dmFit(ph, nact) {
    const off = (n - DP) / 2, pitch = DP / nact;
    const A = [];
    for (let j = 0; j <= nact; j++) { A.push([]); for (let i = 0; i <= nact; i++) { const x = Math.min(DP - 1, Math.round(i * pitch)), y = Math.min(DP - 1, Math.round(j * pitch)); A[j].push(ph[(off + y) * n + off + x]); } }
    const dm = new Float64Array(n * n);
    for (let y = 0; y < DP; y++) for (let x = 0; x < DP; x++) {
      const u = x / pitch, v = y / pitch, i = Math.min(nact - 1, Math.floor(u)), j = Math.min(nact - 1, Math.floor(v)), fu = u - i, fv = v - j;
      dm[(off + y) * n + off + x] = (A[j][i] * (1 - fu) + A[j][i + 1] * fu) * (1 - fv) + (A[j + 1][i] * (1 - fu) + A[j + 1][i + 1] * fu) * fv;
    }
    return dm;
  }
  function tiltFit(ph) {
    let sx = 0, sy = 0, sxx = 0, syy = 0, s = 0, w = 0;
    const c = n / 2;
    for (let k = 0; k < n * n; k++) if (amp[k] > 0.5) { const x = (k % n) - c, y = Math.floor(k / n) - c; s += ph[k]; sx += ph[k] * x; sy += ph[k] * y; sxx += x * x; syy += y * y; w++; }
    const out = new Float64Array(n * n), a = sx / sxx, b = sy / syy, m = s / w;
    for (let k = 0; k < n * n; k++) if (amp[k] > 0) out[k] = m + a * ((k % n) - c) + b * (Math.floor(k / n) - c);
    return out;
  }

  function step(force) {
    if (!screen) return;
    const st = P, lam = st.lam;
    const shift = (st.v * t) / st.dx;
    const raw = pupilPhase(shift); // radians at 500 nm
    const toWaves = 0.5 / lam / (2 * Math.PI); // radians@500 → waves at λ (OPD achromatic)
    let corr = null;
    if (st.ao === 'tt') corr = tiltFit(raw);
    if (st.ao === 'ao') corr = dmFit(raw, st.nact);
    hist.push(corr);
    const lagFrames = Math.round(st.lag / 1000 / dt);
    while (hist.length > lagFrames + 1) hist.shift();
    const applied = corr ? hist[0] : null;
    const W = new Float64Array(n * n);
    for (let k = 0; k < n * n; k++) if (amp[k] > 0) W[k] = (raw[k] - (applied ? applied[k] : 0)) * toWaves;
    const { I } = psf(amp, W, n, 1);
    for (let k = 0; k < n * n; k++) acc[k] += I[k];
    accN++;
    last = { I, raw, W, shift };
    t += dt; frame++;
    if (frame % 4 === 0 || force) {
      let pk = 0; for (let k = 0; k < n * n; k++) pk = Math.max(pk, acc[k] / accN);
      const dd = ro.querySelectorAll('dd'); if (dd.length) dd[dd.length - 1].textContent = (pk / ideal.peak).toExponential(2) + ` (${accN} frames)`;
      sp.redraw(); lp.redraw(); dl.redraw(); scrSt.redraw();
    }
  }
  const loop = () => { if (ctl.state.run) for (let i = 0; i < 2; i++) step(); raf = requestAnimationFrame(loop); };

  const INF = lut('inferno'), DIV = lut('diverging');
  function drawPSF(ctx, w, hh, kind) {
    ctx.fillStyle = '#000'; ctx.fillRect(0, 0, w, hh);
    if (!last) return;
    const data = kind === 'short' ? last.I : kind === 'long' ? acc : ideal.I;
    const norm = kind === 'long' ? accN : 1;
    const crop = 192, off = (n - crop) / 2, ic = imageCanvas(crop, crop);
    let mx = 0; for (let y = 0; y < crop; y++) for (let x = 0; x < crop; x++) mx = Math.max(mx, data[(y + off) * n + x + off] / norm);
    for (let y = 0; y < crop; y++) for (let x = 0; x < crop; x++) {
      const v = Math.max(0, 1 + Math.log10(data[(y + off) * n + x + off] / norm / mx + 1e-9) / 3.5);
      const tt = Math.round(v * 255) * 3, o = (y * crop + x) * 4;
      ic.data[o] = INF[tt]; ic.data[o + 1] = INF[tt + 1]; ic.data[o + 2] = INF[tt + 2]; ic.data[o + 3] = 255;
    }
    ic.put();
    const side = Math.min(w, hh);
    ctx.imageSmoothingEnabled = true;
    ctx.drawImage(ic.c, (w - side) / 2, (hh - side) / 2, side, side);
    const arcsec = (crop / 4) * (P.lam * 1e-6 / P.D) * 206265;
    ctx.fillStyle = 'rgba(255,255,255,0.75)'; ctx.font = '10.5px "JetBrains Mono", monospace'; ctx.textAlign = 'right';
    ctx.fillText(`${arcsec.toFixed(2)}″ field · log`, w - 10, hh - 10);
  }

  function drawScreen(ctx, w, hh) {
    ctx.fillStyle = '#000'; ctx.fillRect(0, 0, w, hh);
    if (!screen || !last) return;
    // left: full screen; right: residual wavefront in the pupil
    const ic = imageCanvas(NS, NS);
    let mx = 1e-9; for (let k = 0; k < NS * NS; k++) mx = Math.max(mx, Math.abs(screen[k]));
    for (let k = 0; k < NS * NS; k++) { const tt = Math.round((screen[k] / mx * 0.5 + 0.5) * 255) * 3; ic.data[k * 4] = DIV[tt]; ic.data[k * 4 + 1] = DIV[tt + 1]; ic.data[k * 4 + 2] = DIV[tt + 2]; ic.data[k * 4 + 3] = 255; }
    ic.put();
    const H = hh - 16, scale = H / (NS / 2);
    const W2 = Math.min(w * 0.62, NS * scale);
    // draw the screen twice horizontally to show periodic frozen flow
    ctx.save(); ctx.beginPath(); ctx.rect(8, 8, W2, H); ctx.clip();
    const sh = (last.shift % NS) * scale;
    // show the central band of rows that contains the pupil track
    ctx.drawImage(ic.c, 0, NS / 4 - 30, NS, NS / 2, 8 - sh, 8, NS * scale, H);
    ctx.drawImage(ic.c, 0, NS / 4 - 30, NS, NS / 2, 8 - sh + NS * scale, 8, NS * scale, H);
    ctx.restore();
    ctx.strokeStyle = '#fff'; ctx.lineWidth = 1.5; ctx.beginPath(); ctx.arc(8 + (DP / 2) * scale, 8 + (NS / 4 - (NS / 4 - 30) + DP / 2) * scale, (DP / 2) * scale, 0, 7); ctx.stroke();
    // residual pupil phase
    const off = (n - DP) / 2, ip = imageCanvas(DP, DP);
    let rm = 1e-9; for (let y = 0; y < DP; y++) for (let x = 0; x < DP; x++) rm = Math.max(rm, Math.abs(last.W[(off + y) * n + off + x]));
    let s2 = 0, s1 = 0, c = 0;
    for (let y = 0; y < DP; y++) for (let x = 0; x < DP; x++) {
      const k = (off + y) * n + off + x, o = (y * DP + x) * 4;
      if (amp[k] < 0.5) { ip.data[o + 3] = 0; continue; }
      const v = last.W[k]; s1 += v; s2 += v * v; c++;
      const tt = Math.round((v / Math.max(rm, 0.5) * 0.5 + 0.5) * 255) * 3;
      ip.data[o] = DIV[tt]; ip.data[o + 1] = DIV[tt + 1]; ip.data[o + 2] = DIV[tt + 2]; ip.data[o + 3] = 255;
    }
    ip.put();
    const ps = H, px0 = 8 + W2 + (w - W2 - 8 - ps) / 2;
    ctx.imageSmoothingEnabled = true; ctx.drawImage(ip.c, px0, 8, ps, ps);
    const rms = Math.sqrt(Math.max(0, s2 / c - (s1 / c) ** 2));
    ctx.fillStyle = 'rgba(255,255,255,0.8)'; ctx.font = '10.5px "JetBrains Mono", monospace'; ctx.textAlign = 'left';
    ctx.fillText(`residual ${rms.toFixed(2)} λ RMS`, px0, hh - 4);
  }

  reset();
  raf = requestAnimationFrame(loop);

  root.append(theory('Kolmogorov turbulence and its correction', String.raw`
<div class="theory-cols"><div>
<h3>Statistics of the refractive index</h3>
<p>In the inertial range between the outer scale \(L_0\) (tens of metres) and the inner scale \(l_0\) (millimetres), Kolmogorov's theory gives the refractive-index structure function \(D_n(r) = C_n^2 r^{2/3}\). Integrated along the line of sight, this yields a phase structure function \(D_\phi(r) = 6.88\,(r/r_0)^{5/3}\) with the <strong>Fried parameter</strong></p>
\[r_0 = \left[0.423\,k^2\sec\zeta\int C_n^2(h)\,dh\right]^{-3/5}\ \propto\ \lambda^{6/5}.\]
<p>\(r_0\) is the diameter over which the wavefront error is about 1 rad RMS. A telescope larger than \(r_0\) is seeing-limited, with FWHM \(\approx0.98\,\lambda/r_0\) independent of aperture. Because \(r_0\) grows as \(\lambda^{6/5}\), seeing improves slowly towards the infrared while the diffraction limit worsens. The two cross at a wavelength set by the site and the aperture.</p>
<h3>Simulating a phase screen</h3>
<p>The phase power spectral density of von Kármán turbulence is</p>
\[\Phi_\phi(\kappa) = 0.023\,r_0^{-5/3}\left(\kappa^2 + L_0^{-2}\right)^{-11/6}.\]
<p>A screen is synthesised by filtering complex white Gaussian noise with \(\sqrt{\Phi_\phi}\,\Delta\kappa\) and inverse-FFTing. The FFT grid cannot represent scales larger than itself, so three levels of subharmonics (Lane et al. 1992) restore the missing low-order power, especially tip-tilt. Taylor's frozen-flow hypothesis translates the screen at the wind speed, giving a coherence time \(\tau_0 = 0.314\,r_0/v\).</p>
</div><div>
<h3>Short and long exposures</h3>
<p>Exposures shorter than \(\tau_0\) freeze the atmosphere. The PSF breaks into about \((D/r_0)^2\) <em>speckles</em>, each of diffraction-limited size \(\lambda/D\). Speckle interferometry (Labeyrie, 1970) exploits these. Long exposures average the speckles into the smooth seeing halo, whose long-exposure OTF is \(\exp[-3.44(\lambda\nu/r_0)^{5/3}]\).</p>
<h3>Adaptive optics error budget</h3>
<p>The residual wavefront variance adds up independent terms (Noll 1976; Hardy 1998):</p>
\[\sigma^2 = \underbrace{0.28\left(\tfrac{d}{r_0}\right)^{5/3}}_\text{fitting} + \underbrace{\left(\tfrac{\tau}{\tau_0}\right)^{5/3}}_\text{servo lag} + \sigma^2_\text{WFS noise} + \sigma^2_\text{aniso}\ ,\]
<p>and the Strehl ratio is \(S\approx e^{-\sigma^2}\). Removing tip-tilt alone cuts the uncorrected \(1.03(D/r_0)^{5/3}\) to \(0.134(D/r_0)^{5/3}\): most of the phase variance, but almost none of the high-order structure that forms speckles. The deformable mirror here samples the phase at an \((n+1)^2\) actuator grid and interpolates bilinearly (pyramid influence functions). The residual is the high-spatial-frequency fitting error, plus the lag error from applying a correction that is already \(\tau\) old. AO is far easier in the infrared: \(r_0\) and \(\tau_0\) both grow as \(\lambda^{6/5}\), so fewer, slower actuators suffice.</p>
<h3>Why go to space</h3>
<p>Above the atmosphere \(C_n^2 = 0\), so Hubble and JWST are diffraction-limited across their whole field and at every wavelength they cover. They also escape airglow, absorption bands and the isoplanatic angle, which limits AO correction on the ground to a few arcseconds around a guide star.</p>
</div></div>`));
  root.append(references([
    'D. L. Fried, "Optical resolution through a randomly inhomogeneous medium for very long and very short exposures", JOSA 56, 1372 (1966).',
    'R. G. Lane, A. Glindemann &amp; J. C. Dainty, "Simulation of a Kolmogorov phase screen", Waves in Random Media 2, 209 (1992).',
    'J. D. Schmidt, <i>Numerical Simulation of Optical Wave Propagation</i>, SPIE Press (2010), ch. 9.',
    'F. Roddier (ed.), <i>Adaptive Optics in Astronomy</i>, Cambridge (1999).',
    'J. W. Hardy, <i>Adaptive Optics for Astronomical Telescopes</i>, Oxford (1998).',
    'A. Labeyrie, "Attainment of diffraction limited resolution in large telescopes by Fourier analysing speckle patterns", A&amp;A 6, 85 (1970).',
  ]));
  return () => { cancelAnimationFrame(raf); [scrSt, sp, lp, dl].forEach((s) => s.destroy()); };
}
