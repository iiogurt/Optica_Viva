// Every TeX environment used in the page sources exists in the vendored KaTeX: an unknown one
// renders as a red error box, not as an exception, so nothing else would notice.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { runInNewContext } from 'node:vm';

const root = new URL('../', import.meta.url);
const sandbox = {};
sandbox.self = sandbox;
runInNewContext(readFileSync(new URL('vendor/katex/katex.min.js', root), 'utf8'), sandbox);
const { katex } = sandbox;
const sources = ['js/modules', 'js/lib'].flatMap((d) => readdirSync(new URL(d, root)).filter((f) => f.endsWith('.js')).map((f) => `${d}/${f}`));

test('every \\begin{…} environment in the pages renders in KaTeX', () => {
  const envs = new Map();
  for (const f of sources) for (const [, env] of readFileSync(new URL(f, root), 'utf8').matchAll(/\\begin\{([a-zA-Z*]+)\}/g)) envs.set(env, f);
  assert.ok(envs.size >= 2, [...envs.keys()].join(', '));
  for (const [env, f] of envs) {
    const body = /matrix|cases|array/.test(env) ? 'a & b \\\\ c & d' : 'a &= b \\\\ c &= d';
    assert.doesNotThrow(() => katex.renderToString(`\\begin{${env}}${body}\\end{${env}}`, { throwOnError: true, strict: false }), `${env} (in ${f})`);
  }
});
