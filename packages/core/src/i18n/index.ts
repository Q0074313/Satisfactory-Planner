/**
 * Mehrsprachigkeit.
 *
 * Quellsprache ist Deutsch: Texte werden im Code auf Deutsch geschrieben und
 * dienen zugleich als Schlüssel. Für weitere Sprachen gibt es Wörterbücher
 * (Deutsch → Zielsprache). Fehlt eine Übersetzung, erscheint der deutsche
 * Text. Ein Test prüft, dass alle `tr(...)`-Texte übersetzt sind.
 *
 * Platzhalter in geschweiften Klammern werden ersetzt:
 *   tr('{n} Gebäude kopiert.', { n: 3 })
 */
export type Lang = 'de' | 'en';

export const LANGUAGES: { id: Lang; label: string }[] = [
  { id: 'de', label: 'Deutsch' },
  { id: 'en', label: 'English' },
];

let current: Lang = 'de';
const dictionaries: Record<Lang, Map<string, string>> = { de: new Map(), en: new Map() };

export function setLanguage(lang: Lang): void {
  current = lang;
}

export function getLanguage(): Lang {
  return current;
}

/** Registriert Übersetzungen (deutscher Quelltext → Zielsprache). */
export function registerTranslations(lang: Lang, dict: Record<string, string>): void {
  const map = dictionaries[lang];
  for (const [k, v] of Object.entries(dict)) map.set(k, v);
}

export function hasTranslation(lang: Lang, text: string): boolean {
  return lang === 'de' || dictionaries[lang].has(text);
}

export type TrParams = Record<string, string | number>;

function interpolate(s: string, params: TrParams): string {
  return s.replace(/\{(\w+)\}/g, (m, k: string) => {
    const v = params[k];
    if (v === undefined) return m;
    return typeof v === 'number' ? formatNumber(v, 3) : v;
  });
}

/** Übersetzt einen deutschen Quelltext in die aktuelle Sprache. */
export function tr(text: string, params?: TrParams): string {
  const s = current === 'de' ? text : (dictionaries[current].get(text) ?? text);
  return params ? interpolate(s, params) : s;
}

/** Übersetzt in eine bestimmte Sprache (z. B. für Tests). */
export function trIn(lang: Lang, text: string, params?: TrParams): string {
  const s = lang === 'de' ? text : (dictionaries[lang].get(text) ?? text);
  return params ? interpolate(s, params) : s;
}

export function numberLocale(lang: Lang = current): string {
  return lang === 'de' ? 'de-DE' : 'en-US';
}

export function formatNumber(v: number, digits = 2): string {
  return v.toLocaleString(numberLocale(), { maximumFractionDigits: digits });
}

/** Name aus den Spieldaten in der aktuellen Sprache. */
export function localName(name: { de: string; en: string }): string {
  return current === 'de' ? name.de : name.en;
}
