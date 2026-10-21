/**
 * Benutzereinstellungen (nicht projektbezogen): Sprache, Farbschema,
 * Tastenbelegung, Tutorialstand. Gespeichert im localStorage des Browsers.
 */
import { create } from 'zustand';
import { setLanguage, type Lang, type LinkKind, type LinkRouting } from '@satis/core';
import { resolveBindings, type Bindings } from './keymap';

export type ThemePref = 'system' | 'dark' | 'light';

/**
 * Fangraster im Schieneneditor (Rasterecken). 4 m trifft im 8-m-Fundamentraster
 * Ecken, Kantenmitten und Feldmitten; 1 m für Feinarbeit.
 */
export interface RailSnap {
  stepM: number;
}
export const RAIL_SNAP_STEPS = [4, 1];
const DEFAULT_RAIL_SNAP: RailSnap = { stepM: 4 };

/** Kartenbild: Spielkarte, realistische Ansicht oder ohne Bild. */
export type MapTiles = 'game' | 'realistic' | 'off';

interface Prefs {
  language: Lang;
  theme: ThemePref;
  keymap: Bindings;
  toursDone: string[];
  /** Begrüßung mit Tutorial-Angebot bereits gezeigt. */
  welcomed: boolean;
  /** Animierter Materialfluss auf Förderbändern. */
  animateFlow: boolean;
  /** Ausführliche Erklärungen in den Touren (Einsteiger). */
  detailedTours: boolean;
  railSnap: RailSnap;
  /** Streamer-Modus: Projekt-Link in der Oberfläche verdecken. */
  streamerMode: boolean;
  /** Zuletzt gewählte Stufe und Verlegemodus je Leitungsart (gilt für die nächste Benutzung des Werkzeugs). */
  linkTools: Partial<Record<LinkKind, { tier: string; routing: LinkRouting }>>;
  mapTiles: MapTiles;
  /** Deckkraft des Kartenbilds (0,1 … 1). */
  mapOpacity: number;
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
  setDetailedTours(v: boolean): void;
  setStreamerMode(v: boolean): void;
  setRailSnap(v: RailSnap): void;
  setLinkTool(kind: LinkKind, v: { tier: string; routing: LinkRouting }): void;
  setMapTiles(v: MapTiles): void;
  setMapOpacity(v: number): void;
}

const KEY = 'satis-planner:prefs';

function load(): Prefs {
  // Standardsprache Englisch, unabhängig von der Browsersprache
  const base: Prefs = { language: 'en', theme: 'system', keymap: {}, toursDone: [], welcomed: false, animateFlow: true, detailedTours: false, streamerMode: false, railSnap: DEFAULT_RAIL_SNAP, linkTools: {}, mapTiles: 'game', mapOpacity: 0.85 };
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
      detailedTours: !!v.detailedTours,
      streamerMode: !!v.streamerMode,
      railSnap: v.railSnap && RAIL_SNAP_STEPS.includes(v.railSnap.stepM) ? { stepM: v.railSnap.stepM } : DEFAULT_RAIL_SNAP,
      linkTools: v.linkTools && typeof v.linkTools === 'object' ? v.linkTools : {},
      mapTiles: v.mapTiles === 'realistic' || v.mapTiles === 'off' ? v.mapTiles : 'game',
      mapOpacity: typeof v.mapOpacity === 'number' && v.mapOpacity >= 0.1 && v.mapOpacity <= 1 ? v.mapOpacity : base.mapOpacity,
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
    save({
      language: s.language,
      theme: s.theme,
      keymap: s.keymap,
      toursDone: s.toursDone,
      welcomed: s.welcomed,
      animateFlow: s.animateFlow,
      detailedTours: s.detailedTours,
      streamerMode: s.streamerMode,
      railSnap: s.railSnap,
      linkTools: s.linkTools,
      mapTiles: s.mapTiles,
      mapOpacity: s.mapOpacity,
    });
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
    setDetailedTours(detailedTours) {
      set({ detailedTours });
      persist();
    },
    setStreamerMode(streamerMode) {
      set({ streamerMode });
      persist();
    },
    setRailSnap(railSnap) {
      set({ railSnap: { ...railSnap } });
      persist();
    },
    setLinkTool(kind, v) {
      const cur = get().linkTools[kind];
      if (cur && cur.tier === v.tier && cur.routing === v.routing) return;
      set({ linkTools: { ...get().linkTools, [kind]: { ...v } } });
      persist();
    },
    setMapTiles(mapTiles) {
      set({ mapTiles });
      persist();
    },
    setMapOpacity(mapOpacity) {
      set({ mapOpacity: Math.min(1, Math.max(0.1, mapOpacity)) });
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
