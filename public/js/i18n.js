export const LANGS = [
  { code: 'en', label: 'English', short: 'EN' },
  { code: 'zh-TW', label: '繁體中文（台灣）', short: '繁中' },
  { code: 'ja', label: '日本語', short: '日本語' },
  { code: 'ko', label: '한국어', short: '한국어' },
];
const KEY = 'barry-lang';
const codes = LANGS.map((l) => l.code);

export function detectLang() {
  const fromUrl = new URLSearchParams(location.search).get('lang');
  if (codes.includes(fromUrl)) return fromUrl;
  try {
    const stored = localStorage.getItem(KEY);
    if (codes.includes(stored)) return stored;
  } catch {}
  for (const raw of navigator.languages ?? [navigator.language]) {
    const l = (raw || '').toLowerCase();
    if (l.startsWith('ja')) return 'ja';
    if (l.startsWith('ko')) return 'ko';
    if (l.startsWith('zh')) return 'zh-TW';
    if (l.startsWith('en')) return 'en';
  }
  return 'en';
}

export function rememberLang(lang) {
  try { localStorage.setItem(KEY, lang); } catch {}
}

export async function loadLocale(lang) {
  const res = await fetch(`/locales/${lang}.json`);
  if (!res.ok) throw new Error(`locale ${lang}`);
  return res.json();
}

// Build a translator for a loaded dictionary. Supports {placeholders} and
// plural suffixes (key_one / key_other) chosen via Intl.PluralRules.
export function translator(lang, dict) {
  const rules = new Intl.PluralRules(lang);
  const fill = (s, vars) => s.replace(/\{(\w+)\}/g, (_, k) => vars?.[k] ?? `{${k}}`);
  return (key, vars = {}) => {
    const plural = vars.n !== undefined ? dict[`${key}_${rules.select(vars.n)}`] : undefined;
    return fill(plural ?? dict[key] ?? key, vars);
  };
}
