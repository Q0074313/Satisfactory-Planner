// Listet alle übersetzbaren Texte: tr('…') / t('…') in Quelltexten und Regeltexte.
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

export function walk(dir, out = []) {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) {
      if (name === 'node_modules' || name === 'dist' || name === 'i18n') continue;
      walk(p, out);
    } else if (/\.(ts|tsx)$/.test(name) && !/\.test\.ts$/.test(name)) out.push(p);
  }
  return out;
}

const RE = /\b(?:tr|t|N_)\(\s*(['"])((?:\\.|(?!\1)[^\\])*)\1/g;

export function extract(files) {
  const found = new Map();
  for (const f of files) {
    const src = readFileSync(f, 'utf8');
    for (const m of src.matchAll(RE)) {
      const raw = m[2];
      const text = raw.replace(/\\(['"\\])/g, '$1').replace(/\\n/g, '\n');
      if (!found.has(text)) found.set(text, f);
    }
  }
  return found;
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  const dirs = process.argv.slice(2);
  const files = dirs.flatMap((d) => walk(d));
  const found = extract(files);
  for (const [k] of found) console.log(JSON.stringify(k));
}
