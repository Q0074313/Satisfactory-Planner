import { create } from 'zustand';
import type { AreaKind, LinkKind, LinkRouting, ObjectRef } from '@satis/core';
import { N_ } from '../i18n';
import { usePrefs } from './prefsStore';

export type Mode = 'factory' | 'rail' | 'production' | 'transport' | 'map';

export type Tool =
  | { kind: 'select' }
  /** Neues Gebäude eines Typs oder vorhandenes, nicht platziertes Gebäude absetzen. */
  | { kind: 'place'; type: string; buildingId?: string; recipeId?: string | null; rotationDeg: number; vertical?: 'up' | 'down' }
  | { kind: 'paste'; rotationDeg: number }
  | { kind: 'group'; groupId: string; rotationDeg: number }
  | { kind: 'area'; areaKind: AreaKind }
  | { kind: 'link'; linkKind: LinkKind; tier: string; routing: LinkRouting }
  | { kind: 'measure' };

export type RailTool =
  | { kind: 'select' }
  | { kind: 'track'; z: number }
  | { kind: 'signal'; signalKind: 'block' | 'path' }
  | { kind: 'station'; platforms: number; platformType: 'freight' | 'fluid' | 'empty'; rotationDeg: number }
  | { kind: 'measure' };

export type RailLayerKey = 'blocks' | 'crossings' | 'nodes' | 'otherNetworks' | 'labels' | 'grid' | 'trains' | 'map' | 'resources' | 'factories';

/** Deutsche Bezeichner; Anzeige über t(). */
export const RAIL_LAYER_LABELS: Record<RailLayerKey, string> = {
  blocks: N_('Blöcke einfärben'),
  crossings: N_('Kreuzungen markieren'),
  nodes: N_('Gleisknoten'),
  otherNetworks: N_('Andere Netze (blass)'),
  labels: N_('Beschriftungen'),
  grid: N_('Raster'),
  trains: N_('Züge (Simulation)'),
  map: N_('Kartenbild'),
  resources: N_('Vorkommen'),
  factories: N_('Fabriken (auf der Karte)'),
};

export type LayerKey = 'grid' | 'areas' | 'buildings' | 'ports' | 'belts' | 'pipes' | 'flow' | 'labels' | 'measurements' | 'otherFloors' | 'map' | 'nodes' | 'rail';

export const LAYER_LABELS: Record<LayerKey, string> = {
  grid: N_('Raster'),
  areas: N_('Flächen'),
  buildings: N_('Gebäude'),
  ports: N_('Anschlüsse'),
  belts: N_('Förderbänder'),
  pipes: N_('Rohre'),
  flow: N_('Durchsatz und Auslastung'),
  labels: N_('Beschriftungen'),
  measurements: N_('Maße'),
  otherFloors: N_('Andere Stockwerke (blass)'),
  map: N_('Kartenbild (Fabrik auf der Karte)'),
  nodes: N_('Vorkommen (Fabrik auf der Karte)'),
  rail: N_('Gleise (Fabrik auf der Karte)'),
};

export type BottomTab = 'findings' | 'balance' | 'areas';

export interface Toast {
  id: number;
  message: string;
  kind: 'error' | 'info';
}

export interface Clipboard {
  buildingIds: string[];
}

interface UiState {
  mode: Mode;
  factoryId: string | null;
  floorId: string | null;
  networkId: string | null;
  railTool: RailTool;
  railLayers: Record<RailLayerKey, boolean>;
  selection: ObjectRef[];
  tool: Tool;
  layers: Record<LayerKey, boolean>;
  /** Grundriss oder Seitenansicht (Schnitt entlang x bzw. y). */
  factoryView: 'plan' | 'side-x' | 'side-y' | '3d';
  bottomTab: BottomTab;
  bottomOpen: boolean;
  /** Befunde: nur die zur Ansicht passenden oder alle. */
  findingsScope: 'view' | 'all';
  settingsOpen: boolean;
  /** Dialog „Etwas stimmt nicht?“ (geführte Fehlersuche). */
  diagnoseOpen: boolean;
  /** Dialog „Layout automatisch erzeugen“ (Fabrik und vorgewählter Plan). */
  autoLayout: { factoryId: string; planId: string | null } | null;
  /** Dialog „Rezepte nachschlagen“ (vorgewählter Gegenstand). */
  recipeBook: { itemId: string | null } | null;
  /** Aktive Führung (Tutorial) und Schritt. */
  tour: { id: string; step: number } | null;
  /** Bitte an den Editor, einen Punkt zu zentrieren. */
  focus: { x: number; y: number; seq: number } | null;
  clipboard: Clipboard | null;
  toasts: Toast[];
  setMode(mode: Mode): void;
  setFactory(factoryId: string | null, floorId: string | null): void;
  setFloor(floorId: string): void;
  setNetwork(networkId: string | null): void;
  setRailTool(tool: RailTool): void;
  toggleRailLayer(key: RailLayerKey): void;
  select(refs: ObjectRef[]): void;
  setTool(tool: Tool): void;
  toggleLayer(key: LayerKey): void;
  setFactoryView(v: UiState['factoryView']): void;
  setBottomTab(tab: BottomTab): void;
  toggleBottom(): void;
  setFindingsScope(s: 'view' | 'all'): void;
  setSettingsOpen(open: boolean): void;
  setDiagnoseOpen(open: boolean): void;
  openAutoLayout(factoryId: string, planId?: string | null): void;
  closeAutoLayout(): void;
  openRecipeBook(itemId?: string | null): void;
  closeRecipeBook(): void;
  startTour(id: string): void;
  setTourStep(step: number): void;
  endTour(): void;
  focusOn(x: number, y: number): void;
  setClipboard(c: Clipboard | null): void;
  toast(message: string, kind?: 'error' | 'info'): void;
  dismissToast(id: number): void;
}

let toastSeq = 0;
let focusSeq = 0;

export const useUiStore = create<UiState>((set) => ({
  mode: 'factory',
  factoryId: null,
  floorId: null,
  networkId: null,
  railTool: { kind: 'select' },
  railLayers: { blocks: true, crossings: true, nodes: true, otherNetworks: true, labels: true, grid: true, trains: true, map: true, resources: true, factories: true },
  selection: [],
  tool: { kind: 'select' },
  layers: {
    grid: true,
    areas: true,
    buildings: true,
    ports: true,
    belts: true,
    pipes: true,
    flow: true,
    labels: true,
    measurements: true,
    otherFloors: true,
    map: true,
    nodes: true,
    rail: true,
  },
  factoryView: 'plan',
  bottomTab: 'findings',
  bottomOpen: true,
  findingsScope: 'view',
  settingsOpen: false,
  diagnoseOpen: false,
  autoLayout: null,
  recipeBook: null,
  tour: null,
  focus: null,
  clipboard: null,
  toasts: [],
  setMode: (mode) => set({ mode, selection: [], tool: { kind: 'select' }, railTool: { kind: 'select' } }),
  setFactory: (factoryId, floorId) => set({ factoryId, floorId, selection: [], tool: { kind: 'select' } }),
  setFloor: (floorId) => set({ floorId }),
  setNetwork: (networkId) => set({ networkId, selection: [], railTool: { kind: 'select' } }),
  setRailTool: (railTool) => set({ railTool }),
  toggleRailLayer: (key) => set((s) => ({ railLayers: { ...s.railLayers, [key]: !s.railLayers[key] } })),
  select: (selection) => set({ selection }),
  setTool: (tool) => {
    // Stufe und Verlegemodus für die nächste Benutzung merken
    if (tool.kind === 'link') usePrefs.getState().setLinkTool(tool.linkKind, { tier: tool.tier, routing: tool.routing });
    set({ tool });
  },
  toggleLayer: (key) => set((s) => ({ layers: { ...s.layers, [key]: !s.layers[key] } })),
  setFactoryView: (factoryView) => set({ factoryView }),
  setBottomTab: (bottomTab) => set({ bottomTab, bottomOpen: true }),
  toggleBottom: () => set((s) => ({ bottomOpen: !s.bottomOpen })),
  setFindingsScope: (findingsScope) => set({ findingsScope }),
  setSettingsOpen: (settingsOpen) => set({ settingsOpen }),
  setDiagnoseOpen: (diagnoseOpen) => set({ diagnoseOpen }),
  openAutoLayout: (factoryId, planId = null) => set({ autoLayout: { factoryId, planId } }),
  closeAutoLayout: () => set({ autoLayout: null }),
  openRecipeBook: (itemId = null) => set({ recipeBook: { itemId } }),
  closeRecipeBook: () => set({ recipeBook: null }),
  startTour: (id) => set({ tour: { id, step: 0 } }),
  setTourStep: (step) => set((s) => (s.tour ? { tour: { ...s.tour, step } } : {})),
  endTour: () => set({ tour: null }),
  focusOn: (x, y) => set({ focus: { x, y, seq: ++focusSeq } }),
  setClipboard: (clipboard) => set({ clipboard }),
  toast: (message, kind = 'info') => {
    const id = ++toastSeq;
    set((s) => ({ toasts: [...s.toasts.slice(-4), { id, message, kind }] }));
    setTimeout(() => set((s) => ({ toasts: s.toasts.filter((t) => t.id !== id) })), kind === 'error' ? 6000 : 2500);
  },
  dismissToast: (id) => set((s) => ({ toasts: s.toasts.filter((t) => t.id !== id) })),
}));
