// Interface translation. Strings are keyed by their English text, so anything without a
// translation falls back to English. Locales live in js/locales/<lang>.js as { English: text }.
// Placeholders: t('Start ({n} steps)', { n: 5 }). The laboratories' explanations stay English
// for now; test/i18n.test.mjs checks that every interface string has every translation.
export const LANGS = { en: 'English', de: 'Deutsch', fr: 'Français', es: 'Español' };

let dict = {};
export let lang = 'en';

// The stored choice, else the browser's first supported language, else English.
export function pickLang() {
  try { const s = localStorage.getItem('ov-lang'); if (LANGS[s]) return s; } catch { /* storage unavailable */ }
  const nav = typeof navigator === 'undefined' ? [] : navigator.languages || [navigator.language || ''];
  for (const l of nav) { const k = String(l).slice(0, 2).toLowerCase(); if (LANGS[k]) return k; }
  return 'en';
}

export async function loadLocale(l) {
  lang = LANGS[l] ? l : 'en';
  dict = lang === 'en' ? {} : (await import(`../locales/${lang}.js`)).default;
  if (typeof document !== 'undefined') document.documentElement.lang = lang;
  return lang;
}

export function setLang(l) {
  try { localStorage.setItem('ov-lang', l); } catch { /* storage unavailable */ }
  location.reload();
}

// Marks a string for translation where it is defined, for strings translated later with t(variable).
export const N_ = (s) => s;

// German, French and Spanish write decimals with a comma (2,17) and group thousands with a thin
// space. localNum turns a point between digits into a comma, so applying it twice is harmless;
// fmtInt groups whole numbers at the source.
const COMMA = new Set(['de', 'fr', 'es']);
export const decimalComma = () => COMMA.has(lang);
export const localNum = (s) => (COMMA.has(lang) && typeof s === 'string' ? s.replace(/(\d)\.(\d)/g, '$1,$2') : s);
export const fmtInt = (n) => Math.round(n).toString().replace(/\B(?=(\d{3})+(?!\d))/g, COMMA.has(lang) ? '\u202f' : ',');

// a placeholder value: whole numbers from 10 000 up are grouped, decimals localised
const num = (v) => (typeof v === 'number' && Number.isInteger(v) && Math.abs(v) >= 10000 ? fmtInt(v) : localNum(String(v)));

export function t(s, vars) {
  let r = dict[s] ?? s;
  if (vars) r = r.replace(/\{(\w+)\}/g, (m, k) => (k in vars ? num(vars[k]) : m));
  return r;
}
