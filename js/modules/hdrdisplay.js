// HDR displays: PQ, HLG and SDR coding of brightness, banding, and the light levels of screens.
import { h, controls, stage, readouts, fmt, texNum } from '../lib/ui.js';
import { header, lab, idea, rule, theory, references, liveCalc } from '../lib/page.js';
import { plot } from '../lib/plot.js';
import { paint, encode, keyOf } from '../lib/pixels.js';
import { CODINGS, LEVELS, pqEOTF, pqInverse, hlgEOTF, hlgGamma, sdrEOTF, stepAt, quantise } from '../lib/hdrdisplay.js';
import { t, N_ } from '../lib/i18n.js';

const COLOURS = { sdr8: '#ff6b6b', sdr10: '#ffb547', hlg10: '#6be3a4', pq10: '#6ad7ff', pq12: '#c18cff' };

export default function mount(root, meta) {
  root.append(header({ ...meta, domains: ['video', 'photo'] }));
  root.append(idea(String.raw`<p>A screen shows each pixel's brightness from a number, and there are only so many numbers: 256 with 8 bits, 1024 with 10. The question is how to share them out between dark and bright. Our eyes notice a step of about 1 % in brightness in daylight but need larger steps in the dark, so it pays to put the numbers where the eye is most sensitive.</p>
<p>An ordinary (SDR) screen tops out at about 100 nits, and its curve was made for that. HDR screens reach 1000 nits and more, and use new curves: PQ, which gives every brightness up to 10 000 nits its own number, and HLG, which also looks right on an old screen.</p>`, [
    'Look at the <strong>dark ramp</strong>: which coding shows visible steps, and which looks smooth?',
    'Compare the <strong>steps</strong> chart: why is PQ with 10 bits finer in the dark than SDR with 8, though it covers 100 times more brightness?',
    'Raise the <strong>display\'s peak</strong> for HLG: how does its gamma change?',
  ]));

  const ctl = controls({
    lo: { type: 'range', label: 'Dark ramp: from', min: 0.005, max: 1, log: true, value: 0.02, unit: 'nits' },
    hi: { type: 'range', label: 'Dark ramp: to', min: 0.05, max: 20, log: true, value: 1, unit: 'nits' },
    Lw: { type: 'range', label: 'Peak of the HLG display', min: 400, max: 4000, log: true, value: 1000, unit: 'nits' },
  }, () => update());
  const ro = h('div'), calc = liveCalc();
  const ramps = stage({ aspect: 2.4, label: 'The same dark ramp coded five ways (brightened on your screen so the steps show)', draw: drawRamps, minH: 240 });
  const curves = stage({ aspect: 1.5, label: '', draw: drawCurves, cls: 'plain', minH: 220 });
  const steps = stage({ aspect: 1.5, label: '', draw: drawSteps, cls: 'plain', minH: 220 });
  const levels = stage({ aspect: 3.4, label: '', draw: drawLevels, cls: 'plain', minH: 190 });
  root.append(lab([ramps.el, h('div.grid-2', {}, h('div.card', { style: { padding: '6px' } }, curves.el), h('div.card', { style: { padding: '6px' } }, steps.el)), h('div.card', { style: { padding: '6px' } }, levels.el)], [h('div.card', {}, ctl.el), h('div.card', {}, ro), calc.el]));

  let key = 0;
  function update() {
    const st = ctl.state; key++;
    const n = (c, L) => { const v = c.inv(L); return Math.round(v * (2 ** c.bits - 1)); };
    const codes = (c) => Math.max(0, n(c, st.hi) - n(c, st.lo));
    ro.replaceChildren(readouts([
      ['100 nits in PQ (10-bit code)', `${fmt(pqInverse(100), 4)} (${Math.round(pqInverse(100) * 1023)})`],
      ['1000 nits in PQ (10-bit code)', `${fmt(pqInverse(1000), 4)} (${Math.round(pqInverse(1000) * 1023)})`],
      ['HLG system gamma at this peak', fmt(hlgGamma(st.Lw), 4)],
      ['Codes inside the dark ramp: SDR 8 / SDR 10 / PQ 10 / PQ 12', `${codes(CODINGS.sdr8)} / ${codes(CODINGS.sdr10)} / ${codes(CODINGS.pq10)} / ${codes(CODINGS.pq12)}`],
      ['Step at 1 nit: SDR 8 bit / PQ 10 bit', `${fmt(stepAt(CODINGS.sdr8, 1) * 100, 3)} % / ${fmt(stepAt(CODINGS.pq10, 1) * 100, 3)} %`],
    ]));
    calc.say(t('Between {lo} and {hi} nits an 8-bit SDR signal has only <strong>{a}</strong> different values, a 10-bit PQ signal <strong>{b}</strong>, though PQ spans 0 to 10 000 nits and SDR only 0 to 100. At 1 nit each step of the 8-bit SDR signal changes the brightness by {s8} %, of 10-bit PQ by {s10} %.', {
      lo: fmt(st.lo, 3), hi: fmt(st.hi, 3), a: codes(CODINGS.sdr8), b: codes(CODINGS.pq10), s8: fmt(stepAt(CODINGS.sdr8, 1) * 100, 2), s10: fmt(stepAt(CODINGS.pq10, 1) * 100, 2),
    }));
    calc.set(String.raw`\begin{aligned}
    L_\text{PQ} &= 10^4\left(\frac{p-c_1}{c_2-c_3\,p}\right)^{1/m_1}\\ p &= E^{1/m_2}\\
    L_\text{PQ}(${texNum(pqInverse(100), 4)}) &= 100\ \text{nits}\\
    L_\text{SDR} &= 100\,V^{2.4}\ \text{nits}\\
    \gamma_\text{HLG} &= 1.2 + 0.42\log_{10}\tfrac{L_w}{1000}\\ &= ${texNum(hlgGamma(st.Lw), 4)}
    \end{aligned}`);
    [ramps, curves, steps, levels].forEach((s) => s.redraw());
  }
  // each band: a ramp from lo to hi (log), quantised by one coding, shown on a log brightness scale
  function drawRamps(ctx, w, hh) {
    ctx.fillStyle = '#05060a'; ctx.fillRect(0, 0, w, hh);
    const st = ctl.state, ks = Object.keys(CODINGS), lo = Math.log(st.lo), span = Math.log(st.hi) - lo, top = 46, bh = (hh - top - 8) / ks.length;
    ctx.font = '12px Inter, sans-serif';
    const lw = Math.min(w * 0.4, 16 + Math.max(...ks.map((k) => ctx.measureText(t(CODINGS[k].label)).width)));
    ks.forEach((k, i) => {
      const c = CODINGS[k];
      paint(ramps, { x: lw, y: top + i * bh + 3, w: w - lw - 10, h: bh - 6 }, (u, v, o) => {
        const L = Math.exp(lo + u * span), q = quantise(c, L), g = encode(Math.max(0, Math.min(1, (Math.log(Math.max(q, 1e-6)) - lo) / span)));
        o[0] = g; o[1] = g; o[2] = g;
      }, `${key}`, i);
      ctx.fillStyle = COLOURS[k]; ctx.font = '12px Inter, sans-serif'; ctx.textAlign = 'right'; ctx.textBaseline = 'middle';
      ctx.fillText(t(c.label), lw - 8, top + (i + 0.5) * bh);
    });
    ctx.fillStyle = 'rgba(255,255,255,0.7)'; ctx.font = '11px "JetBrains Mono", monospace'; ctx.textAlign = 'left'; ctx.textBaseline = 'alphabetic';
    ctx.fillText(`${fmt(st.lo, 3)} nits`, lw, top - 6); ctx.textAlign = 'right'; ctx.fillText(`${fmt(st.hi, 3)} nits`, w - 10, top - 6);
  }
  function drawCurves(ctx, w, hh) {
    const st = ctl.state, pq = [], hlg = [], sdr = [];
    for (let i = 1; i <= 200; i++) { const v = i / 200; pq.push([v, pqEOTF(v)]); hlg.push([v, Math.max(1e-4, hlgEOTF(v, st.Lw))]); sdr.push([v, Math.max(1e-4, sdrEOTF(v))]); }
    plot(ctx, w, hh, {
      title: N_('Brightness for each signal value'), x: { min: 0, max: 1, label: N_('signal (0 … 1)') }, y: { min: 0.01, max: 10000, log: true, label: N_('luminance (nits)') },
      series: [{ data: sdr, color: COLOURS.sdr10, width: 2, label: N_('SDR (gamma 2.4, 100 nits)') }, { data: hlg, color: COLOURS.hlg10, width: 2, label: N_('HLG') }, { data: pq, color: COLOURS.pq10, width: 2, label: N_('PQ') }],
      legend: true,
    });
  }
  function drawSteps(ctx, w, hh) {
    const series = Object.entries(CODINGS).map(([k, c]) => {
      const d = []; for (let e = -3; e <= 4; e += 0.05) { const L = 10 ** e, s = stepAt(c, L); if (isFinite(s) && s > 0) d.push([L, s * 100]); }
      return { data: d, color: COLOURS[k], width: k === 'pq12' ? 1.5 : 2, dash: k === 'pq12' ? [4, 3] : undefined, label: c.label };
    });
    plot(ctx, w, hh, {
      title: N_('Brightness step between neighbouring codes'), x: { min: 0.001, max: 10000, log: true, label: N_('luminance (nits)') }, y: { min: 0.1, max: 100, log: true, label: N_('step (% of the brightness)') },
      series: [...series, { data: [[0.001, 1], [10000, 1]], color: 'rgba(255,255,255,0.4)', width: 1, dash: [2, 3], label: N_('about 1 %: visible in daylight') }], legend: true,
    });
  }
  // a log brightness scale with the levels marked, labels alternating above and below in staggered rows
  function drawLevels(ctx, w, hh) {
    ctx.fillStyle = '#0b0e16'; ctx.fillRect(0, 0, w, hh);
    const lo = Math.log(0.005), hi = Math.log(50000), x0 = 20, x1 = w - 20, X = (L) => x0 + ((Math.log(L) - lo) / (hi - lo)) * (x1 - x0), y = hh / 2, bar = 14;
    ctx.fillStyle = '#e8ecf6'; ctx.font = '600 12px Inter, sans-serif'; ctx.textAlign = 'left'; ctx.textBaseline = 'top';
    ctx.fillText(t('Light levels of screens and of the world'), x0, 8);
    paint(levels, { x: x0, y: y - bar / 2, w: x1 - x0, h: bar }, (u, v, o) => { const g = encode(u * 0.9); o[0] = g; o[1] = g * 0.97; o[2] = g * 0.92; }, 'bar');
    ctx.font = '10.5px "JetBrains Mono", monospace'; ctx.fillStyle = 'rgba(255,255,255,0.45)'; ctx.textAlign = 'center';
    for (let e = -2; e <= 4; e++) { const px = X(10 ** e); ctx.fillRect(px - 0.5, y + bar / 2, 1, 4); ctx.fillText(e < 0 ? `${10 ** e}` : String(10 ** e).replace(/(\d)(?=(\d{3})+$)/g, '$1 '), px, y + bar / 2 + 6); }
    ctx.textAlign = 'right'; ctx.fillText(t('luminance (nits)'), x1, hh - 14);
    const ends = [[], []];
    LEVELS.forEach(([name, L], i) => {
      const px = X(L), up = i % 2 === 0, label = t(name);
      ctx.font = '11px Inter, sans-serif';
      const tw = ctx.measureText(label).width, left = Math.min(Math.max(px - tw / 2, x0), x1 - tw);
      let row = 0; while ((ends[+up][row] ?? -Infinity) > left - 8) row++;
      ends[+up][row] = left + tw;
      const ly = up ? y - bar / 2 - 18 - row * 16 : y + bar / 2 + 34 + row * 16;
      ctx.strokeStyle = 'rgba(255,181,71,0.55)'; ctx.lineWidth = 1; ctx.beginPath(); ctx.moveTo(px + 0.5, up ? ly + 6 : ly - 6); ctx.lineTo(px + 0.5, up ? y - bar / 2 : y + bar / 2 + 18); ctx.stroke();
      ctx.fillStyle = '#ffb547'; ctx.beginPath(); ctx.arc(px, y, 3, 0, 7); ctx.fill();
      ctx.fillStyle = 'rgba(255,255,255,0.85)'; ctx.textAlign = 'left'; ctx.textBaseline = 'middle'; ctx.fillText(label, left, ly);
    });
  }
  update();

  root.append(rule(String.raw`\[\frac{\Delta L}{L} = \frac{L(k+1) - L(k)}{L(k)} \lesssim 1\,\%\]
<p>A step between neighbouring codes becomes visible as a band when it exceeds the eye's contrast threshold, about 1 % in daylight and more in the dark. Gamma 2.4 with 8 bits over 100 nits makes steps of about 7 % at 1 nit; PQ with 12 bits keeps every step below the threshold from 0.001 to 10 000 nits, and with 10 bits (the usual HDR10) close to it.</p>`,
    String.raw`The threshold depends on the size of the area, the surround and adaptation (Barten's model); in practice noise and dithering hide steps somewhat larger than it. Real displays also add a black level, limit their peak and tone-map PQ signals beyond it.`));
  root.append(theory('Coding brightness for the eye', String.raw`
<div class="theory-cols"><div>
<h3>Gamma</h3>
<p>Cathode-ray tubes produced light roughly as the 2.4th power of their drive signal, which happened to suit the eye: perceived lightness is roughly a cube root of luminance, so equal signal steps look roughly equal. BT.1886 keeps \(L = L_w V^{2.4}\) for the 100-nit reference display. Over 0.1–100 nits 8 bits are just enough; stretched to 1000 nits they are not.</p>
<h3>PQ</h3>
<p>The perceptual quantiser (SMPTE ST 2084) was fitted to Barten's model of the eye's contrast sensitivity so that a 12-bit code's steps stay just below the threshold at every luminance from 0.001 to 10 000 nits. It is absolute: a code always means the same number of nits, and a display that cannot reach it must tone-map.</p>
</div><div>
<h3>HLG</h3>
<p>Hybrid log-gamma (BBC and NHK) is relative, like SDR: its lower half is a square root (a gamma close to SDR's, so an old screen shows a reasonable picture) and its upper half logarithmic, compressing highlights. The display applies a system gamma that rises with its peak, 1.2 at 1000 nits.</p>
<h3>Light levels</h3>
<p>Cinema screens are dim: a DCI projector puts 48 nits on the screen for white, Dolby Cinema 108; an SDR television's reference white is 100 nits; HDR televisions reach 1000 nits and more, phones 1500–2000 in small areas. Daylight scenes go far beyond: white paper in sunshine is about 25 000 nits.</p>
</div></div>`));
  root.append(references([
    'S. Miller, M. Nezamabadi &amp; S. Daly, "Perceptual signal coding for more efficient usage of bit codes", SMPTE Motion Imaging J. 122(4), 52 (2013).',
    'SMPTE ST 2084:2014, "High dynamic range electro-optical transfer function of mastering reference displays".',
    'ITU-R Recommendation BT.2100-2, "Image parameter values for high dynamic range television" (2018).',
    'ITU-R Recommendation BT.1886, "Reference electro-optical transfer function for flat panel displays" (2011).',
    'P. G. J. Barten, <i>Contrast Sensitivity of the Human Eye and Its Effects on Image Quality</i>, SPIE Press (1999).',
  ]));
  return () => [ramps, curves, steps, levels].forEach((s) => s.destroy());
}
