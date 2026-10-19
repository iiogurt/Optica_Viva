import { h, controls, stage, readouts, imageCanvas, texNum, reducedMotion } from '../lib/ui.js';
import { header, lab, idea, rule, theory, references, liveCalc } from '../lib/page.js';
import { NS, DP, CROP } from '../lib/seeing.js';
import { runOn, poolSize } from '../lib/compute.js';


export default function mount(root, meta) {
  root.append(header({ ...meta, domains: ['space', 'photo'] }));
  root.append(idea(String.raw`<p>Look across a road on a hot day and the view behind it shimmers. Starlight suffers the same on its way down: pockets of warmer and cooler air bend it by slightly different amounts. A star's image dances and breaks into flickering speckles, and a long exposure smears them into a fuzzy blob, often dozens of times larger than the telescope could otherwise show. Astronomers call this <strong>seeing</strong>. It is why observatories sit on mountaintops, and why telescopes go to space.</p>
<p><strong>Adaptive optics</strong> fights back: a sensor measures the distortion hundreds of times per second, and a flexible mirror bends to cancel it.</p>`, [
    'Set Correction to <strong>None</strong> and compare the long exposure with the diffraction limit on the right. How many times larger is the blob?',
    'Switch to <strong>Full AO</strong>, then raise the <strong>wind speed</strong> to 40 m/s: the mirror can no longer keep up.',
    'With Full AO, move the <strong>wavelength</strong> from 0.5 to 2.2 µm. The correction works far better in the infrared, which is where most adaptive optics observes.',
  ]));

  const ctl = controls({
    D: { type: 'range', label: 'Telescope diameter D', min: 0.2, max: 10, log: true, value: 4, unit: 'm' },
    r0: { type: 'range', label: 'Fried parameter r₀ at 500 nm', min: 4, max: 30, step: 0.5, value: 12, unit: 'cm' },
    lam: { type: 'range', label: 'Observing wavelength', min: 0.5, max: 2.2, step: 0.01, value: 1.65, unit: 'µm' },
    v: { type: 'range', label: 'Wind speed (frozen flow)', min: 2, max: 40, step: 1, value: 12, unit: 'm/s' },
    ao: { type: 'seg', label: 'Correction', value: 'ao', options: [['off', 'None'], ['tt', 'Tip-tilt'], ['ao', 'Full AO']] },
    nact: { type: 'range', label: 'Actuators across the pupil', min: 4, max: 32, step: 1, value: 16 },
    lag: { type: 'range', label: 'AO servo lag', min: 0, max: 10, step: 0.5, value: 2, unit: 'ms' },
    run: { type: 'toggle', label: 'Animate (frozen-flow turbulence)', value: !reducedMotion() },
  }, () => reset());
  const resetBtn = h('button.btn', { type: 'button', onClick: () => reset(true) }, 'New turbulence realisation');
  const ro = h('div');
  const calc = liveCalc();
  const scrSt = stage({ aspect: 3, label: 'Phase screen (pupil window outlined) · residual after correction', draw: drawScreen, minH: 170 });
  const sp = stage({ aspect: 1, label: 'Short exposure (5 ms)', draw: (c, w, hh) => drawPSF(c, w, hh, 'short') });
  const lp = stage({ aspect: 1, label: 'Long exposure', draw: (c, w, hh) => drawPSF(c, w, hh, 'long') });
  const dl = stage({ aspect: 1, label: 'Diffraction limit (space)', draw: (c, w, hh) => drawPSF(c, w, hh, 'ideal') });
  root.append(lab([scrSt.el, h('div.grid-3', {}, sp.el, lp.el, dl.el)], [h('div.card', {}, ctl.el, h('div', { style: { marginTop: '12px' } }, resetBtn)), h('div.card', {}, ro), calc.el]));

  // The simulation runs in a compute worker (js/lib/seeing.js): reset() starts a session there and
  // the animation streams display-ready frames back, one request at a time, so a slow machine shows
  // fewer frames instead of freezing. sid makes frames of an older session stale.
  const WK = poolSize() - 1; // the worker that holds the session
  let seed = 7, sid = 0, P = null, screenImg = null, idealImg = null, frame = null, busy = false, raf = 0;
  const toCanvas = (rgba, w, hh) => { const c = imageCanvas(w, hh); c.data.set(rgba); c.put(); return c.c; };

  function reset(newSeed) {
    if (newSeed) seed = (seed * 48271) % 2147483647;
    const st = ctl.state;
    P = { D: st.D, r0: st.r0, lam: st.lam, v: st.v, ao: st.ao, nact: st.nact, lag: st.lag };
    const my = ++sid;
    runOn(WK, 'seeingReset', { p: P, seed, sid: my }).then((r) => {
      if (my !== sid) return;
      screenImg = toCanvas(r.screen, NS, NS); idealImg = toCanvas(r.ideal, CROP, CROP);
      frame = null;
      request(true);
    }).catch(console.error);
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
    const strehl = Math.exp(-sTot);
    calc.say(`At ${lam} µm the air blurs stars to <strong>${seeing.toFixed(2)}″</strong>, ${Math.max(1, seeing / dlim).toFixed(0)} times the ${st.D.toPrecision(2)} m telescope's own limit of ${(dlim * 1000).toFixed(0)} mas. `
      + (st.ao === 'off' ? 'Without correction, ' : st.ao === 'tt' ? 'Removing only the image motion, ' : 'With adaptive optics, ')
      + `the peak brightness is about <strong>${strehl < 0.001 ? 'below 0.1' : (strehl * 100).toPrecision(2)} %</strong> of a perfect image (the Strehl ratio).`);
    calc.set(String.raw`\begin{aligned}
    r_0(\lambda) &= r_0(500)\left(\tfrac{\lambda}{0.5\,\mu m}\right)^{6/5} = ${texNum(r0l * 100, 3)}\ \text{cm}\\
    \sigma^2_\text{fit} &= 0.28\,(d/r_0)^{5/3} = ${texNum(sFit, 3)}\\
    \sigma^2_\text{lag} &= (\tau/\tau_0)^{5/3} = ${texNum(sLag, 3)}\\
    \sigma^2_\text{uncorr} &= 1.03\,(D/r_0)^{5/3} = ${texNum(sTT, 3)}
    \end{aligned}`);
  }

  // ask the worker for the next frame (2 time steps); force: also when the animation is paused
  function request(force) {
    if (busy || (!ctl.state.run && !force)) return;
    busy = true;
    const my = sid;
    runOn(WK, 'seeingStep', { steps: 2, sid: my }).then((f) => {
      busy = false;
      if (!f || f.sid !== sid) return;
      frame = { short: toCanvas(f.short, CROP, CROP), long: toCanvas(f.long, CROP, CROP), pupil: toCanvas(f.pupil, DP, DP), rms: f.rms, shift: f.shift };
      const dd = ro.querySelectorAll('dd'); if (dd.length) dd[dd.length - 1].textContent = f.strehl.toExponential(2) + ` (${f.accN} frames)`;
      sp.redraw(); lp.redraw(); dl.redraw(); scrSt.redraw();
    }, (e) => { busy = false; console.error(e); });
  }
  const loop = () => { request(false); raf = requestAnimationFrame(loop); };

  function drawPSF(ctx, w, hh, kind) {
    ctx.fillStyle = '#000'; ctx.fillRect(0, 0, w, hh);
    const img = kind === 'ideal' ? idealImg : frame && frame[kind];
    if (!img) return;
    const side = Math.min(w, hh);
    ctx.imageSmoothingEnabled = true;
    ctx.drawImage(img, (w - side) / 2, (hh - side) / 2, side, side);
    const arcsec = (CROP / 4) * (P.lam * 1e-6 / P.D) * 206265;
    ctx.fillStyle = 'rgba(255,255,255,0.75)'; ctx.font = '10.5px "JetBrains Mono", monospace'; ctx.textAlign = 'right';
    ctx.fillText(`${arcsec.toFixed(2)}″ field · log`, w - 10, hh - 10);
  }

  function drawScreen(ctx, w, hh) {
    ctx.fillStyle = '#000'; ctx.fillRect(0, 0, w, hh);
    if (!screenImg || !frame) return;
    // left: the screen (central band of rows holding the pupil track), drawn twice to show the
    // periodic frozen flow; right: residual wavefront in the pupil
    const H = hh - 16, scale = H / (NS / 2);
    const W2 = Math.min(w * 0.62, NS * scale);
    ctx.save(); ctx.beginPath(); ctx.rect(8, 8, W2, H); ctx.clip();
    const sh = (frame.shift % NS) * scale;
    ctx.drawImage(screenImg, 0, NS / 4 - 30, NS, NS / 2, 8 - sh, 8, NS * scale, H);
    ctx.drawImage(screenImg, 0, NS / 4 - 30, NS, NS / 2, 8 - sh + NS * scale, 8, NS * scale, H);
    ctx.restore();
    ctx.strokeStyle = '#fff'; ctx.lineWidth = 1.5; ctx.beginPath(); ctx.arc(8 + (DP / 2) * scale, 8 + (30 + DP / 2) * scale, (DP / 2) * scale, 0, 7); ctx.stroke();
    const ps = H, px0 = 8 + W2 + (w - W2 - 8 - ps) / 2;
    ctx.imageSmoothingEnabled = true; ctx.drawImage(frame.pupil, px0, 8, ps, ps);
    ctx.fillStyle = 'rgba(255,255,255,0.8)'; ctx.font = '10.5px "JetBrains Mono", monospace'; ctx.textAlign = 'left';
    ctx.fillText(`residual ${frame.rms.toFixed(2)} λ RMS`, px0, hh - 4);
  }

  reset();
  raf = requestAnimationFrame(loop);

  root.append(rule(String.raw`\[\text{seeing} \approx \frac{\lambda}{r_0}\qquad\text{vs.}\qquad \text{diffraction} \approx 1.22\,\frac{\lambda}{D}\]
<p>The Fried parameter \(r_0\) is the width of a patch of air that bends light nearly uniformly: 10–20 cm in visible light at a good site. A telescope larger than \(r_0\) resolves no better than one of diameter \(r_0\). Example: with \(r_0 = 12\) cm at 0.5 µm, seeing is \(0.98 \times 0.5\,\mu\text{m}/0.12\,\text{m} \approx 0.84″\), while a 4 m telescope could reach 0.03″, about 27 times sharper.</p>
<p>\(r_0\) grows with wavelength as \(\lambda^{6/5}\), so seeing improves slowly towards the infrared (\(\propto\lambda^{-1/5}\)) while the diffraction limit worsens. The gap that adaptive optics must close is smallest there.</p>`,
    String.raw`It assumes Kolmogorov turbulence with a very large outer scale. For telescopes approaching the outer scale (tens of metres) the real seeing disk is smaller than \(\lambda/r_0\) predicts, and a telescope smaller than \(r_0\) is limited by diffraction instead. Real nights change \(r_0\) from minute to minute.`));
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
