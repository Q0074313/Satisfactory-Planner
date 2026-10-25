/**
 * Benutzereinstellungen (nicht projektbezogen): Sprache, Farbschema,
 * Tastenbelegung, Tutorialstand. Gespeichert im localStorage des Browsers.
 */
import { create } from 'zustand';
import { setLanguage, type AutoLayoutOptions, type Lang, type LayoutVariant, type LinkKind, type LinkRouting } from '@satis/core';
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

/** Farben, die sich in den Einstellungen anpassen lassen (Schlüssel der Zeichenpalette). */
export const CUSTOM_COLOR_KEYS = [
  'belt0', 'belt1', 'belt2', 'belt3', 'belt4', 'belt5',
  'pipe0', 'pipe1',
  'portIn', 'portOut', 'fuelPort',
  'production', 'extraction', 'power', 'logistics', 'storage',
  'selection', 'overload',
] as const;
export type CustomColorKey = (typeof CUSTOM_COLOR_KEYS)[number];

/** Selbst gespeicherte Bauart für das automatische Layout (ohne Fläche und Plan). */
export interface LayoutPreset {
  name: string;
  options: Partial<AutoLayoutOptions>;
  variant: LayoutVariant;
}

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
  /** Eigene Bauarten für das automatische Layout. */
  layoutPresets: LayoutPreset[];
  /** Deckkraft von Leitungen und Gebäuden auf nicht gewählten Stockwerken (0 = ausgeblendet … 1). */
  otherFloorOpacity: number;
  /** Eigene Farben (überschreiben das Farbschema). */
  colors: Partial<Record<CustomColorKey, string>>;
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
  saveLayoutPreset(p: LayoutPreset): void;
  removeLayoutPreset(name: string): void;
  setOtherFloorOpacity(v: number): void;
  setColor(key: CustomColorKey, color: string | null): void;
  resetColors(): void;
}

const KEY = 'satis-planner:prefs';

function load(): Prefs {
  // Standardsprache Englisch, unabhängig von der Browsersprache
  const base: Prefs = { language: 'en', theme: 'system', keymap: {}, toursDone: [], welcomed: false, animateFlow: true, detailedTours: false, streamerMode: false, railSnap: DEFAULT_RAIL_SNAP, linkTools: {}, mapTiles: 'game', mapOpacity: 0.85, layoutPresets: [], otherFloorOpacity: 0.15, colors: {} };
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
      layoutPresets: Array.isArray(v.layoutPresets) ? v.layoutPresets.filter((x: LayoutPreset) => x && typeof x.name === 'string' && x.options && typeof x.options === 'object') : [],
      // 0,25 war der Standard bis 0.7.2 (wurde mitgespeichert) → neuer Standard
      otherFloorOpacity: typeof v.otherFloorOpacity === 'number' && v.otherFloorOpacity >= 0 && v.otherFloorOpacity <= 1 && v.otherFloorOpacity !== 0.25 ? v.otherFloorOpacity : base.otherFloorOpacity,
      colors: cleanColors(v.colors),
    };
  } catch {
    return base;
  }
}

const HEX = /^#[0-9a-f]{6}$/i;

function cleanColors(v: unknown): Prefs['colors'] {
  const out: Prefs['colors'] = {};
  if (!v || typeof v !== 'object') return out;
  for (const k of CUSTOM_COLOR_KEYS) {
    const c = (v as Record<string, unknown>)[k];
    if (typeof c === 'string' && HEX.test(c)) out[k] = c;
  }
  return out;
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
      layoutPresets: s.layoutPresets,
      otherFloorOpacity: s.otherFloorOpacity,
      colors: s.colors,
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
    saveLayoutPreset(p) {
      set({ layoutPresets: [...get().layoutPresets.filter((x) => x.name !== p.name), p] });
      persist();
    },
    removeLayoutPreset(name) {
      set({ layoutPresets: get().layoutPresets.filter((x) => x.name !== name) });
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
    setOtherFloorOpacity(v) {
      set({ otherFloorOpacity: Math.min(1, Math.max(0, v)) });
      persist();
    },
    setColor(key, color) {
      const colors = { ...get().colors };
      if (color && HEX.test(color)) colors[key] = color;
      else delete colors[key];
      set({ colors });
      persist();
    },
    resetColors() {
      set({ colors: {} });
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
