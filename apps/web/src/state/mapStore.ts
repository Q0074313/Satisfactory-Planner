/**
 * Zustand der Kartenansicht (nicht im Projekt gespeichert): Auswahl,
 * Werkzeug, Ebenen, Filter der Vorkommen und Standortvorschläge.
 */
import { create } from 'zustand';
import type { MapNodeKind, Purity, SiteSuggestion, geo } from '@satis/core';
import { N_ } from '../i18n';

export type MapLayerKey = 'nodes' | 'factories' | 'rail' | 'transport' | 'labels' | 'grid';

export const MAP_LAYER_LABELS: Record<MapLayerKey, string> = {
  nodes: N_('Vorkommen'),
  factories: N_('Fabriken'),
  rail: N_('Schienennetze'),
  transport: N_('Transportaufträge'),
  labels: N_('Beschriftungen'),
  grid: N_('Weltraster'),
};

export type MapSelection = { kind: 'node'; id: string } | { kind: 'factory'; id: string } | null;

export type MapTool = { kind: 'select' } | { kind: 'place-factory'; factoryId: string; rotationDeg: number };

/** Sichtbarer Weltbereich der Karte (von der Kartenansicht laufend gesetzt, ohne Neuzeichnen der Leisten). */
export const mapView: { rect: geo.Rect | null } = { rect: null };

export interface SiteSearch {
  planId: string;
  /** Ganze Karte oder nur der aktuelle Ausschnitt. */
  scope: 'all' | 'view';
  minerType: string;
  clock: number;
  radiusM: number;
  results: SiteSuggestion[];
  active: number | null;
}

interface MapState {
  selection: MapSelection;
  tool: MapTool;
  layers: Record<MapLayerKey, boolean>;
  /** Ausgeblendete Rohstoffe (Gegenstand bzw. `geyser`). */
  hiddenResources: string[];
  purities: Record<Purity, boolean>;
  kinds: Record<Exclude<MapNodeKind, 'geyser'>, boolean>;
  onlyFree: boolean;
  sites: SiteSearch | null;
  /** Vorkommen unter dem Mauszeiger in einer Liste (wird auf der Karte hervorgehoben). */
  hoverNodeId: string | null;
  /** Bitte an die Karte, einen Weltpunkt zu zentrieren. */
  focus: { x: number; y: number; scale?: number; seq: number } | null;
  select(s: MapSelection): void;
  setTool(t: MapTool): void;
  toggleLayer(k: MapLayerKey): void;
  toggleResource(id: string): void;
  setHiddenResources(ids: string[]): void;
  togglePurity(p: Purity): void;
  toggleKind(k: Exclude<MapNodeKind, 'geyser'>): void;
  setOnlyFree(v: boolean): void;
  setSites(s: SiteSearch | null): void;
  setHoverNode(id: string | null): void;
  focusOn(x: number, y: number, scale?: number): void;
}

let seq = 0;

export const useMapStore = create<MapState>((set) => ({
  selection: null,
  tool: { kind: 'select' },
  layers: { nodes: true, factories: true, rail: true, transport: true, labels: true, grid: false },
  hiddenResources: [],
  purities: { impure: true, normal: true, pure: true },
  kinds: { node: true, well: true, 'well-core': true },
  onlyFree: false,
  sites: null,
  hoverNodeId: null,
  focus: null,
  select: (selection) => set({ selection }),
  setTool: (tool) => set({ tool }),
  toggleLayer: (k) => set((s) => ({ layers: { ...s.layers, [k]: !s.layers[k] } })),
  toggleResource: (id) => set((s) => ({ hiddenResources: s.hiddenResources.includes(id) ? s.hiddenResources.filter((x) => x !== id) : [...s.hiddenResources, id] })),
  setHiddenResources: (hiddenResources) => set({ hiddenResources }),
  togglePurity: (p) => set((s) => ({ purities: { ...s.purities, [p]: !s.purities[p] } })),
  toggleKind: (k) => set((s) => ({ kinds: { ...s.kinds, [k]: !s.kinds[k] } })),
  setOnlyFree: (onlyFree) => set({ onlyFree }),
  setSites: (sites) => set({ sites }),
  setHoverNode: (hoverNodeId) => set({ hoverNodeId }),
  focusOn: (x, y, scale) => set({ focus: { x, y, scale, seq: ++seq } }),
}));
