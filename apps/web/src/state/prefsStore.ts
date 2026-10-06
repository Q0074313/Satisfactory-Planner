/**
 * Benutzereinstellungen (nicht projektbezogen): Sprache, Farbschema,
 * Tastenbelegung, Tutorialstand. Gespeichert im localStorage des Browsers.
 */
import { create } from 'zustand';
import { setLanguage, type Lang } from '@satis/core';
import { resolveBindings, type Bindings } from './keymap';

export type ThemePref = 'system' | 'dark' | 'light';

interface Prefs {
  language: Lang;
  theme: ThemePref;
  keymap: Bindings;
  toursDone: string[];
  /** Begrüßung mit Tutorial-Angebot bereits gezeigt. */
  welcomed: boolean;
  /** Animierter Materialfluss auf Förderbändern. */
  animateFlow: boolean;
}

interface PrefsState extends Prefs {
  bindings: Bindings;
  setLanguage(lang: Lang): void;
  setTheme(theme: ThemePref): void;
  setBinding(actionId: string, combos: string[] | null): void;
  resetKeymap(): void;
  markTourDone(id: string): void;
  setWelcomed(): void;
  setAnimateFlow(v: boolean): void;
}

const KEY = 'satis-planner:prefs';

function detectLanguage(): Lang {
  try {
    return navigator.language?.toLowerCase().startsWith('de') ? 'de' : 'en';
  } catch {
    return 'de';
  }
}

function load(): Prefs {
  const base: Prefs = { language: detectLanguage(), theme: 'system', keymap: {}, toursDone: [], welcomed: false, animateFlow: true };
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return base;
    const v = JSON.parse(raw) as Partial<Prefs>;
    return {
      language: v.language === 'en' || v.language === 'de' ? v.language : base.language,
      theme: v.theme === 'dark' || v.theme === 'light' || v.theme === 'system' ? v.theme : 'system',
      keymap: v.keymap && typeof v.keymap === 'object' ? v.keymap : {},
      toursDone: Array.isArray(v.toursDone) ? v.toursDone : [],
      welcomed: !!v.welcomed,
      animateFlow: v.animateFlow !== false,
    };
  } catch {
    return base;
  }
}

function save(p: Prefs) {
  try {
    localStorage.setItem(KEY, JSON.stringify(p));
  } catch {
    /* Speicher nicht verfügbar */
  }
}

const initial = load();
setLanguage(initial.language);

export const usePrefs = create<PrefsState>((set, get) => {
  const persist = () => {
    const s = get();
    save({ language: s.language, theme: s.theme, keymap: s.keymap, toursDone: s.toursDone, welcomed: s.welcomed, animateFlow: s.animateFlow });
  };
  return {
    ...initial,
    bindings: resolveBindings(initial.keymap),
    setLanguage(language) {
      setLanguage(language);
      set({ language });
      persist();
    },
    setTheme(theme) {
      set({ theme });
      persist();
    },
    setBinding(actionId, combos) {
      const keymap = { ...get().keymap };
      if (combos === null) delete keymap[actionId];
      else keymap[actionId] = combos;
      set({ keymap, bindings: resolveBindings(keymap) });
      persist();
    },
    resetKeymap() {
      set({ keymap: {}, bindings: resolveBindings({}) });
      persist();
    },
    markTourDone(id) {
      if (get().toursDone.includes(id)) return;
      set({ toursDone: [...get().toursDone, id] });
      persist();
    },
    setWelcomed() {
      set({ welcomed: true });
      persist();
    },
    setAnimateFlow(animateFlow) {
      set({ animateFlow });
      persist();
    },
  };
});

/** Tatsächliches Farbschema (System-Einstellung aufgelöst). */
export function effectiveTheme(pref: ThemePref): 'dark' | 'light' {
  if (pref !== 'system') return pref;
  try {
    return window.matchMedia('(prefers-color-scheme: light)').matches ? 'light' : 'dark';
  } catch {
    return 'dark';
  }
}
