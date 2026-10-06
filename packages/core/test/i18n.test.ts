import { describe, expect, it } from 'vitest';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
// @ts-expect-error – reines JS-Skript ohne Typen
import { extract, walk } from '../../../scripts/i18n-extract.mjs';
import '../src/index.ts';
import { allRules } from '../src/validation/registry.ts';
import { MIGRATIONS } from '../src/project/migrations.ts';
import { hasTranslation, setLanguage, tr } from '../src/i18n/index.ts';

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, '../../..');

describe('Übersetzungen (Englisch)', () => {
  it('alle tr()-Texte im Kern sind übersetzt', () => {
    const found: Map<string, string> = extract(walk(join(root, 'packages/core/src')));
    const missing = [...found.keys()].filter((k) => !hasTranslation('en', k));
    expect(missing).toEqual([]);
  });

  it('alle Regeltitel, Beschreibungen, Quellen und Migrationstexte sind übersetzt', () => {
    const texts = new Set<string>();
    for (const r of allRules()) {
      texts.add(r.title);
      texts.add(r.description);
      for (const s of r.sources) texts.add(s.label);
    }
    for (const m of MIGRATIONS) texts.add(m.description);
    expect([...texts].filter((t) => !hasTranslation('en', t))).toEqual([]);
  });

  it('Platzhalter bleiben in der Übersetzung erhalten', () => {
    const found: Map<string, string> = extract(walk(join(root, 'packages/core/src')));
    setLanguage('en');
    try {
      for (const k of found.keys()) {
        const ph = (s: string) => [...s.matchAll(/\{(\w+)\}/g)].map((m) => m[1]).sort();
        expect(ph(tr(k)), k).toEqual(ph(k));
      }
    } finally {
      setLanguage('de');
    }
  });
});
