// 3-D scene for the black-hole laboratory (shown by js/lib/gl3d.js): the event horizon, the photon
// sphere, the accretion disk and real light paths of several impact parameters around the hole,
// coloured by fate: captured (inside the shadow), winding near b = 3√3 M, or escaping bent. Pure.
import { orbit, B_CRIT, R_ISCO } from './blackhole.js';
import { sphere, annulus } from './mesh3d.js';
import { N_ } from './i18n.js';

const RMAX = 26;
// points of an orbit in the plane z = 0, from the observer's side (+x) inwards
export function orbitPoints(b) {
  const o = orbit(b), pts = [], step = 3;
  for (let i = 0; i < o.u.length; i += step) {
    const u = o.u[i], phi = i * 0.004;
    if (u <= 0) continue;
    const r = 1 / u;
    if (r > RMAX) continue;
    pts.push([r * Math.cos(phi), r * Math.sin(phi), 0]);
  }
  if (o.captured) pts.push([2 * Math.cos(o.phiEnd), 2 * Math.sin(o.phiEnd), 0]); // ends on the horizon
  return { pts, captured: o.captured };
}

export function blackholeScene({ rOut = 20 } = {}) {
  const meshes = [
    { mesh: sphere(2, [0, 0, 0], 40, 20), color: [0.02, 0.02, 0.03] },
    { mesh: annulus(R_ISCO, rOut, 0, 96), color: [1, 0.62, 0.25], opacity: 0.16, glass: true },
  ];
  const lines = [], labels = [];
  const ring = Array.from({ length: 121 }, (_, i) => [3 * Math.cos((i * Math.PI) / 60), 3 * Math.sin((i * Math.PI) / 60), 0]);
  lines.push({ points: ring, color: [0.42, 0.84, 1, 0.7], width: 1.2, glow: false });
  for (const b of [2.5, 4, 5, B_CRIT - 0.002, B_CRIT + 0.002, 5.6, 6.5, 8, 11, 15]) {
    const { pts, captured } = orbitPoints(b);
    if (pts.length < 2) continue;
    const near = Math.abs(b - B_CRIT) < 0.01;
    lines.push({ points: pts, color: captured ? [1, 0.42, 0.42, 0.9] : near ? [0.42, 0.84, 1, 0.95] : [1, 0.71, 0.28, 0.85], width: near ? 2 : 1.4 });
  }
  labels.push({ p: [0, -2.9, 0], text: N_('event horizon, r = 2M'), color: 'rgba(255,255,255,0.75)' },
    { p: [0, 3.5, 0.6], text: N_('photon sphere, r = 3M'), color: '#6ad7ff' },
    { p: [rOut * 0.55, rOut * 0.55, 0.8], text: N_('accretion disk from 6M (innermost stable orbit)'), color: '#ffb547' },
    { p: [RMAX * 0.85, 0, 0], text: N_('to the telescope'), color: '#c9cfdc' });
  return { meshes, lines, labels };
}
