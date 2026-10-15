// Mission "Portrait session": perspective, focal length for the framing, depth of field at equal
// magnification, background blur.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { noseEnlargement, naturalDistance, plan } from '../js/lib/portrait.js';

const near = (a, b, tol, msg) => assert.ok(Math.abs(a - b) <= tol, `${msg}: ${a} vs ${b}`);

test('nose enlargement falls with distance; 5 % at about 2.5 m', () => {
  near(noseEnlargement(0.5), 0.301, 0.002, 'selfie distance');
  near(noseEnlargement(naturalDistance(0.05)), 0.05, 1e-12, 'inverse');
  near(naturalDistance(0.05), 2.47, 0.01, 'natural distance');
});

test('focal length fills the framing: about 123 mm for head and shoulders at 2 m on full frame', () => {
  near(plan({ d: 2 }).f * 1000, 122.9, 0.2, 'head and shoulders');
});

test('same framing, same aperture: the same depth of field at any distance', () => {
  const a = plan({ d: 0.8, N: 2 }), b = plan({ d: 3, N: 2 });
  near(a.dof, b.dof, 0.002, 'magnification decides');
  near(a.dof, 0.029, 0.002, 'about 3 cm at f/2');
});

test('a farther background blurs more', () => {
  assert.ok(plan({ B: 6 }).bgShare > plan({ B: 1 }).bgShare * 2);
});
