// Catalogue of phenomena: data integrity, details for every entry, valid laboratory links and
// equations that KaTeX can render.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import { GROUPS, COUNT } from '../js/lib/phenomena.js';
import { DETAILS } from '../js/lib/phenomena-details.js';

// the vendored UMD build, evaluated as CommonJS (the package is "type": "module")
const sandbox = { module: { exports: {} } };
sandbox.exports = sandbox.module.exports;
vm.runInNewContext(readFileSync(new URL('../vendor/katex/katex.min.js', import.meta.url), 'utf8'), sandbox);
const katex = sandbox.module.exports;
const entries = GROUPS.flatMap((g) => g.items.map((it) => ({ g, name: it[0], lab: it[1], doms: it[2], desc: it[3], eq: it[4] })));
const labs = new Set([...readFileSync(new URL('../js/app.js', import.meta.url), 'utf8').matchAll(/\{ id: '([a-z0-9-]+)'/g)].map((m) => m[1]));
const slug = (s) => s.toLowerCase().normalize('NFKD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');

test('names, URL slugs and group ids are unique', () => {
  assert.equal(entries.length, COUNT);
  for (const [what, list] of [['name', entries.map((e) => e.name)], ['slug', entries.map((e) => slug(e.name))], ['group id', GROUPS.map((g) => g.id)]]) {
    const dup = list.filter((x, i) => list.indexOf(x) !== i);
    assert.deepEqual(dup, [], `duplicate ${what}s`);
  }
});

test('every entry has a valid laboratory link (or none), domains and a description', () => {
  for (const e of entries) {
    assert.ok(e.lab === null || labs.has(e.lab), `${e.name}: unknown laboratory ${e.lab}`);
    assert.match(e.doms, /^[pvs]{1,3}$/, e.name);
    assert.ok(e.desc.length > 20, e.name);
  }
});

test('every entry has an explanation and a worked example, and nothing else is described', () => {
  for (const e of entries) {
    const d = DETAILS[e.name];
    assert.ok(Array.isArray(d) && d.length === 2 && d[0].length > 80 && d[1].length > 20, `${e.name}: details missing or too short`);
    assert.ok(!/<(?!\/?(sub|sup|em|b)>)/.test(d.join(' ')), `${e.name}: unexpected HTML (write "below", not "<")`);
  }
  const names = new Set(entries.map((e) => e.name));
  assert.deepEqual(Object.keys(DETAILS).filter((k) => !names.has(k)), [], 'details for unknown entries');
});

test('every equation and inline formula renders with KaTeX', () => {
  for (const e of entries) {
    assert.doesNotThrow(() => katex.renderToString('\\displaystyle ' + e.eq, { throwOnError: true, strict: false }), `${e.name}: ${e.eq}`);
    for (const m of DETAILS[e.name].join(' ').matchAll(/\\\((.+?)\\\)/g)) assert.doesNotThrow(() => katex.renderToString(m[1], { throwOnError: true, strict: false }), `${e.name}: ${m[1]}`);
  }
});
