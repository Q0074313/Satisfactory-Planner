import { describe, expect, it } from 'vitest';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
// @ts-expect-error – reines JS-Skript ohne Typen
import { extract, walk } from '../../../../scripts/i18n-extract.mjs';
import { hasTranslation, setLanguage, tr } from '@satis/core';
import './index';

const here = dirname(fileURLToPath(import.meta.url));

describe('Übersetzungen der Oberfläche (Englisch)', () => {
  const found: Map<string, string> = extract(walk(join(here, '..')));

  it('alle t()- und N_()-Texte sind übersetzt', () => {
    const missing = [...found.entries()].filter(([k]) => !hasTranslation('en', k)).map(([k, f]) => `${k}  (${f})`);
    expect(missing).toEqual([]);
  });

  it('Platzhalter bleiben erhalten', () => {
    setLanguage('en');
    try {
      const ph = (s: string) => [...s.matchAll(/\{(\w+)\}/g)].map((m) => m[1]).sort();
      for (const k of found.keys()) expect(ph(tr(k)), k).toEqual(ph(k));
    } finally {
      setLanguage('de');
    }
  });
});
