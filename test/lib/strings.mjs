// Interface strings found statically in the source, for test/i18n.test.mjs: arguments of t() and
// N_(), the laboratory registry, and the labels the UI toolkit translates by itself: control specs
// (label, hint, option texts), readout names, figure captions (2-D and 3-D) and live-calculation titles.
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';

const walk = (d) => readdirSync(d).flatMap((f) => { const p = join(d, f); return statSync(p).isDirectory() ? walk(p) : p.endsWith('.js') ? [p] : []; });
const decode = (lit) => new Function('return ' + lit)();

// Index just past the bracket matching src[i] ('{', '[' or '('), skipping strings and comments.
function matchEnd(src, i) {
  const open = src[i], close = { '{': '}', '[': ']', '(': ')' }[open];
  let depth = 0;
  for (let k = i; k < src.length; k++) {
    const c = src[k];
    if (c === "'" || c === '"' || c === '`') { k = strEnd(src, k) - 1; continue; }
    if (c === '/' && src[k + 1] === '/') { k = src.indexOf('\n', k); continue; }
    if (c === open) depth++;
    else if (c === close && --depth === 0) return k + 1;
  }
  return src.length;
}
function strEnd(src, i) {
  const q = src[i];
  for (let k = i + 1; k < src.length; k++) {
    if (src[k] === '\\') { k++; continue; }
    if (q === '`' && src[k] === '$' && src[k + 1] === '{') { k = matchEnd(src, k + 1) - 1; continue; }
    if (src[k] === q) return k + 1;
  }
  return src.length;
}
// Index of the '{' that opens the object literal containing position i.
function objStart(src, i) {
  for (let k = i, depth = 0; k >= 0; k--) {
    if (src[k] === '}') depth++;
    else if (src[k] === '{') { if (depth === 0) return k; depth--; }
  }
  return -1;
}
const PLAIN = String.raw`'(?:[^'\\\n]|\\.)*'|"(?:[^"\\\n]|\\.)*"|\x60(?:[^\x60\\$]|\\.)*\x60`;
// the literal, if the expression is one complete literal (not 'a' + b)
const plain = (s) => new RegExp(String.raw`^\s*(${PLAIN})\s*$`).exec(s)?.[1];
// Top-level elements of an array literal's source, '[ … ]'.
function elements(arr) {
  const out = [];
  let k = 1, start = 1;
  while (k < arr.length - 1) {
    const c = arr[k];
    if (c === "'" || c === '"' || c === '`') k = strEnd(arr, k);
    else if (c === '[' || c === '{' || c === '(') k = matchEnd(arr, k);
    else if (c === ',') { out.push(arr.slice(start, k)); start = ++k; }
    else k++;
  }
  if (arr.slice(start, -1).trim()) out.push(arr.slice(start, -1));
  return out;
}
const textOf = (el) => {
  const t = el.trim();
  if (t.startsWith('[')) { const parts = elements(t); return parts[1] ? plain(parts[1]) : null; }
  return plain(t);
};

export function interfaceStrings(files = walk('js').filter((f) => !f.startsWith(join('js', 'locales')))) {
  const keys = new Set(), add = (lit) => { if (lit) { const s = decode(lit); if (/[A-Za-z]{2}/.test(s)) keys.add(s); } };
  for (const f of files) {
    const src = readFileSync(f, 'utf8');
    for (const m of src.matchAll(new RegExp(String.raw`(?<![\w.$])(?:t|N_)\(\s*(${PLAIN})`, 'g'))) add(m[1]);
    // control specs: { type: 'range' | 'select' | 'toggle' | 'seg' | 'heading', label, hint, options }
    for (const m of src.matchAll(/\btype: '(?:range|select|toggle|seg|heading)'/g)) {
      const a = objStart(src, m.index), obj = src.slice(a, matchEnd(src, a));
      for (const k of ['label', 'hint']) { const x = new RegExp(String.raw`\b${k}: (${PLAIN})\s*[,}]`).exec(obj); if (x) add(x[1]); }
      const o = /\boptions: \[/.exec(obj);
      if (o) for (const el of elements(obj.slice(o.index + 9, matchEnd(obj, o.index + 9)))) add(textOf(el));
    }
    // readouts([['Name', value], …]) and figure captions stage({ label })
    for (const m of src.matchAll(/\breadouts\(\[/g)) {
      const a = m.index + 'readouts('.length;
      for (const el of elements(src.slice(a, matchEnd(src, a)))) if (el.trim().startsWith('[')) add(plain(elements(el.trim())[0] || ''));
    }
    for (const m of src.matchAll(new RegExp(String.raw`\bliveCalc\(\s*(${PLAIN})\s*\)`, 'g'))) add(m[1]);
    // chart text: plot(ctx, w, h, { title, x: { label }, y: { label }, series: [{ label }], hlines/vlines: [{ label }] })
    for (const m of src.matchAll(/\bplot\(ctx\b/g)) {
      const a = m.index + 'plot'.length, call = src.slice(a, matchEnd(src, a));
      for (const x of call.matchAll(new RegExp(String.raw`\b(?:title|label): (${PLAIN})\s*[,}]`, 'g'))) add(x[1]);
    }
    // 3-D view labels { p: [x, y, z], text, vars }, translated by gl3d when drawn
    for (const m of src.matchAll(new RegExp(String.raw`\btext: (${PLAIN})\s*[,}]`, 'g'))) {
      const a = objStart(src, m.index);
      if (/^\{\s*p: /.test(src.slice(a, m.index))) add(m[1]);
    }
    for (const m of src.matchAll(/\b(?:stage|view3d)\(\{/g)) {
      const a = m.index + m[0].length - 1, obj = src.slice(a, matchEnd(src, a));
      const x = new RegExp(String.raw`\blabel: (${PLAIN})\s*[,}]`).exec(obj);
      if (x) add(x[1]);
    }
  }
  return keys;
}
