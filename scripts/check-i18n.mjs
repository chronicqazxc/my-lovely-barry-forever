// Usage: npm run check:i18n
// Checks the four locale files agree (same keys, same {placeholders}, same content fields) and that every
// key the front end uses exists. Exits 1 with a list of problems, so it can be run before a deploy.
import fs from 'node:fs';
import path from 'node:path';

const root = path.join(path.dirname(new URL(import.meta.url).pathname), '..', 'public');
const LANGS = ['en', 'zh-TW', 'ja', 'ko'];
const locales = Object.fromEntries(LANGS.map((l) => [l, JSON.parse(fs.readFileSync(path.join(root, 'locales', `${l}.json`), 'utf8'))]));
const problems = [];
const flat = (d) => Object.fromEntries(Object.entries(d).filter(([k]) => k !== 'content'));
const holders = (s) => [...String(s).matchAll(/\{(\w+)\}/g)].map((m) => m[1]).sort().join(',');

const base = flat(locales.en);
for (const l of LANGS.slice(1)) {
  const other = flat(locales[l]);
  for (const k of Object.keys(base)) if (!(k in other)) problems.push(`${l}: missing key ${k}`);
  for (const k of Object.keys(other)) if (!(k in base)) problems.push(`${l}: extra key ${k} (not in en)`);
  for (const k of Object.keys(base)) if (k in other && holders(base[k]) !== holders(other[k])) problems.push(`${l}: placeholders differ in ${k} ({${holders(other[k])}} vs en {${holders(base[k])}})`);
  for (const f of Object.keys(locales.en.content)) {
    if (!(f in (locales[l].content ?? {}))) problems.push(`${l}: missing content.${f}`);
  }
}
for (const l of LANGS) for (const [k, v] of Object.entries(flat(locales[l]))) if (!String(v).trim()) problems.push(`${l}: empty ${k}`);

// Keys used by the page and scripts must exist.
const files = [path.join(root, 'index.html'), ...fs.readdirSync(path.join(root, 'js')).map((f) => path.join(root, 'js', f))];
const src = files.map((f) => fs.readFileSync(f, 'utf8')).join('\n');
const used = new Set([
  ...[...src.matchAll(/data-i18n(?:-placeholder)?="([\w.]+)"/g)].map((m) => m[1]),
  ...[...src.matchAll(/\bt\('([\w.]+)'/g)].map((m) => m[1]),
]);
const has = (k) => k in base || `${k}_one` in base;
for (const k of used) if (!has(k)) problems.push(`code uses ${k} but locales/en.json has no such key`);

if (problems.length) {
  console.error(problems.map((p) => `- ${p}`).join('\n'));
  process.exit(1);
}
console.log(`i18n ok: ${Object.keys(base).length} keys x ${LANGS.length} languages, ${used.size} keys referenced from code.`);
