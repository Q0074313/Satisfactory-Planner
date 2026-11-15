/**
 * Automatischer Fabrikgrundriss aus einem Produktionsplan – Bauart „Hauptbus“.
 *
 * Aufbau (orientiert an üblichen Bauweisen im Spiel, siehe docs/SPIELREGELN.md):
 * - **Linien:** Maschinen eines Rezepts nebeneinander auf dem Fundamentraster
 *   (4-m- bzw. 8-m-Schritte). Eingänge hinten, Ausgänge vorn. Je
 *   Eingangsgegenstand eine Zuführung (Manifold oder Splitterbaum, Rohre mit
 *   Rohrkreuzungen), je Produkt eine Sammelleitung; beide beginnen bzw. enden
 *   am Linienrand zum Bus.
 * - **Hauptbus** neben den Linien: je Gegenstand eine gerade Spur (bei viel
 *   Durchsatz mehrere), Splitter bzw. Zusammenführungen sitzen direkt auf der
 *   Spur. Ein- und Ausgänge (Lager bzw. Flüssigkeitspuffer) stehen am Anfang
 *   bzw. Ende ihrer Spur.
 * - **Kreuzungen** (`crossings = 'avoid'`): Der Bus liegt eine Stufe höher,
 *   Abzweige laufen am Boden darunter durch; äußere Zuführungen und
 *   Sammelleitungen liegen je eine Stufe höher als die inneren. So kreuzen
 *   sich keine Leitungen auf gleicher Höhe (Lifte an den Übergängen).
 *
 * Varianten: `rows` (Linien auf einer Seite des Busses), `compact` (beidseitig),
 * `floors` (beidseitig, auf mehrere Etagen verteilt; Spuren über Etagen als Lift).
 *
 * Koordinaten des Entwurfs sind lokal (Ursprung oben links auf dem 8-m-Raster);
 * erst `applyLayout` setzt den Entwurf an eine Stelle der Fabrik.
 */
import type { GameDataIndex, GdBuilding } from '../gamedata/index.ts';
import { distToSegment, rotate, segmentIntersection, type Vec2 } from '../geometry/index.ts';
import { tr } from '../i18n/index.ts';
import { clone } from '../model/clone.ts';
import type { FloorKind, Project, TransportOrder } from '../model/schema.ts';
import { machineRates } from '../production/machine.ts';
import { itemStages } from '../production/graph.ts';
import type { SolveResult } from '../production/solver.ts';
import { addArea, addBuilding, addFloor, addLink, placeBuilding, updateBuildings, DEFAULT_FLOOR_HEIGHT_M, FLOOR_SLAB_M } from '../project/ops/factory.ts';
import { OpError } from '../project/errors.ts';
import { computeFactoryFlow, outputPortAssignment } from './flow.ts';
import { findOverlaps, placedShapes } from './checks.ts';
import { buildingHeight } from './geometry.ts';
import { linkPath, pathLength, PORT_STUB_M } from './linkPath.ts';
import { portDefs, type PortDef } from './ports.ts';

export type LayoutVariant = 'rows' | 'compact' | 'floors';

export interface AutoLayoutOptions {
  /** Verfügbare Grundfläche in Metern; `null` = unbegrenzt. */
  maxWidthM: number | null;
  maxDepthM: number | null;
  /** Höchstzahl Etagen (Variante „floors“ ab 2). */
  maxFloors: number;
  /** Höchste erlaubte Band- bzw. Rohrstufe (Gebäudetyp). */
  beltTier: string;
  pipeTier: string;
  /** Abstände: eng oder mit Laufwegen. */
  spacing: 'compact' | 'wide';
  /** Verteilung auf die Maschinen einer Linie (nur Bänder; Rohre immer Sammelleitung). */
  distribution: 'manifold' | 'balanced';
  /** Takt: alle gleich (`even`) oder volle Maschinen plus eine Restmaschine (`full`). */
  clocks: 'even' | 'full';
  /** Fundamentfläche unter dem Layout anlegen. */
  foundations: boolean;
  /**
   * Kreuzungen von Leitungen: `avoid` löst sie über Höhen (Bus erhöht,
   * Abzweige am Boden darunter, äußere Zuführungen höher, Lifte an den
   * Übergängen); `allow` legt alles flach auf Anschlusshöhe.
   */
  crossings: 'avoid' | 'allow';
  /**
   * Logistikebene unter jeder Produktionsebene: Bus, Zuführungen,
   * Sammelleitungen, Splitter sowie Ein- und Ausgänge liegen dort, Lifte führen
   * durch die Decke zu den Maschinen.
   */
  logistics: boolean;
  /**
   * Flüssigkeitspuffer in der Busspur von Zwischenprodukten (Flüssigkeiten,
   * die eine Linie herstellt und eine andere verbraucht), vor dem ersten
   * Verbraucher. Gleicht Schwankungen im Rohrnetz aus.
   */
  fluidBuffers: boolean;
}

/** Punkt eines Entwurfs: lokale Lage, Etage (Index) und Höhe über dem Etagenboden. */
export interface DraftPoint {
  x: number;
  y: number;
  floor: number;
  h: number;
}

export type DraftRole = 'machine' | 'splitter' | 'merger' | 'junction' | 'buffer' | 'entry' | 'exit';

export interface DraftBuilding {
  key: string;
  type: string;
  role: DraftRole;
  recipeId: string | null;
  clock: number;
  floor: number;
  x: number;
  y: number;
  rotationDeg: number;
  /** Höhe der Unterkante über dem Etagenboden (erhöhte Splitter auf dem Bus bzw. äußeren Zuführungen). */
  h: number;
  label: string;
  /** Ein- und Ausgänge: übergebener Gegenstand. */
  itemId?: string;
}

export interface DraftLink {
  kind: 'belt' | 'pipe';
  tier: string;
  itemId: string;
  /** Geplanter Durchsatz (Stück bzw. m³ pro Minute). */
  perMin: number;
  from: { key: string; portId: string };
  to: { key: string; portId: string };
  waypoints: DraftPoint[];
}

export interface DraftTerminal {
  key: string;
  itemId: string;
  perMin: number;
  dir: 'in' | 'out';
  portId: string;
}

export interface LayoutDraft {
  variant: LayoutVariant;
  buildings: DraftBuilding[];
  links: DraftLink[];
  /** Benötigte lichte Höhe je Etage (Index 0 = unterste). */
  floorHeights: number[];
  /** Art je Etage (Logistikebenen bei `logistics`). */
  floorKinds: FloorKind[];
  width: number;
  depth: number;
  /** Passt in die vorgegebene Fläche bzw. Etagenzahl. */
  fits: boolean;
  terminals: DraftTerminal[];
  counts: { machines: number; splitters: number; mergers: number; junctions: number; buffers: number; entries: number; exits: number; lines: number; lanes: number };
  /** Hinweise und Vereinfachungen dieses Entwurfs. */
  notes: string[];
}

export const LAYOUT_DEFAULTS: AutoLayoutOptions = {
  maxWidthM: null,
  maxDepthM: null,
  maxFloors: 1,
  beltTier: 'Build_ConveyorBeltMk3_C',
  pipeTier: 'Build_Pipeline_C',
  spacing: 'compact',
  distribution: 'manifold',
  clocks: 'even',
  foundations: true,
  crossings: 'avoid',
  logistics: false,
  fluidBuffers: true,
};

const SPLITTER = 'Build_ConveyorAttachmentSplitter_C';
const MERGER = 'Build_ConveyorAttachmentMerger_C';
const JUNCTION = 'Build_PipelineJunction_Cross_C';
const STORAGE = 'Build_StorageContainerMk1_C';
const FLUID_BUFFER = 'Build_PipeStorageTank_C';
const FOUNDATION = 'Build_Foundation_8x4_01_C';
/** Höhe der Leitungen über dem Etagenboden (Anschlusshöhe der meisten Gebäude). */
const LINE_H = 1;
/**
 * Feste Überkopf-Ebenen bei „Kreuzungen vermeiden“ (je ein 4-m-Fundament höher,
 * Planungsannahme): Zuführungen, Sammelleitungen und Abzweige auf OVER_H,
 * Abzweige nach rechts bei beidseitigen Linien auf OVER2_H.
 */
const OVER_H = LINE_H + 4;
const OVER2_H = OVER_H + 4;
/**
 * Logistikebene: lichte Höhe 6 m plus 2 m Decke (Standard beim Anlegen). Höhen
 * auf ihr werden im Generator negativ relativ zur Produktionsebene darüber
 * geführt (LOG(1) = 1 m über dem Logistikboden) und beim Eintragen in den
 * Entwurf auf die Logistiketage umgerechnet. Ebenen dort: 1, 3 und 5 m
 * (Planungsannahme, 2 m Abstand).
 */
const LOG_SPAN = DEFAULT_FLOOR_HEIGHT_M.logistics + FLOOR_SLAB_M;
const LOG = (h: number) => h - LOG_SPAN;

/** Etage und Höhe eines Generatorpunkts: negative Höhen liegen auf der Logistikebene darunter. */
function onFloor(floor: number, h: number): { floor: number; h: number } {
  return h < -0.5 ? { floor: floor - 1, h: h + LOG_SPAN } : { floor, h };
}
const EPS = 1e-6;

// ---------------------------------------------------------------------------
// Hilfen: Anschlüsse in Einbaulage
// ---------------------------------------------------------------------------

const near = (a: Vec2, b: Vec2) => Math.abs(a.x - b.x) < 1e-6 && Math.abs(a.y - b.y) < 1e-6;
const R4 = [0, 90, 180, 270];

/** Anschluss eines Gebäudes, der in Einbaulage nach `want` zeigt. */
function portFacing(def: GdBuilding, rot: number, kind: 'belt' | 'pipe', dirs: PortDef['direction'][], want: Vec2): PortDef | undefined {
  return portDefs(def).find((p) => p.kind === kind && dirs.includes(p.direction) && near(rot90(p.normal, rot), want));
}

/** Drehung, bei der der Anschluss `portId` nach `want` zeigt. */
function rotationFor(def: GdBuilding, portId: string, want: Vec2): number {
  const p = portDefs(def).find((x) => x.id === portId)!;
  return R4.find((r) => near(rot90(p.normal, r), want)) ?? 0;
}

/** Drehung in 90°-Schritten ohne Rundungsfehler. */
function rot90(v: Vec2, deg: number): Vec2 {
  const r = rotate(v, deg);
  return { x: Math.round(r.x * 1e6) / 1e6, y: Math.round(r.y * 1e6) / 1e6 };
}

function portWorld(def: GdBuilding, portId: string, b: { x: number; y: number; rotationDeg: number }): Vec2 {
  const p = portDefs(def).find((x) => x.id === portId)!;
  const r = rot90(p.local, b.rotationDeg);
  return { x: b.x + r.x, y: b.y + r.y };
}

/** Achsparallele Hülle eines Gebäudes in Einbaulage (90°-Schritte). */
function rotatedBounds(def: GdBuilding, rot: number): { minX: number; maxX: number; minY: number; maxY: number } {
  const b = def.bounds!;
  const cs = [
    rot90({ x: b.minX, y: b.minY }, rot),
    rot90({ x: b.maxX, y: b.maxY }, rot),
  ];
  return { minX: Math.min(cs[0]!.x, cs[1]!.x), maxX: Math.max(cs[0]!.x, cs[1]!.x), minY: Math.min(cs[0]!.y, cs[1]!.y), maxY: Math.max(cs[0]!.y, cs[1]!.y) };
}

/**
 * Drehung einer Maschine in der Linie: Eingänge zeigen nach oben (zu den
 * Zuführungen), sonst die Ausgänge nach unten (zu den Sammelleitungen).
 */
function machineRotation(def: GdBuilding): number {
  const ports = portDefs(def);
  const first = ports.find((p) => p.direction === 'in') ?? ports.find((p) => p.direction === 'out');
  if (!first) return 0;
  return rotationFor(def, first.id, first.direction === 'in' ? { x: 0, y: -1 } : { x: 0, y: 1 });
}

const isFluid = (gd: GameDataIndex, itemId: string) => (gd.item(itemId)?.form ?? 'solid') !== 'solid';

// ---------------------------------------------------------------------------
// Maschinen und Linien
// ---------------------------------------------------------------------------

interface MachineSpec {
  clock: number;
  inputs: Map<string, number>;
  outputs: Map<string, number>;
}

interface Segment {
  recipeId: string;
  type: string;
  def: GdBuilding;
  machines: MachineSpec[];
  /** Eingangsgegenstand → Anschluss; Produkt → Anschluss. */
  inPort: Map<string, string>;
  outPort: Map<string, string>;
  inItems: string[];
  outItems: string[];
  stage: number;
  /** Drehung der Maschinen (Eingänge oben). */
  rot: number;
}

interface Anchor {
  itemId: string;
  kind: 'belt' | 'pipe';
  perMin: number;
  ref: { key: string; portId: string };
  /** Höhe (y) der Leitung, auf der die Verbindung am Gang ankommt bzw. abgeht. */
  y: number;
  /** Punkte zwischen Gang und Anschluss (Ankunft) bzw. Anschluss und Gang (Abgang). */
  approach: DraftPoint[];
  /** Höhe der Leitung am Linienrand (über dem Etagenboden). */
  h: number;
  floor: number;
  /** Rand der Linie zum Gang (x) und Richtung der Linie (+1 nach rechts, −1 nach links). */
  edge: number;
  dir: 1 | -1;
}

interface RowResult {
  height: number;
  buildings: DraftBuilding[];
  links: DraftLink[];
  sinks: Anchor[];
  sources: Anchor[];
  length: number;
  machineHeight: number;
}

class Keys {
  private n = 0;
  next(prefix: string): string {
    return `${prefix}${++this.n}`;
  }
}

function machineSpecs(gd: GameDataIndex, recipeId: string, type: string, machines: number, ceil: number, clockEven: number, mode: 'even' | 'full'): MachineSpec[] {
  const clocks: number[] = [];
  if (mode === 'full') {
    const full = Math.floor(machines + 1e-6);
    for (let i = 0; i < full; i++) clocks.push(1);
    const rest = Math.round((machines - full) * 1e6) / 1e6;
    if (rest > 1e-4) clocks.push(Math.max(rest, gd.building(type)?.clock?.min ?? 0.01));
    if (clocks.length === 0) clocks.push(1);
  } else {
    for (let i = 0; i < ceil; i++) clocks.push(clockEven);
  }
  return clocks.map((clock) => {
    const r = machineRates(gd, { type, recipeId, clock, somersloops: 0 });
    return { clock, inputs: new Map(r.inputs.map((x) => [x.item, x.perMin])), outputs: new Map(r.outputs.map((x) => [x.item, x.perMin])) };
  });
}

/** Rezept → Linien (Teilstücke einer Rezeptreihe), begrenzt durch Stufe und Länge. */
function buildSegments(
  gd: GameDataIndex,
  result: SolveResult,
  opts: AutoLayoutOptions,
  caps: { belt: number; pipe: number },
  maxPerRow: (def: GdBuilding, rot: number) => number,
  notes: Set<string>,
): Segment[] {
  const stages = itemStages(gd, result);
  const out: Segment[] = [];
  for (const rr of result.recipes) {
    const def = gd.building(rr.building);
    const recipe = gd.recipe(rr.recipeId);
    if (!def || !recipe || !def.ports || !def.bounds) {
      notes.add(tr('{recipe}: Gebäude ohne Anschluss- oder Maßangaben, nicht im Layout.', { recipe: gd.name(rr.recipeId) }));
      continue;
    }
    if (rr.boost > 0) notes.add(tr('Somersloops werden im Layout nicht berücksichtigt.'));
    const specs = machineSpecs(gd, rr.recipeId, rr.building, rr.machines, rr.machinesCeil, rr.clockEven, opts.clocks);
    // Eingänge: Feststoffe auf Bandeingänge, Flüssigkeiten auf Rohreingänge (in Rezeptreihenfolge)
    const ports = portDefs(def);
    const beltIn = ports.filter((p) => p.kind === 'belt' && p.direction === 'in');
    const pipeIn = ports.filter((p) => p.kind === 'pipe' && p.direction === 'in');
    const inPort = new Map<string, string>();
    let bi = 0;
    let pi = 0;
    let ok = true;
    for (const a of recipe.inputs) {
      const p = isFluid(gd, a.item) ? pipeIn[pi++] : beltIn[bi++];
      if (!p) ok = false;
      else inPort.set(a.item, p.id);
    }
    const assign = outputPortAssignment(gd, def, recipe.outputs.map((o) => ({ itemId: o.item, perMin: 1 })));
    const outPort = new Map<string, string>();
    for (const [portId, r] of assign) outPort.set(r.itemId, portId);
    if (!ok || outPort.size < recipe.outputs.length) {
      notes.add(tr('{recipe}: zu wenige Anschlüsse für das Rezept, nicht im Layout.', { recipe: gd.name(rr.recipeId) }));
      continue;
    }
    const capOf = (item: string) => (isFluid(gd, item) ? caps.pipe : caps.belt);
    const stage = Math.max(0, ...recipe.outputs.map((o) => stages.get(o.item) ?? 0));
    const rot = machineRotation(def);
    if (ports.some((p) => p.direction === 'out' && near(rot90(p.normal, rot), { x: 0, y: -1 })))
      notes.add(tr('{building}: Ausgänge liegen auf der Seite der Eingänge; die Sammelleitung führt um die Maschine herum.', { building: gd.name(def.id) }));
    const limit = Math.max(1, maxPerRow(def, rot));
    let cur: MachineSpec[] = [];
    const sum = new Map<string, number>();
    const flush = () => {
      if (cur.length === 0) return;
      out.push({
        recipeId: rr.recipeId,
        type: rr.building,
        def,
        machines: cur,
        inPort,
        outPort,
        inItems: recipe.inputs.map((a) => a.item),
        outItems: recipe.outputs.map((a) => a.item),
        stage,
        rot,
      });
      cur = [];
      sum.clear();
    };
    for (const m of specs) {
      const fits = [...m.inputs, ...m.outputs].every(([item, v]) => (sum.get(item) ?? 0) + v <= capOf(item) + 1e-6);
      if (cur.length > 0 && (!fits || cur.length >= limit)) flush();
      for (const [item, v] of [...m.inputs, ...m.outputs]) {
        sum.set(item, (sum.get(item) ?? 0) + v);
        if (v > capOf(item) + 1e-6)
          notes.add(tr('{recipe}: Eine Maschine braucht mehr {item}, als eine Leitung der höchsten Stufe trägt.', { recipe: gd.name(rr.recipeId), item: gd.name(item) }));
      }
      cur.push(m);
    }
    flush();
  }
  return out.sort((a, b) => a.stage - b.stage || gd.name(a.recipeId).localeCompare(gd.name(b.recipeId)));
}

/** Teiler für einen Splitterbaum: 3 oder 2; `exact` = gleichmäßige Aufteilung. */
function treeSplit(m: number): { parts: number[]; exact: boolean } {
  const f = m % 3 === 0 ? 3 : m % 2 === 0 ? 2 : m === 3 ? 3 : 2;
  const parts: number[] = [];
  let rest = m;
  for (let i = f; i > 0; i--) {
    const s = Math.ceil(rest / i);
    parts.push(s);
    rest -= s;
  }
  return { parts, exact: parts.every((x) => x === parts[0]) };
}

/** Rastermaß der Maschinen in einer Linie: halbe bzw. ganze Fundamente (4 bzw. 8 m). */
function machinePitch(def: GdBuilding, spacing: AutoLayoutOptions['spacing'], rot = 0): number {
  const b = rotatedBounds(def, rot);
  const w = b.maxX - b.minX;
  return spacing === 'wide' ? Math.ceil((w + 4) / 8) * 8 : Math.ceil((w + 1) / 4) * 4;
}

/** Anschlusshöhe eines Gebäudes über seiner Unterkante (wie in `ports.ts`). */
const portZ = (def: GdBuilding) => portDefs(def)[0]?.z ?? 1;

/** Abstand zwischen Linie und erstem Maschinenumriss (Platz für die Lifte am Linienrand). */
const ROW_MARGIN = 4;
/**
 * Eine Linie im lokalen Linienrahmen: Rand zum Bus bei x = 0, die Linie
 * wächst in Richtung `dir`. Oben je Eingangsgegenstand eine Zuführung,
 * unten je Produkt eine Sammelleitung; beide beginnen bzw. enden am Rand.
 * Mit `avoid` und mehreren Zuführungen (bzw. Sammelleitungen) liegen diese
 * auf OVER_H; die Anschlüsse zu den Maschinen gehen direkt am Splitter bzw.
 * an der Zusammenführung per Lift auf Anschlusshöhe und unterqueren die
 * übrigen Leitungen.
 */
function buildRow(
  gd: GameDataIndex,
  seg: Segment,
  dir: 1 | -1,
  yTop: number,
  floor: number,
  opts: AutoLayoutOptions,
  keys: Keys,
  tierFor: (kind: 'belt' | 'pipe', perMin: number) => string,
  notes: Set<string>,
): RowResult {
  const avoid = opts.crossings === 'avoid';
  const buildings: DraftBuilding[] = [];
  const links: DraftLink[] = [];
  const sinks: Anchor[] = [];
  const sources: Anchor[] = [];
  const def = seg.def;
  const b = rotatedBounds(def, seg.rot);
  const pitch = machinePitch(def, opts.spacing, seg.rot);
  const n = seg.machines.length;
  const pt = (x: number, y: number, h = LINE_H): DraftPoint => ({ x, y, ...onFloor(floor, h) });
  const splitter = gd.building(SPLITTER)!;
  const merger = gd.building(MERGER)!;
  const junction = gd.building(JUNCTION)!;
  const add = (bd: Omit<DraftBuilding, 'floor' | 'label' | 'recipeId' | 'clock' | 'h'> & Partial<DraftBuilding>) => {
    const full: DraftBuilding = { floor, label: '', recipeId: null, clock: 1, h: 0, ...bd };
    Object.assign(full, onFloor(full.floor, full.h));
    buildings.push(full);
    return full;
  };
  const link = (kind: 'belt' | 'pipe', itemId: string, perMin: number, from: DraftBuilding, fromPort: string, to: DraftBuilding, toPort: string, waypoints: DraftPoint[] = []) =>
    links.push({ kind, tier: tierFor(kind, perMin), itemId, perMin, from: { key: from.key, portId: fromPort }, to: { key: to.key, portId: toPort }, waypoints });
  /** Senkrechter Abschnitt bei (x, y) von Höhe a nach b (nur wenn verschieden). */
  const lift = (x: number, y: number, a: number, c: number) => (Math.abs(a - c) < 1e-6 ? [] : [pt(x, y, a), pt(x, y, c)]);

  // --- Höhenlage: je Zuführung eine Leitung bei cursor + 3 (Raster 6 m), darunter
  // ggf. die Ebenen des Splitterbaums; dann Maschinen; dann Sammelleitungen ---
  let cursor = yTop;
  const feed = new Map<string, { y: number; h: number }>();
  const balanced = opts.distribution === 'balanced';
  const depthOf = (m: number): number => (m <= 1 ? 0 : 1 + Math.max(...treeSplit(m).parts.map(depthOf)));
  // Eine Zuführung bzw. Sammelleitung allein bleibt am Boden, mehrere liegen überkopf;
  // mit Logistikebene liegen alle darunter
  const feedH = opts.logistics ? (avoid ? LOG(3) : LOG(1)) : avoid && seg.inItems.length > 1 ? OVER_H : LINE_H;
  const collectH = opts.logistics ? (avoid ? LOG(3) : LOG(1)) : avoid && seg.outItems.length > 1 ? OVER_H : LINE_H;
  seg.inItems.forEach((item) => {
    const levels = balanced && n > 1 && !isFluid(gd, item) ? depthOf(n) : 0;
    feed.set(item, { y: cursor + 3, h: feedH });
    cursor += levels > 0 ? 6 * levels + 3 : 6;
  });
  // Maschinenoberkante auf dem 4-m-Raster
  const top = Math.ceil((cursor + 1.5) / 4) * 4;
  const originY = top - b.minY;
  const inY = originY + b.minY;
  const outY = originY + b.maxY;
  cursor = outY + 1.5;
  const collect = new Map<string, { y: number; h: number }>();
  seg.outItems.forEach((item) => {
    collect.set(item, { y: cursor + 3, h: collectH });
    cursor += 6;
  });

  // --- Maschinen: jede mittig in ihrem Rasterfeld (Feldbreite 4 bzw. 8 m) ---
  const machines = seg.machines.map((m, i) => {
    const cell = ROW_MARGIN + i * pitch + pitch / 2;
    const x = dir * cell - (b.minX + b.maxX) / 2;
    return add({ key: keys.next('m'), type: seg.type, role: 'machine', recipeId: seg.recipeId, clock: m.clock, x, y: originY, rotationDeg: seg.rot });
  });
  const length = ROW_MARGIN + n * pitch;

  // --- Zuführungen ---
  for (const item of seg.inItems) {
    const kind = isFluid(gd, item) ? 'pipe' : 'belt';
    const portId = seg.inPort.get(item)!;
    const px = machines.map((m) => portWorld(def, portId, m).x);
    const rates = seg.machines.map((m) => m.inputs.get(item) ?? 0);
    const total = rates.reduce((s, v) => s + v, 0);
    const { y, h } = feed.get(item)!;
    /** Direkt hinter dem Splitter (bzw. der Ecke bei `at`) auf Anschlusshöhe absenken. */
    // Lift endet auf Anschlusshöhe der Maschine (Bänder 1 m, Rohre z. B. 1,75 m)
    const portH = avoid || opts.logistics ? (portDefs(def).find((q) => q.id === portId)?.z ?? LINE_H) : LINE_H;
    const drop = (x: number, at = y + 3) => lift(x, at, h, portH);
    const anchor = (ref: { key: string; portId: string }, approach: DraftPoint[]) =>
      sinks.push({ itemId: item, kind, perMin: total, ref, y, approach, h, floor, edge: 0, dir });
    if (n === 1) {
      anchor({ key: machines[0]!.key, portId }, [pt(px[0]!, y, h), ...drop(px[0]!)]);
      continue;
    }
    if (kind === 'pipe' || !balanced) {
      // Sammelleitung (Manifold): Splitter bzw. Rohrkreuzung über jedem Eingang außer dem letzten
      const node = kind === 'pipe' ? junction : splitter;
      const rot = kind === 'pipe' ? 0 : rotationFor(splitter, 'belt-in-0', { x: -dir, y: 0 });
      const dirs: PortDef['direction'][] = kind === 'pipe' ? ['any'] : ['out'];
      const inP = kind === 'pipe' ? portFacing(junction, 0, 'pipe', ['any'], { x: -dir, y: 0 })!.id : 'belt-in-0';
      const downP = portFacing(node, rot, kind, dirs, { x: 0, y: 1 })!.id;
      const fwdP = portFacing(node, rot, kind, dirs, { x: dir, y: 0 })!.id;
      const ns = px.slice(0, -1).map((x) =>
        add({ key: keys.next(kind === 'pipe' ? 'j' : 's'), type: kind === 'pipe' ? JUNCTION : SPLITTER, role: kind === 'pipe' ? 'junction' : 'splitter', x, y, rotationDeg: rot, h: h - portZ(node) }),
      );
      let rest = total;
      ns.forEach((s, i) => {
        link(kind, item, rates[i]!, s, downP, machines[i]!, portId, drop(px[i]!));
        rest -= rates[i]!;
        if (i < ns.length - 1) link(kind, item, rest, s, fwdP, ns[i + 1]!, inP);
        else link(kind, item, rest, s, fwdP, machines[n - 1]!, portId, [pt(px[n - 1]!, y, h), ...drop(px[n - 1]!)]);
      });
      anchor({ key: ns[0]!.key, portId: inP }, []);
      continue;
    }
    // Splitterbaum (Load Balancer): Zufluss von oben, Ebenen zu den Maschinen hin
    const levelY = (l: number) => y + 3 + 6 * l;
    const treeRot = rotationFor(splitter, 'belt-in-0', { x: 0, y: -1 });
    type Node = { leaf: true; i: number; x: number } | { leaf: false; key: string; x: number };
    const build = (group: number[], level: number): Node => {
      if (group.length === 1) return { leaf: true, i: group[0]!, x: px[group[0]!]! };
      const { parts, exact } = treeSplit(group.length);
      if (!exact) notes.add(tr('Splitterbaum: {n} Maschinen lassen sich nicht exakt gleichmäßig aufteilen (nur Teiler 2 und 3); der Rückstau gleicht im Betrieb aus.', { n: group.length }));
      const groups: number[][] = [];
      let k = 0;
      for (const s of parts) {
        groups.push(group.slice(k, k + s));
        k += s;
      }
      const children = groups.map((g) => build(g, level + 1));
      const straight = children[parts.length === 3 ? 1 : 0]!;
      const node = add({ key: keys.next('s'), type: SPLITTER, role: 'splitter', x: straight.x, y: levelY(level), rotationDeg: treeRot, h: h - portZ(splitter) });
      children.forEach((c, ci) => {
        const want = Math.abs(c.x - node.x) < 1e-6 ? { x: 0, y: 1 } : { x: Math.sign(c.x - node.x), y: 0 };
        const out = portFacing(splitter, treeRot, 'belt', ['out'], want)!.id;
        const rate = groups[ci]!.reduce((s, i) => s + rates[i]!, 0);
        const via = want.y === 1 ? [] : [pt(c.x, levelY(level), h)];
        if (c.leaf) link('belt', item, rate, node, out, machines[c.i]!, portId, [...via, ...drop(c.x, via.length ? levelY(level) : levelY(level) + 3)]);
        else link('belt', item, rate, node, out, buildings.find((x) => x.key === c.key)!, 'belt-in-0', via);
      });
      return { leaf: false, key: node.key, x: node.x };
    };
    const root = build(machines.map((_, i) => i), 0) as { key: string; x: number };
    anchor({ key: root.key, portId: 'belt-in-0' }, [pt(root.x, y, h)]);
  }

  // --- Sammelleitungen (zum Rand hin) ---
  for (const item of seg.outItems) {
    const kind = isFluid(gd, item) ? 'pipe' : 'belt';
    const portId = seg.outPort.get(item)!;
    const qx = machines.map((m) => portWorld(def, portId, m).x);
    const rates = seg.machines.map((m) => m.outputs.get(item) ?? 0);
    const total = rates.reduce((s, v) => s + v, 0);
    const { y, h } = collect.get(item)!;
    /** Direkt vor der Zusammenführung auf die Höhe der Sammelleitung steigen. */
    const portH = avoid || opts.logistics ? (portDefs(def).find((q) => q.id === portId)?.z ?? LINE_H) : LINE_H;
    const rise = (x: number) => lift(x, y - 3, portH, h);
    const anchor = (ref: { key: string; portId: string }, depart: DraftPoint[]) =>
      sources.push({ itemId: item, kind, perMin: total, ref, y, approach: depart, h, floor, edge: 0, dir });
    if (n === 1) {
      anchor({ key: machines[0]!.key, portId }, [...rise(qx[0]!), pt(qx[0]!, y, h)]);
      continue;
    }
    const node = kind === 'pipe' ? junction : merger;
    const rot = kind === 'pipe' ? 0 : rotationFor(merger, 'belt-out-0', { x: -dir, y: 0 });
    const dirs: PortDef['direction'][] = kind === 'pipe' ? ['any'] : ['in'];
    const upP = portFacing(node, rot, kind, dirs, { x: 0, y: -1 })!.id;
    const backP = portFacing(node, rot, kind, dirs, { x: dir, y: 0 })!.id;
    const outP = kind === 'pipe' ? portFacing(junction, 0, 'pipe', ['any'], { x: -dir, y: 0 })!.id : 'belt-out-0';
    const gs = qx.slice(0, -1).map((x) =>
      add({ key: keys.next(kind === 'pipe' ? 'j' : 'g'), type: kind === 'pipe' ? JUNCTION : MERGER, role: kind === 'pipe' ? 'junction' : 'merger', x, y, rotationDeg: rot, h: h - portZ(node) }),
    );
    let acc = rates[n - 1]!;
    link(kind, item, acc, machines[n - 1]!, portId, gs[n - 2]!, backP, [...rise(qx[n - 1]!), pt(qx[n - 1]!, y, h)]);
    for (let i = n - 2; i >= 0; i--) {
      link(kind, item, rates[i]!, machines[i]!, portId, gs[i]!, upP, rise(qx[i]!));
      acc += rates[i]!;
      if (i > 0) link(kind, item, acc, gs[i]!, outP, gs[i - 1]!, backP);
    }
    anchor({ key: gs[0]!.key, portId: outP }, []);
  }
  return { height: cursor - yTop, buildings, links, sinks, sources, length, machineHeight: buildingHeight(def) };
}

// ---------------------------------------------------------------------------
// Zuordnung Quellen → Senken je Gegenstand
// ---------------------------------------------------------------------------

type End = { kind: 'anchor'; anchor: Anchor } | { kind: 'terminal'; itemId: string };
interface Pair {
  itemId: string;
  perMin: number;
  src: End;
  dst: End;
}

function matchPairs(gd: GameDataIndex, result: SolveResult, sinksAll: Anchor[], sourcesAll: Anchor[], cap: (item: string) => number, notes: Set<string>): Pair[] {
  const items = new Set([...sinksAll.map((a) => a.itemId), ...sourcesAll.map((a) => a.itemId)]);
  for (const it of result.items) if (it.supplied > EPS) items.add(it.itemId);
  const pairs: Pair[] = [];
  const order = (a: Anchor) => a.floor * 1e6 + a.y;
  for (const item of items) {
    const supplied = result.items.find((x) => x.itemId === item)?.supplied ?? 0;
    const srcs: { end: End; rem: number }[] = [];
    if (supplied > EPS) srcs.push({ end: { kind: 'terminal', itemId: item }, rem: supplied });
    for (const a of sourcesAll.filter((x) => x.itemId === item).sort((p, q) => order(p) - order(q))) srcs.push({ end: { kind: 'anchor', anchor: a }, rem: a.perMin });
    const dsts: { end: End; rem: number }[] = sinksAll
      .filter((x) => x.itemId === item)
      .sort((p, q) => order(p) - order(q))
      .map((a) => ({ end: { kind: 'anchor', anchor: a } as End, rem: a.perMin }));
    const totalIn = srcs.reduce((s, x) => s + x.rem, 0);
    const totalOut = dsts.reduce((s, x) => s + x.rem, 0);
    // Takte sind auf 6 Stellen gerundet: kleine Abweichungen sind keine Lücke
    const tol = 1e-4 * Math.max(1, totalIn);
    if (totalIn > totalOut + tol) dsts.push({ end: { kind: 'terminal', itemId: item }, rem: totalIn - totalOut });
    else if (totalOut > totalIn + tol) notes.add(tr('{item}: Bedarf größer als Herstellung und Zulieferung, Linien sind nicht voll versorgt.', { item: gd.name(item) }));
    let i = 0;
    let j = 0;
    while (i < srcs.length && j < dsts.length) {
      const s = srcs[i]!;
      const d = dsts[j]!;
      const amount = Math.min(s.rem, d.rem);
      if (amount > tol) {
        // Ein- direkt zu Ausgang: in Leitungen der höchsten Stufe zerlegen
        const chunk = s.end.kind === 'terminal' && d.end.kind === 'terminal' ? cap(item) : amount;
        for (let left = amount; left > tol; left -= chunk) pairs.push({ itemId: item, perMin: Math.min(chunk, left), src: s.end, dst: d.end });
      }
      s.rem -= amount;
      d.rem -= amount;
      if (s.rem <= tol) i++;
      if (d.rem <= tol) j++;
    }
  }
  return pairs;
}

// ---------------------------------------------------------------------------
// Varianten
// ---------------------------------------------------------------------------

interface Arranged {
  seg: Segment;
  floor: number;
  dir: 1 | -1;
  y: number;
  row: RowResult;
}

/**
 * Erzeugt die Layoutvarianten für ein Planergebnis. Varianten, die die
 * Vorgaben nicht erfüllen, sind mit `fits = false` markiert.
 */
export function generateLayouts(gd: GameDataIndex, result: SolveResult, options: Partial<AutoLayoutOptions> = {}): LayoutDraft[] {
  const opts: AutoLayoutOptions = { ...LAYOUT_DEFAULTS, ...options };
  if (result.status !== 'optimal' || result.recipes.length === 0) return [];
  const variants: LayoutVariant[] = ['rows', 'compact'];
  if (opts.maxFloors >= 2) variants.push('floors');
  const out: LayoutDraft[] = [];
  for (const v of variants) {
    const d = generateVariant(gd, result, opts, v);
    if (d) out.push(d);
  }
  return out;
}

function generateVariant(gd: GameDataIndex, result: SolveResult, opts: AutoLayoutOptions, variant: LayoutVariant): LayoutDraft | null {
  let corridor = 24;
  let draft: LayoutDraft | null = null;
  // Busbreite hängt von den Linien ab und umgekehrt: wenige Durchläufe genügen
  for (let pass = 0; pass < 4; pass++) {
    const r = buildVariant(gd, result, opts, variant, corridor);
    if (!r) return null;
    draft = r.draft;
    if (opts.maxWidthM === null) break;
    // Zu breit (Bus breiter als angenommen, Rundung aufs Raster): Linien kürzen und neu rechnen
    const over = r.draft.width - opts.maxWidthM;
    if (r.corridor <= corridor + 1e-6 && over <= 1e-6) break;
    corridor = Math.max(r.corridor, corridor + Math.max(0, over));
  }
  return draft;
}

/** Ende einer Busspur-Zuordnung: Linienanschluss oder Ein-/Ausgang am Spurende. */
type LaneEnd = { kind: 'anchor'; anchor: Anchor } | { kind: 'entry' } | { kind: 'exit' };

interface Lane {
  itemId: string;
  kind: 'belt' | 'pipe';
  floor: number;
  /** Nur ein Paar: über Etagen hinweg oder gegen die Flussrichtung (Kreislauf). */
  exclusive: boolean;
  pairs: Pair[];
  x: number;
  /**
   * Verbindung zwischen Etagen bzw. Rückführung gegen die Flussrichtung mit
   * beiden Anschlüssen auf derselben Seite: keine Busspur, sondern eine Spalte
   * am Linienrand (zwischen Verteilketten und Bus).
   */
  edge?: 1 | -1;
}

const ENTRY_Y = -1e6;
const EXIT_Y = 1e6;
/**
 * Mindestabstand zweier Anschlüsse auf einer Spur: Knoten 4 m + Luft, dazu
 * bis zu 2 × 3 m Versatz der Abzweige einer Verteilkette – so bleibt die
 * Reihenfolge auf der Spur erhalten und Knoten überschneiden sich nicht.
 */
const NODE_GAP = 11;

/**
 * Senkt hochgelegte Leitungsstücke (Lift hoch – waagrecht – Lift runter auf
 * dieselbe Höhe) auf die Höhe davor ab, wenn dort weder eine andere Leitung
 * (auch kein Lift) noch ein Gebäude im Weg ist. So liegen Leitungen nur dort
 * in der Luft, wo sie über etwas hinwegführen; Kreuzungen auf gleicher Höhe
 * entstehen dabei nicht.
 */
function lowerFreeRuns(gd: GameDataIndex, buildings: DraftBuilding[], links: DraftLink[]): void {
  const byKey = new Map(buildings.map((b) => [b.key, b]));
  const endPoint = (ref: { key: string; portId: string }): DraftPoint => {
    const b = byKey.get(ref.key)!;
    const def = gd.building(b.type)!;
    const w = portWorld(def, ref.portId, b);
    return { x: w.x, y: w.y, h: b.h + (portDefs(def).find((q) => q.id === ref.portId)?.z ?? 0), floor: b.floor };
  };
  const ends = links.map((l) => [endPoint(l.from), endPoint(l.to)] as const);
  const poly = (i: number) => [ends[i]![0], ...links[i]!.waypoints, ends[i]![1]];
  const sameXY = (a: DraftPoint, b: DraftPoint) => Math.abs(a.x - b.x) < 1e-6 && Math.abs(a.y - b.y) < 1e-6;
  const boxes = buildings.map((b) => {
    const def = gd.building(b.type)!;
    const r = rotatedBounds(def, b.rotationDeg);
    return { key: b.key, floor: b.floor, minX: b.x + r.minX, maxX: b.x + r.maxX, minY: b.y + r.minY, maxY: b.y + r.maxY, z0: b.h + def.bounds!.minZ, z1: b.h + def.bounds!.maxZ };
  });

  /** Ist das waagrechte Stück a → b auf Höhe h (Etage f) frei? */
  const free = (self: number, a: DraftPoint, b: DraftPoint, h: number, f: number) => {
    const len = Math.hypot(b.x - a.x, b.y - a.y);
    for (let i = 0; i < links.length; i++) {
      if (i === self) continue;
      const pts = poly(i);
      for (let k = 1; k < pts.length; k++) {
        const p = pts[k - 1]!;
        const q = pts[k]!;
        if (p.floor !== f && q.floor !== f) continue;
        if (sameXY(p, q)) {
          // Lift: steht er im Weg (Höhenbereich enthält h)?
          if (p.floor === f && q.floor === f && Math.min(p.h, q.h) - 0.3 > h) continue;
          if (p.floor === f && q.floor === f && Math.max(p.h, q.h) + 0.3 < h) continue;
          if (distToSegment(p, a, b) < 1.2) return false;
          continue;
        }
        if (p.floor !== f || q.floor !== f) continue;
        const x = segmentIntersection(a, b, p, q);
        if (x) {
          if (Math.abs(p.h + (q.h - p.h) * x.tb - h) < 0.6) return false;
          continue;
        }
        // Parallel daneben bzw. darüber auf gleicher Höhe (Bandbreite)
        if (len > 1e-6 && Math.abs((p.h + q.h) / 2 - h) < 0.6) {
          const u = { x: (b.x - a.x) / len, y: (b.y - a.y) / len };
          const off = (r: DraftPoint) => Math.abs((r.x - a.x) * u.y - (r.y - a.y) * u.x);
          const t = (r: DraftPoint) => (r.x - a.x) * u.x + (r.y - a.y) * u.y;
          const lo = Math.max(0, Math.min(t(p), t(q)));
          const hi = Math.min(len, Math.max(t(p), t(q)));
          if (off(p) < 1.2 && off(q) < 1.2 && hi - lo > 0.3) return false;
        }
      }
    }
    const own = new Set([links[self]!.from.key, links[self]!.to.key]);
    const steps = Math.max(1, Math.ceil(len / 0.5));
    for (const bx of boxes) {
      if (bx.floor !== f || own.has(bx.key) || h < bx.z0 - 0.1 || h > bx.z1) continue;
      for (let k = 0; k <= steps; k++) {
        const x = a.x + ((b.x - a.x) * k) / steps;
        const y = a.y + ((b.y - a.y) * k) / steps;
        if (x > bx.minX - 0.5 && x < bx.maxX + 0.5 && y > bx.minY - 0.5 && y < bx.maxY + 0.5) return false;
      }
    }
    return true;
  };

  for (let pass = 0, changed = true; changed && pass < 8; pass++) {
    changed = false;
    links.forEach((l, li) => {
      const w = l.waypoints;
      for (let i = 1; i < w.length - 1; i++) {
        const up = w[i]!;
        const low = w[i - 1]!;
        if (!sameXY(low, up) || low.floor !== up.floor || up.h < low.h + 0.5) continue;
        let j = i;
        while (j + 1 < w.length && w[j + 1]!.floor === up.floor && Math.abs(w[j + 1]!.h - up.h) < 1e-6) j++;
        const after = w[j + 1];
        if (j === i || !after || !sameXY(w[j]!, after) || after.floor !== up.floor || Math.abs(after.h - low.h) > 1e-6) continue;
        let ok = true;
        for (let k = i; k < j && ok; k++) ok = free(li, w[k]!, w[k + 1]!, low.h, up.floor);
        if (!ok) continue;
        // Absenken: Lift oben und unten entfällt
        const lowered = w.slice(i, j + 1).map((q) => ({ ...q, h: low.h }));
        l.waypoints = [...w.slice(0, i), ...lowered.slice(1, -1), ...w.slice(j + 1)];
        changed = true;
        return;
      }
    });
  }
}

function buildVariant(
  gd: GameDataIndex,
  result: SolveResult,
  opts: AutoLayoutOptions,
  variant: LayoutVariant,
  corridorGuess: number,
): { draft: LayoutDraft; corridor: number } | null {
  const notes = new Set<string>();
  const avoid = opts.crossings === 'avoid';
  const beltIdx = Math.max(0, gd.beltTiers.findIndex((t) => t.id === opts.beltTier));
  const pipeIdx = Math.max(0, gd.pipeTiers.findIndex((t) => t.id === opts.pipeTier));
  const belts = gd.beltTiers.slice(0, beltIdx + 1);
  const pipes = gd.pipeTiers.slice(0, pipeIdx + 1);
  if (belts.length === 0 || pipes.length === 0) return null;
  const caps = { belt: belts.at(-1)!.conveyor!.itemsPerMin, pipe: pipes.at(-1)!.pipe!.m3PerMin };
  const capOf = (item: string) => (isFluid(gd, item) ? caps.pipe : caps.belt);
  const tierFor = (kind: 'belt' | 'pipe', perMin: number) => {
    const list = kind === 'belt' ? belts.map((t) => ({ id: t.id, cap: t.conveyor!.itemsPerMin })) : pipes.map((t) => ({ id: t.id, cap: t.pipe!.m3PerMin }));
    return (list.find((t) => t.cap >= perMin - 1e-6) ?? list.at(-1)!).id;
  };
  const sides: (1 | -1)[] = variant === 'rows' ? [1] : [1, -1];
  const maxPerRow = (def: GdBuilding, rot: number) => {
    if (opts.maxWidthM === null) return 12;
    const avail = (opts.maxWidthM - corridorGuess) / sides.length - ROW_MARGIN;
    return Math.max(1, Math.floor(avail / machinePitch(def, opts.spacing, rot)));
  };
  const segments = buildSegments(gd, result, opts, caps, maxPerRow, notes);
  if (segments.length === 0) return null;
  const keys = new Keys();
  // Laufweg zwischen den Linien: eine Fundamentreihe (breit) bzw. ein halbes Fundament
  const rowGap = opts.spacing === 'wide' ? 8 : 4;
  const termDepth = (item: string) => (isFluid(gd, item) ? 6 : 11);
  /** Der Bus liegt am Boden, bei „Kreuzungen vermeiden“ überqueren ihn die Abzweige überkopf. */
  // Bei Linien auf beiden Seiten liegen die Abzweige nach rechts eine Ebene höher als die nach links,
  // damit sie sich zwischen den Spuren nicht überdecken.
  const twoSided = sides.length === 2;
  const tapH = (dir: 1 | -1) =>
    opts.logistics ? (!avoid ? LOG(1) : twoSided && dir === 1 ? LOG(5) : LOG(3)) : !avoid ? LINE_H : twoSided && dir === 1 ? OVER2_H : OVER_H;
  const busH = opts.logistics ? LOG(1) : LINE_H;
  /** Etagenindex der Produktionsebene (mit Logistikebenen liegt unter jeder eine Logistiketage). */
  const prodIdx = (f: number) => (opts.logistics ? 2 * f + 1 : f);

  // --- Linien bauen (Höhe unabhängig von der Lage), dann auf Etagen und Seiten verteilen ---
  const probe = segments.map((seg) => buildRow(gd, seg, 1, 0, 0, opts, new Keys(), tierFor, new Set()).height);
  const total = probe.reduce((s, h) => s + h + rowGap, 0);
  let floors = 1;
  if (variant === 'floors') {
    const perSide = (f: number) => total / (f * sides.length);
    const zones = 40;
    if (opts.maxDepthM !== null) {
      floors = opts.maxFloors;
      for (let f = 2; f <= opts.maxFloors; f++)
        if (perSide(f) + zones <= opts.maxDepthM) {
          floors = f;
          break;
        }
    } else floors = Math.min(opts.maxFloors, Math.max(2, Math.ceil(segments.length / 4)));
    if (floors < 2 || segments.length < 2) return null;
    floors = Math.min(floors, segments.length);
  }
  const floorOf: number[] = [];
  {
    let acc = 0;
    segments.forEach((_, i) => {
      floorOf.push(Math.min(floors - 1, Math.floor((acc / total) * floors + 1e-9)));
      acc += probe[i]! + rowGap;
    });
  }
  const arranged: Arranged[] = [];
  const cursors = new Map<string, number>();
  /** Lage der Anschlüsse am Gang je Etage und Seite (inkl. Versatz einer Verteilkette). */
  const anchorYs = new Map<string, number[]>();
  const spread = (ys: number[]) => ys.flatMap((v) => [v - 3, v, v + 3]);
  segments.forEach((seg, i) => {
    const floor = prodIdx(floorOf[i]!);
    const side = sides.reduce((best, s) => ((cursors.get(`${floor}:${s}`) ?? 0) < (cursors.get(`${floor}:${best}`) ?? 0) ? s : best), sides[0]!);
    const k = `${floor}:${side}`;
    const base = Math.ceil((cursors.get(k) ?? 0) / 4) * 4;
    // Linien auf beiden Seiten: um ganze 4-m-Schritte versetzen, bis die Anschlüsse nicht auf
    // denselben Linien liegen wie die der Gegenseite – sonst laufen Abzweige nach links und rechts
    // im Grundriss übereinander (verschiedene Höhen)
    const other = sides.length === 2 ? anchorYs.get(`${floor}:${-side}`) ?? [] : [];
    const clash = (y: number) => {
      const r = buildRow(gd, seg, side, y, floor, opts, new Keys(), tierFor, new Set());
      const mine = [...r.sinks, ...r.sources].map((a) => a.y);
      let n = 0;
      for (const v of mine) for (const o of other) if (Math.abs(v - o) < 2) n += 3;
      for (const v of spread(mine)) for (const o of spread(other)) if (Math.abs(v - o) < 2) n++;
      return n;
    };
    let y = base;
    if (other.length) {
      let best = Infinity;
      for (const dy of [0, 4, 8, 12]) {
        const c = clash(base + dy);
        if (c < best) {
          best = c;
          y = base + dy;
        }
        if (c === 0) break;
      }
    }
    const row = buildRow(gd, seg, side, y, floor, opts, keys, tierFor, notes);
    anchorYs.set(k, [...(anchorYs.get(k) ?? []), ...[...row.sinks, ...row.sources].map((a) => a.y)]);
    cursors.set(k, y + row.height + rowGap);
    arranged.push({ seg, floor, dir: side, y, row });
  });
  const sinks = arranged.flatMap((a) => a.row.sinks);
  const sources = arranged.flatMap((a) => a.row.sources);
  const pairs = matchPairs(gd, result, sinks, sources, capOf, notes);

  // --- Paare auf Busspuren verteilen ---
  const endOf = (p: Pair, side: 'src' | 'dst'): LaneEnd => {
    const e = side === 'src' ? p.src : p.dst;
    return e.kind === 'anchor' ? e : { kind: side === 'src' ? 'entry' : 'exit' };
  };
  const yOfEnd = (e: LaneEnd) => (e.kind === 'anchor' ? e.anchor.y : e.kind === 'entry' ? ENTRY_Y : EXIT_Y);
  // Ein- und Ausgänge liegen auf der Etage ihres Partners
  const floorOfPair = (p: Pair) => ({
    from: p.src.kind === 'anchor' ? p.src.anchor.floor : p.dst.kind === 'anchor' ? p.dst.anchor.floor : prodIdx(0),
    to: p.dst.kind === 'anchor' ? p.dst.anchor.floor : p.src.kind === 'anchor' ? p.src.anchor.floor : prodIdx(0),
  });
  const lanes: Lane[] = [];
  const keyOf = (e: LaneEnd) => (e.kind === 'anchor' ? e.anchor : e.kind);
  const fits = (lane: Lane, p: Pair) => {
    const ys = yOfEnd(endOf(p, 'src'));
    const yd = yOfEnd(endOf(p, 'dst'));
    // Last auf der Spur im Intervall des neuen Paars
    const points = [ys, ...lane.pairs.flatMap((q) => [yOfEnd(endOf(q, 'src')), yOfEnd(endOf(q, 'dst'))])].filter((y) => y >= ys && y < yd);
    for (const y of points) {
      const load = lane.pairs.filter((q) => yOfEnd(endOf(q, 'src')) <= y && y < yOfEnd(endOf(q, 'dst'))).reduce((s, q) => s + q.perMin, 0);
      if (load + p.perMin > capOf(p.itemId) + 1e-6) return false;
    }
    // Neue Knoten nicht zu dicht an vorhandenen (andere Anschlüsse auf derselben Spur)
    const existing = new Map<unknown, number>();
    for (const q of lane.pairs) for (const s of ['src', 'dst'] as const) existing.set(keyOf(endOf(q, s)), yOfEnd(endOf(q, s)));
    for (const s of ['src', 'dst'] as const) {
      const e = endOf(p, s);
      if (existing.has(keyOf(e))) continue;
      const y = yOfEnd(e);
      for (const [k, y2] of existing) if (k !== keyOf(e) && Math.abs(y - y2) < NODE_GAP) return false;
    }
    return true;
  };
  const sortedPairs = [...pairs].sort((a, b) => floorOfPair(a).from - floorOfPair(b).from || Math.min(yOfEnd(endOf(a, 'src')), yOfEnd(endOf(a, 'dst'))) - Math.min(yOfEnd(endOf(b, 'src')), yOfEnd(endOf(b, 'dst'))));
  for (const p of sortedPairs) {
    const fl = floorOfPair(p);
    const down = yOfEnd(endOf(p, 'src')) < yOfEnd(endOf(p, 'dst'));
    const kind: 'belt' | 'pipe' = isFluid(gd, p.itemId) ? 'pipe' : 'belt';
    if (fl.from !== fl.to || !down) {
      // Beide Anschlüsse auf derselben Seite: Lift bzw. Rückführung am Linienrand statt einer Busspur
      const edge = p.src.kind === 'anchor' && p.dst.kind === 'anchor' && p.src.anchor.dir === p.dst.anchor.dir ? p.src.anchor.dir : undefined;
      lanes.push({ itemId: p.itemId, kind, floor: fl.to, exclusive: true, pairs: [p], x: 0, edge });
      continue;
    }
    // Bevorzugt Spuren, die einen der beiden Anschlüsse schon tragen (keine Verteilkette nötig)
    const candidates = lanes.filter((l) => !l.exclusive && l.itemId === p.itemId && l.floor === fl.from);
    const shares = (l: Lane) => l.pairs.some((q) => keyOf(endOf(q, 'src')) === keyOf(endOf(p, 'src')) || keyOf(endOf(q, 'dst')) === keyOf(endOf(p, 'dst')));
    const lane = [...candidates.filter(shares), ...candidates.filter((l) => !shares(l))].find((l) => fits(l, p));
    if (lane) lane.pairs.push(p);
    else lanes.push({ itemId: p.itemId, kind, floor: fl.from, exclusive: false, pairs: [p], x: 0 });
  }

  // --- Verteilketten am Linienrand für Anschlüsse auf mehreren Spuren ---
  const lanesAt = new Map<Anchor, Lane[]>();
  for (const l of lanes)
    for (const q of l.pairs)
      for (const e of [q.src, q.dst])
        if (e.kind === 'anchor') {
          const list = lanesAt.get(e.anchor) ?? [];
          if (!list.includes(l)) list.push(l);
          lanesAt.set(e.anchor, list);
        }
  /** Knoten der Verteilkette je Anschluss (bei Konflikten der Seitenabgänge ggf. einer mehr, siehe unten). */
  const chainExtra = new Map<Anchor, number>();
  const chainLen = (a: Anchor) => {
    const c = lanesAt.get(a)?.length ?? 0;
    return c <= 1 ? 0 : Math.ceil((c - 1) / 2) + (chainExtra.get(a) ?? 0);
  };
  const stepOf = (a: Anchor) => (a.kind === 'pipe' ? 4 : 6);
  const sideOff = (a: Anchor) => (a.kind === 'pipe' ? 1.2 : 2) + PORT_STUB_M;
  type SlotSide = 'up' | 'down' | 'end';
  interface Slot {
    node: number;
    side: SlotSide;
    dy: number;
  }
  const slotOf = new Map<string, Slot>();
  const anchorIds = new Map<Anchor, number>();
  const idOf = (a: Anchor) => anchorIds.get(a) ?? (anchorIds.set(a, anchorIds.size), anchorIds.size - 1);
  const slotKey = (a: Anchor, l: Lane) => `${idOf(a)}|${lanes.indexOf(l)}`;
  // Abgänge benachbarter Anschlüsse (gleiche Etage und Seite) dürfen nicht auf derselben Linie liegen
  const usedYs = new Map<string, number[]>();
  for (const a of [...sinks, ...sources]) usedYs.set(`${a.floor}:${a.dir}`, [...(usedYs.get(`${a.floor}:${a.dir}`) ?? []), a.y]);
  for (const [a, ls] of lanesAt) {
    if (chainLen(a) === 0) continue;
    const others = usedYs.get(`${a.floor}:${a.dir}`)!;
    const clash = (sl: Slot) => sl.dy !== 0 && others.some((y) => Math.abs(y - (a.y + sl.dy)) < 1.5);
    let ordered: Slot[] = [];
    for (let extra = 0; extra <= 2; extra++) {
      chainExtra.set(a, extra);
      const h = chainLen(a);
      const free: Slot[] = [];
      for (let j = 0; j < h; j++) {
        free.push({ node: j, side: 'up', dy: -sideOff(a) }, { node: j, side: 'down', dy: sideOff(a) });
        if (j === h - 1) free.push({ node: j, side: 'end', dy: 0 });
      }
      ordered = [...free.filter((x) => !clash(x)), ...free.filter(clash)];
      if (free.filter((x) => !clash(x)).length >= ls.length) break;
    }
    ls.forEach((l, i) => {
      const sl = ordered[i]!;
      slotOf.set(slotKey(a, l), sl);
      if (sl.dy !== 0) others.push(a.y + sl.dy);
    });
  }
  const hubW = (side: 1 | -1) => Math.max(0, ...[...sinks, ...sources].filter((a) => a.dir === side).map((a) => chainLen(a) * stepOf(a))) + 2;

  // --- Eingangszone oben: Linien nach unten verschieben ---
  const entryLanes = lanes.filter((l) => l.pairs.some((q) => q.src.kind === 'terminal'));
  const exitLanes = lanes.filter((l) => l.pairs.some((q) => q.dst.kind === 'terminal'));
  const maxTerm = (ls: Lane[]) => Math.max(0, ...ls.map((l) => termDepth(l.itemId)));
  const entryZone = entryLanes.length ? Math.ceil((maxTerm(entryLanes) + 4) / 4) * 4 : 0;
  for (const a of arranged) {
    for (const b of a.row.buildings) b.y += entryZone;
    for (const l of a.row.links) for (const w of l.waypoints) w.y += entryZone;
    for (const an of [...a.row.sinks, ...a.row.sources]) {
      an.y += entryZone;
      for (const w of an.approach) w.y += entryZone;
    }
    a.y += entryZone;
  }
  const rowsBottom = Math.max(entryZone, ...arranged.map((a) => a.y + a.row.height));
  const exitTop = Math.ceil((rowsBottom + rowGap) / 4) * 4;
  // Anschluss der Eingänge (vorn) bzw. Ausgänge (hinten) und Liftpunkt hinter bzw. vor dem Anschluss
  const entryPortY = entryZone - 2;
  const exitPortY = exitTop + 2;

  // --- Lage der Spuren: Intervalle in y, gierig belegt ---
  const slotY = (a: Anchor, l: Lane) => a.y + (slotOf.get(slotKey(a, l))?.dy ?? 0);
  const eventY = (l: Lane, e: LaneEnd) => (e.kind === 'anchor' ? slotY(e.anchor, l) : e.kind === 'entry' ? entryPortY : exitPortY);
  const span = (l: Lane) => {
    const ys = l.pairs.flatMap((q) => [eventY(l, endOf(q, 'src')), eventY(l, endOf(q, 'dst'))]);
    return [Math.min(...ys) - 3, Math.max(...ys) + 3] as const;
  };
  const pitch = opts.spacing === 'wide' ? 8 : 7;
  const slotEnds: number[] = [];
  const busLanes = lanes.filter((l) => !l.edge);
  const order = [...busLanes].sort((a, b) => span(a)[0] - span(b)[0]);
  for (const l of order) {
    const [lo, hi] = span(l);
    let k = slotEnds.findIndex((end) => end < lo);
    if (k < 0) {
      k = slotEnds.length;
      slotEnds.push(hi);
    } else slotEnds[k] = hi;
    l.x = k;
  }
  // Verbesserung bei gleicher Spurzahl: Spuren verschieben bzw. tauschen, solange die Abzweige
  // kürzer werden (rechte Linien → rechte Spuren); sonst laufen Abzweige quer über den ganzen Bus
  {
    const K = slotEnds.length;
    const spans = new Map(busLanes.map((l) => [l, span(l)] as const));
    const dirsOf = new Map(busLanes.map((l) => [l, l.pairs.flatMap((q) => [q.src, q.dst]).flatMap((e) => (e.kind === 'anchor' ? [e.anchor.dir] : []))] as const));
    const cost = (l: Lane, k: number) => dirsOf.get(l)!.reduce((sum, d) => sum + Math.abs(k - (d > 0 ? K - 1 : 0)), 0);
    const free = (l: Lane, k: number, ignore?: Lane) => {
      const [lo, hi] = spans.get(l)!;
      return busLanes.every((o) => o === l || o === ignore || o.x !== k || spans.get(o)![1] < lo || hi < spans.get(o)![0]);
    };
    for (let round = 0, changed = true; changed && round < 20; round++) {
      changed = false;
      for (const l of busLanes) {
        for (let k = 0; k < K; k++) {
          if (k === l.x) continue;
          if (free(l, k)) {
            if (cost(l, k) < cost(l, l.x) - 1e-9) {
              l.x = k;
              changed = true;
            }
            continue;
          }
          // Tausch: alle Spuren, die dort im Weg sind, wechseln gemeinsam auf den bisherigen Platz
          const [lo, hi] = spans.get(l)!;
          const blockers = busLanes.filter((o) => o !== l && o.x === k && !(spans.get(o)![1] < lo || hi < spans.get(o)![0]));
          const from = l.x;
          const before = cost(l, from) + blockers.reduce((sum, o) => sum + cost(o, k), 0);
          const after = cost(l, k) + blockers.reduce((sum, o) => sum + cost(o, from), 0);
          if (after >= before - 1e-9) continue;
          const others = (o: Lane) => busLanes.filter((x) => x !== l && !blockers.includes(x) && x !== o);
          const fitsIn = (o: Lane, slot: number) => {
            const [a1, b1] = spans.get(o)!;
            return others(o).every((x) => x.x !== slot || spans.get(x)![1] < a1 || b1 < spans.get(x)![0]);
          };
          if (!fitsIn(l, k) || !blockers.every((o) => fitsIn(o, from))) continue;
          for (const o of blockers) o.x = from;
          l.x = k;
          changed = true;
        }
      }
    }
  }
  // Spalten für Lifte am Linienrand: je Seite eigene Spuren nach y-Intervall
  const edgeTrack = new Map<Lane, number>();
  const edgeTracks = { 1: 0, [-1]: 0 } as Record<1 | -1, number>;
  for (const side of [1, -1] as const) {
    const ends: number[] = [];
    for (const l of lanes.filter((x) => x.edge === side).sort((a, b) => span(a)[0] - span(b)[0])) {
      const [lo, hi] = span(l);
      let k = ends.findIndex((end) => end < lo);
      if (k < 0) {
        k = ends.length;
        ends.push(hi);
      } else ends[k] = hi;
      edgeTrack.set(l, k);
    }
    edgeTracks[side] = ends.length;
  }
  const EDGE_STEP = 2;
  const leftHub = sides.includes(-1) ? hubW(-1) + EDGE_STEP * edgeTracks[-1] : 0;
  const rightHub = hubW(1) + EDGE_STEP * edgeTracks[1];
  const corridor = Math.ceil((leftHub + Math.max(1, slotEnds.length) * pitch + rightHub) / 8) * 8;
  const busLeft = leftHub + (corridor - leftHub - rightHub - Math.max(1, slotEnds.length) * pitch) / 2;
  for (const l of busLanes) l.x = busLeft + pitch * (l.x + 0.5);
  for (const l of lanes) {
    if (!l.edge) continue;
    const t = edgeTrack.get(l)!;
    l.x = l.edge === 1 ? corridor - hubW(1) - EDGE_STEP / 2 - EDGE_STEP * t : hubW(-1) + EDGE_STEP / 2 + EDGE_STEP * t;
  }

  // --- Linien an ihren Rand schieben: rechte beginnen bei x = corridor, linke enden bei 0 ---
  const edgeOf = (dir: 1 | -1) => (dir === 1 ? corridor : 0);
  for (const a of arranged) {
    const dx = edgeOf(a.dir);
    for (const b of a.row.buildings) b.x += dx;
    for (const l of a.row.links) for (const w of l.waypoints) w.x += dx;
    for (const an of [...a.row.sinks, ...a.row.sources]) {
      an.edge += dx;
      for (const w of an.approach) w.x += dx;
    }
  }
  const buildings: DraftBuilding[] = arranged.flatMap((a) => a.row.buildings);
  const links: DraftLink[] = arranged.flatMap((a) => a.row.links);
  const copy = (pts: DraftPoint[]) => pts.map((w) => ({ ...w }));
  const splitter = gd.building(SPLITTER)!;
  const merger = gd.building(MERGER)!;
  const junction = gd.building(JUNCTION)!;
  const link = (kind: 'belt' | 'pipe', itemId: string, perMin: number, from: { key: string; portId: string }, to: { key: string; portId: string }, waypoints: DraftPoint[]) =>
    links.push({ kind, tier: tierFor(kind, perMin), itemId, perMin, from, to, waypoints });

  // --- Verteilketten anlegen (am Boden, zwischen Bus und Linie) ---
  const chainRef = new Map<string, { key: string; portId: string }>();
  for (const [a, ls] of lanesAt) {
    const h = chainLen(a);
    if (h === 0) continue;
    const isSink = sinks.includes(a);
    const pipe = a.kind === 'pipe';
    const def = pipe ? junction : isSink ? merger : splitter;
    const dirs: PortDef['direction'][] = pipe ? ['any'] : isSink ? ['in'] : ['out'];
    const rot = pipe ? 0 : isSink ? rotationFor(merger, 'belt-out-0', { x: a.dir, y: 0 }) : rotationFor(splitter, 'belt-in-0', { x: a.dir, y: 0 });
    const towardRow = pipe ? portFacing(def, rot, 'pipe', ['any'], { x: a.dir, y: 0 })!.id : isSink ? 'belt-out-0' : 'belt-in-0';
    const away = portFacing(def, rot, a.kind, dirs, { x: -a.dir, y: 0 })!.id;
    const sidePort: Record<SlotSide, string> = {
      up: portFacing(def, rot, a.kind, dirs, { x: 0, y: -1 })!.id,
      down: portFacing(def, rot, a.kind, dirs, { x: 0, y: 1 })!.id,
      end: away,
    };
    const nodes: DraftBuilding[] = [];
    for (let j = 0; j < h; j++) {
      nodes.push({
        key: keys.next(pipe ? 'j' : isSink ? 'g' : 's'),
        type: pipe ? JUNCTION : isSink ? MERGER : SPLITTER,
        role: pipe ? 'junction' : isSink ? 'merger' : 'splitter',
        recipeId: null,
        clock: 1,
        ...onFloor(a.floor, tapH(a.dir) - portZ(def)),
        x: a.edge - a.dir * (stepOf(a) / 2 + 1 + stepOf(a) * j),
        y: a.y,
        rotationDeg: rot,
        label: '',
      });
    }
    buildings.push(...nodes);
    // Kette auf Abzweighöhe der Seite: Lift zwischen Kette und Linie
    const lift = (from: number, to: number) =>
      Math.abs(from - to) < 1e-6 ? [] : [from, to].map((h) => ({ x: a.edge - a.dir, y: a.y, ...onFloor(a.floor, h) }));
    const amount = (l: Lane) =>
      l.pairs
        .filter((q) => {
          const e = isSink ? q.dst : q.src;
          return e.kind === 'anchor' && e.anchor === a;
        })
        .reduce((s, q) => s + q.perMin, 0);
    const beyond = (j: number) => ls.filter((l) => slotOf.get(slotKey(a, l))!.node >= j).reduce((s, l) => s + amount(l), 0);
    for (const l of ls) {
      const s = slotOf.get(slotKey(a, l))!;
      chainRef.set(slotKey(a, l), { key: nodes[s.node]!.key, portId: sidePort[s.side] });
    }
    if (isSink) {
      link(a.kind, a.itemId, beyond(0), { key: nodes[0]!.key, portId: towardRow }, a.ref, [...lift(tapH(a.dir), a.h), ...copy(a.approach)]);
      for (let j = 0; j + 1 < h; j++) link(a.kind, a.itemId, beyond(j + 1), { key: nodes[j + 1]!.key, portId: towardRow }, { key: nodes[j]!.key, portId: away }, []);
    } else {
      link(a.kind, a.itemId, beyond(0), a.ref, { key: nodes[0]!.key, portId: towardRow }, [...copy(a.approach), ...lift(a.h, tapH(a.dir))]);
      for (let j = 0; j + 1 < h; j++) link(a.kind, a.itemId, beyond(j + 1), { key: nodes[j]!.key, portId: away }, { key: nodes[j + 1]!.key, portId: towardRow }, []);
    }
  }

  // --- Ein- und Ausgänge am Anfang bzw. Ende ihrer Spur ---
  const terminals: DraftTerminal[] = [];
  const termRef = new Map<Lane, { in?: { key: string; portId: string }; out?: { key: string; portId: string } }>();
  const addTerminal = (l: Lane, dir: 'in' | 'out') => {
    const amount = l.pairs.filter((q) => (dir === 'in' ? q.src : q.dst).kind === 'terminal').reduce((s, q) => s + q.perMin, 0);
    const fluid = l.kind === 'pipe';
    const type = fluid ? FLUID_BUFFER : STORAGE;
    const tdef = gd.building(type)!;
    const portId = fluid ? (dir === 'in' ? 'pipe-out-0' : 'pipe-in-0') : dir === 'in' ? 'belt-out-0' : 'belt-in-0';
    // Anschluss zum Bus zeigt zur Spur: bei Eingängen nach unten, bei Ausgängen nach oben
    const rot = rotationFor(tdef, portId, { x: 0, y: dir === 'in' ? 1 : -1 });
    const bb = rotatedBounds(tdef, rot);
    // Eingänge enden unten an der Eingangszone, Ausgänge beginnen oben an der Ausgangszone
    const cy = dir === 'in' ? entryZone - 2 - bb.maxY : exitTop + 2 - bb.minY;
    const key = keys.next(dir === 'in' ? 'e' : 'x');
    const otherPort = fluid ? (dir === 'in' ? 'pipe-in-0' : 'pipe-out-0') : dir === 'in' ? 'belt-in-0' : 'belt-out-0';
    const same = (dir === 'in' ? entryLanes : exitLanes).filter((x) => x.itemId === l.itemId);
    const label =
      (dir === 'in' ? tr('Eingang: {item}', { item: gd.name(l.itemId) }) : tr('Ausgang: {item}', { item: gd.name(l.itemId) })) +
      (same.length > 1 ? ` (${same.indexOf(l) + 1}/${same.length})` : '');
    buildings.push({ key, type, role: dir === 'in' ? 'entry' : 'exit', recipeId: null, clock: 1, ...onFloor(l.floor, busH - LINE_H), x: l.x, y: cy, rotationDeg: rot, label, itemId: l.itemId });
    terminals.push({ key, itemId: l.itemId, perMin: amount, dir, portId: otherPort });
    const r = termRef.get(l) ?? {};
    r[dir] = { key, portId };
    termRef.set(l, r);
  };
  for (const l of entryLanes) addTerminal(l, 'in');
  for (const l of exitLanes) addTerminal(l, 'out');

  // --- Busspuren: Knoten (Splitter, Zusammenführungen, Rohrkreuzungen) und Leitungen ---
  for (const l of lanes) {
    const pt = (y: number, h: number, floor = l.floor, x = l.x): DraftPoint => ({ x, y, ...onFloor(floor, h) });
    const vert = (y: number, a: number, b: number, floor = l.floor, x = l.x) => (Math.abs(a - b) < 1e-6 ? [] : [pt(y, a, floor, x), pt(y, b, floor, x)]);
    // Ereignisse der Spur: je Anschluss bzw. Ein-/Ausgang eines, mit Menge
    interface Ev {
      end: LaneEnd;
      y: number;
      inflow: number;
      outflow: number;
    }
    const evs = new Map<unknown, Ev>();
    for (const q of l.pairs) {
      for (const s of ['src', 'dst'] as const) {
        const e = endOf(q, s);
        const k = keyOf(e);
        const ev = evs.get(k) ?? { end: e, y: eventY(l, e), inflow: 0, outflow: 0 };
        if (s === 'src') ev.inflow += q.perMin;
        else ev.outflow += q.perMin;
        evs.set(k, ev);
      }
    }
    const down = !l.exclusive || l.pairs.every((q) => yOfEnd(endOf(q, 'src')) < yOfEnd(endOf(q, 'dst')));
    // Einzelspuren: Quelle vor Ziel (die Versätze der Verteilketten dürfen die Reihenfolge nicht drehen)
    const list = l.exclusive ? [...evs.values()].sort((a, b) => b.inflow - a.inflow) : [...evs.values()].sort((a, b) => (down ? a.y - b.y : b.y - a.y));
    const refAt = (e: LaneEnd, dir: 'in' | 'out') => {
      if (e.kind === 'entry') return termRef.get(l)!.in!;
      if (e.kind === 'exit') return termRef.get(l)!.out!;
      return chainRef.get(slotKey(e.anchor, l)) ?? e.anchor.ref;
    };
    const viaChain = (a: Anchor) => chainRef.has(slotKey(a, l));
    /** Punkte vom Linienanschluss bis auf die Spur (Abgang) bzw. umgekehrt (Ankunft). */
    /** Höhe des Abzweigs und Lift am Linienrand (bei Verteilketten sitzt der Lift zwischen Kette und Linie). */
    const th = (a: Anchor) => tapH(a.dir);
    const edgeLift = (a: Anchor, y: number, from: number, to: number) => (viaChain(a) ? [] : vert(y, from, to, a.floor, a.edge - a.dir));
    /** `descend`: auf der Spur auf Bushöhe absenken (nicht bei Stockwerkswechsel – der Lift geht direkt von der Abzweighöhe aus). */
    const fromAnchor = (a: Anchor, y: number, toX: number, descend = true) => [
      ...(viaChain(a) ? [] : copy(a.approach)),
      ...edgeLift(a, y, a.h, th(a)),
      pt(y, th(a), a.floor, toX),
      ...(descend ? vert(y, th(a), busH, a.floor, toX) : []),
    ];
    const toAnchor = (a: Anchor, y: number, fromX: number) => [
      ...vert(y, busH, th(a), a.floor, fromX),
      pt(y, th(a), a.floor, fromX),
      ...edgeLift(a, y, th(a), a.h),
      ...(viaChain(a) ? [] : copy(a.approach)),
    ];
    const flowAfter: number[] = [];
    let acc = 0;
    for (const ev of list) {
      acc += ev.inflow - ev.outflow;
      flowAfter.push(acc);
    }
    // Knoten in der Mitte der Spur
    const nodes = new Map<Ev, DraftBuilding>();
    list.forEach((ev, i) => {
      if (i === 0 || i === list.length - 1) return;
      const isSrc = ev.inflow > 0;
      const pipe = l.kind === 'pipe';
      const def = pipe ? junction : isSrc ? merger : splitter;
      const rot = pipe ? 0 : rotationFor(def, isSrc ? 'belt-out-0' : 'belt-in-0', isSrc ? { x: 0, y: down ? 1 : -1 } : { x: 0, y: down ? -1 : 1 });
      const nd: DraftBuilding = {
        key: keys.next(pipe ? 'j' : isSrc ? 'g' : 's'),
        type: pipe ? JUNCTION : isSrc ? MERGER : SPLITTER,
        role: pipe ? 'junction' : isSrc ? 'merger' : 'splitter',
        recipeId: null,
        clock: 1,
        ...onFloor(l.floor, busH - portZ(def)),
        x: l.x,
        y: ev.y,
        rotationDeg: rot,
        label: '',
      };
      buildings.push(nd);
      nodes.set(ev, nd);
    });
    const dy = down ? 1 : -1;
    const nodePort = (nd: DraftBuilding, want: Vec2, dirs: PortDef['direction'][]) => portFacing(gd.building(nd.type)!, nd.rotationDeg, l.kind, dirs, want)!.id;
    // Flüssigkeitspuffer bei Zwischenprodukten: im Abschnitt vor dem ersten Verbraucher, an einer
    // Stelle, an der kein Abzweig einer anderen Spur den Bus quert
    let buffer: { at: number; node: DraftBuilding } | null = null;
    const intermediate = l.kind === 'pipe' && !l.exclusive && list.some((ev) => ev.end.kind === 'anchor' && ev.inflow > 0) && list.some((ev) => ev.end.kind === 'anchor' && ev.outflow > 0);
    if (opts.fluidBuffers && intermediate) {
      const bdef = gd.building(FLUID_BUFFER)!;
      const half = Math.max(bdef.bounds!.maxY, -bdef.bounds!.minY);
      const at = list.findIndex((ev, i) => i + 1 < list.length && list[i + 1]!.outflow > 0 && flowAfter[i]! > 1e-9);
      const a = list[at];
      const b = list[at + 1];
      if (a && b) {
        // Freie Stelle: Abstand zu den Knoten der Spur (Rohrkreuzung ±1,2 m) und zu allen Abgängen (Anschlusslinien)
        const blocked = [...lanes.flatMap((o) => o.pairs.flatMap((q) => [endOf(q, 'src'), endOf(q, 'dst')].map((e) => eventY(o, e)))), ...[...sinks, ...sources].map((an) => an.y)];
        const lo = Math.min(a.y, b.y) + half + 2.5;
        const hi = Math.max(a.y, b.y) - half - 2.5;
        let y: number | null = null;
        for (let c = Math.round((lo + hi) / 2), k = 0; c - k >= lo || c + k <= hi; k++) {
          for (const cand of [c - k, c + k]) {
            if (y !== null || cand < lo || cand > hi) continue;
            if (blocked.every((v) => Math.abs(v - cand) >= half + 2)) y = cand;
          }
          if (y !== null) break;
        }
        if (y === null) notes.add(tr('Flüssigkeitspuffer für {item} ausgelassen: kein freier Platz auf der Busspur.', { item: gd.name(l.itemId) }));
        else {
          const node: DraftBuilding = {
            key: keys.next('b'),
            type: FLUID_BUFFER,
            role: 'buffer',
            recipeId: null,
            clock: 1,
            ...onFloor(l.floor, busH - LINE_H),
            x: l.x,
            y,
            rotationDeg: rotationFor(bdef, 'pipe-in-0', { x: 0, y: -dy }),
            label: tr('Puffer: {item}', { item: gd.name(l.itemId) }),
            itemId: l.itemId,
          };
          buildings.push(node);
          buffer = { at, node };
        }
      }
    }
    // Leitungen entlang der Spur
    for (let i = 0; i + 1 < list.length; i++) {
      const a = list[i]!;
      const b = list[i + 1]!;
      const na = nodes.get(a);
      const nb = nodes.get(b);
      let from: { key: string; portId: string };
      let to: { key: string; portId: string };
      const wps: DraftPoint[] = [];
      if (na) from = { key: na.key, portId: nodePort(na, { x: 0, y: dy }, l.kind === 'pipe' ? ['any'] : ['out']) };
      else {
        from = refAt(a.end, 'out');
        if (a.end.kind === 'entry') wps.push(...vert(entryPortY + 1.5, busH, busH));
        else if (a.end.kind === 'anchor') {
          const floorChange = b.end.kind === 'anchor' && a.end.anchor.floor !== b.end.anchor.floor;
          wps.push(...fromAnchor(a.end.anchor, a.y, l.x, !floorChange));
        }
      }
      // Etagenwechsel (nur Einzelspuren): Lift auf der Spur am Abgang
      if (!na && a.end.kind === 'anchor' && b.end.kind === 'anchor' && a.end.anchor.floor !== b.end.anchor.floor) wps.push(pt(a.y, busH, b.end.anchor.floor));
      const split = wps.length;
      if (nb) to = { key: nb.key, portId: nodePort(nb, { x: 0, y: -dy }, l.kind === 'pipe' ? ['any'] : ['in']) };
      else {
        to = refAt(b.end, 'in');
        if (b.end.kind === 'exit') wps.push(...vert(exitPortY - 1.5, busH, busH));
        else if (b.end.kind === 'anchor') wps.push(...toAnchor(b.end.anchor, b.y, l.x));
      }
      if (buffer && buffer.at === i) {
        // Abschnitt durch den Puffer: Zulauf hinten, Ablauf vorn; am Puffer auf dessen Anschlusshöhe statt auf Bushöhe
        const bz = buffer.node.h + portZ(gd.building(FLUID_BUFFER)!);
        const head = wps.slice(0, split);
        const tail = wps.slice(split);
        for (let k = head.length - 1; k >= 0 && Math.abs(head[k]!.h - busH) < EPS; k--) head[k]!.h = bz;
        for (let k = 0; k < tail.length && Math.abs(tail[k]!.h - busH) < EPS; k++) tail[k]!.h = bz;
        link(l.kind, l.itemId, flowAfter[i]!, from, { key: buffer.node.key, portId: 'pipe-in-0' }, head);
        link(l.kind, l.itemId, flowAfter[i]!, { key: buffer.node.key, portId: 'pipe-out-0' }, to, tail);
      } else link(l.kind, l.itemId, flowAfter[i]!, from, to, wps);
    }
    // Abzweige und Einspeisungen an den Knoten
    for (const [ev, nd] of nodes) {
      if (ev.end.kind !== 'anchor') continue;
      const an = ev.end.anchor;
      const side = an.dir;
      const off = l.x + side * ((l.kind === 'pipe' ? 1.2 : 2) + PORT_STUB_M + 0.5);
      if (ev.outflow > 0) {
        const port = nodePort(nd, { x: side, y: 0 }, l.kind === 'pipe' ? ['any'] : ['out']);
        link(l.kind, l.itemId, ev.outflow, { key: nd.key, portId: port }, refAt(ev.end, 'in'), toAnchor(an, ev.y, off));
      } else {
        const port = nodePort(nd, { x: side, y: 0 }, l.kind === 'pipe' ? ['any'] : ['in']);
        link(l.kind, l.itemId, ev.inflow, refAt(ev.end, 'out'), { key: nd.key, portId: port }, fromAnchor(an, ev.y, off));
      }
    }
  }

  // --- Hochgelegte Stücke absenken, wo darunter nichts kreuzt ---
  if (avoid) lowerFreeRuns(gd, buildings, links);

  // --- Maße auf dem 8-m-Raster, Etagenhöhen, Vorgaben ---
  const xs: number[] = [];
  const ys: number[] = [];
  for (const b of buildings) {
    const bb = gd.building(b.type)?.bounds;
    if (!bb) continue;
    for (const c of [
      { x: bb.minX, y: bb.minY },
      { x: bb.maxX, y: bb.maxY },
    ]) {
      const r = rot90(c, b.rotationDeg);
      xs.push(b.x + r.x);
      ys.push(b.y + r.y);
    }
  }
  for (const l of links) for (const w of l.waypoints) {
    xs.push(w.x);
    ys.push(w.y);
  }
  xs.push(0, corridor);
  const minX = Math.floor((Math.min(...xs) - 1) / 8) * 8;
  const minY = Math.floor((Math.min(...ys, 0) - 1) / 8) * 8;
  const width = Math.ceil((Math.max(...xs) + 1 - minX) / 8) * 8;
  const depth = Math.ceil((Math.max(...ys) + 1 - minY) / 8) * 8;
  for (const b of buildings) {
    b.x -= minX;
    b.y -= minY;
  }
  for (const l of links) for (const w of l.waypoints) {
    w.x -= minX;
    w.y -= minY;
  }
  const floorHeights: number[] = [];
  const floorKinds: FloorKind[] = [];
  for (let f = 0; f < (opts.logistics ? 2 * floors : floors); f++) {
    const kind: FloorKind = opts.logistics && f % 2 === 0 ? 'logistics' : 'production';
    const tallest = Math.max(4, ...buildings.filter((b) => b.floor === f).map((b) => b.h + buildingHeight(gd.building(b.type)!)));
    floorKinds.push(kind);
    floorHeights.push(Math.max(DEFAULT_FLOOR_HEIGHT_M[kind], Math.ceil((tallest + 2) / 2) * 2));
  }
  const fitsArea =
    (opts.maxWidthM === null || width <= opts.maxWidthM + 1e-6) && (opts.maxDepthM === null || depth <= opts.maxDepthM + 1e-6) && floors <= Math.max(1, opts.maxFloors);
  if (!fitsArea) notes.add(tr('Passt nicht in die vorgegebene Fläche: benötigt {w} × {d} m.', { w: Math.ceil(width), d: Math.ceil(depth) }));
  if (opts.distribution === 'balanced' && segments.some((s) => s.inItems.some((i) => isFluid(gd, i)) && s.machines.length > 1))
    notes.add(tr('Rohre werden immer als Sammelleitung verlegt.'));
  if (opts.logistics)
    notes.add(
      tr('Logistikebene unter jeder Produktionsebene: Bus, Zuführungen, Sammelleitungen und Ein-/Ausgänge liegen dort (Ebenen 1, 3 und 5 m über dem Logistikboden), Lifte führen durch die Decke zu den Maschinen.'),
    );
  else if (avoid)
    notes.add(
      twoSided
        ? tr('Kreuzungen über feste Höhen gelöst: Bus und Maschinenanschlüsse auf {h} m, Zuführungen, Sammelleitungen und Abzweige nach links auf {o} m, Abzweige nach rechts auf {o2} m, Lifte an den Übergängen.', { h: LINE_H, o: OVER_H, o2: OVER2_H })
        : tr('Kreuzungen über feste Höhen gelöst: Bus und Maschinenanschlüsse auf {h} m, Zuführungen, Sammelleitungen und Abzweige auf {o} m, Lifte an den Übergängen.', { h: LINE_H, o: OVER_H }),
    );
  const count = (role: DraftRole) => buildings.filter((b) => b.role === role).length;
  return {
    corridor,
    draft: {
      variant,
      buildings,
      links,
      floorHeights,
      floorKinds,
      width,
      depth,
      fits: fitsArea,
      terminals,
      counts: {
        machines: count('machine'),
        splitters: count('splitter'),
        mergers: count('merger'),
        junctions: count('junction'),
        buffers: count('buffer'),
        entries: count('entry'),
        exits: count('exit'),
        lines: segments.length,
        lanes: lanes.length,
      },
      notes: [...notes],
    },
  };
}

// ---------------------------------------------------------------------------
// Übernehmen und Prüfen
// ---------------------------------------------------------------------------

/** Freie Stelle für ein neues Layout: rechts neben allem, was in der Fabrik schon steht (8-m-Raster). */
export function freeLayoutOrigin(p: Project, gd: GameDataIndex, factoryId: string): Vec2 {
  const xs: number[] = [];
  const ys: number[] = [];
  for (const b of Object.values(p.buildings)) {
    if (b.factoryId !== factoryId || !b.placement) continue;
    const bb = gd.building(b.type)?.bounds;
    const r = bb ? Math.max(Math.abs(bb.minX), Math.abs(bb.maxX), Math.abs(bb.minY), Math.abs(bb.maxY)) : 1;
    xs.push(b.placement.x + r);
    ys.push(b.placement.y - r);
  }
  for (const a of Object.values(p.areas)) {
    if (a.factoryId !== factoryId) continue;
    for (const v of a.polygon) {
      xs.push(v.x);
      ys.push(v.y);
    }
  }
  if (xs.length === 0) return { x: 0, y: 0 };
  return { x: Math.ceil((Math.max(...xs) + 8) / 8) * 8, y: Math.floor(Math.min(...ys) / 8) * 8 };
}

export interface ApplyLayoutResult {
  buildingIds: string[];
  linkIds: string[];
  floorIds: string[];
  /** Entwurfsschlüssel → Gebäude-ID. */
  keyToId: Map<string, string>;
}

/**
 * Setzt einen Entwurf mit seiner oberen linken Ecke an `origin` in die Fabrik.
 * Fehlende Etagen werden über der obersten angelegt. Nicht platzierte
 * Maschinen der Fabrik mit passendem Rezept werden verwendet, statt neue anzulegen.
 */
export function applyLayout(p: Project, gd: GameDataIndex, factoryId: string, draft: LayoutDraft, origin: Vec2, opts: { foundations?: boolean } = {}): ApplyLayoutResult {
  const f = p.factories[factoryId];
  if (!f) throw new OpError(tr('{what} nicht gefunden.', { what: tr('Fabrik') }));
  const created: string[] = [];
  // Oberste vorhandene Etage bei Bedarf erhöhen (darüber liegt nichts), neue Etagen darüber anlegen
  const existing = f.floorIds.length;
  const kinds = draft.floorKinds ?? [];
  if (draft.floorHeights.length > 0 && existing <= draft.floorHeights.length) {
    const top = p.floors[f.floorIds[existing - 1]!]!;
    const want = kinds[existing - 1] ?? top.kind;
    const empty = !Object.values(p.buildings).some((b) => b.placement?.floorId === top.id) && !Object.values(p.areas).some((a) => a.floorId === top.id);
    if (empty && want !== top.kind) {
      // Leere oberste Etage übernimmt Art und Höhe aus dem Entwurf (z. B. Logistikebene in einer neuen Fabrik)
      top.kind = want;
      top.heightM = draft.floorHeights[existing - 1]!;
    } else top.heightM = Math.max(top.heightM, draft.floorHeights[existing - 1]!);
  }
  for (let i = existing; i < draft.floorHeights.length; i++) {
    created.push(addFloor(p, factoryId, { heightM: draft.floorHeights[i], kind: kinds[i] ?? 'production' }));
  }
  const floorIds = [...p.factories[factoryId]!.floorIds];
  const floorId = (i: number) => floorIds[i]!;
  const elev = (i: number) => p.floors[floorId(i)]!.elevationM;
  const keyToId = new Map<string, string>();
  const spare = new Map<string, string[]>();
  for (const b of Object.values(p.buildings)) {
    if (b.factoryId !== factoryId || b.placement || !b.recipeId) continue;
    const k = `${b.type}|${b.recipeId}`;
    spare.set(k, [...(spare.get(k) ?? []), b.id]);
  }
  for (const b of draft.buildings) {
    const placement = { floorId: floorId(b.floor), x: origin.x + b.x, y: origin.y + b.y, zOffsetM: b.h, rotationDeg: b.rotationDeg };
    const reuse = b.role === 'machine' ? spare.get(`${b.type}|${b.recipeId}`)?.shift() : undefined;
    let id: string;
    if (reuse) {
      placeBuilding(p, reuse, placement);
      updateBuildings(p, gd, [reuse], { clock: b.clock });
      id = reuse;
    } else {
      id = addBuilding(p, gd, { factoryId, type: b.type, recipeId: b.recipeId ?? undefined, clock: b.clock, label: b.label || undefined, placement });
    }
    keyToId.set(b.key, id);
  }
  const linkIds: string[] = [];
  for (const l of draft.links) {
    const id = addLink(p, gd, {
      kind: l.kind,
      tier: l.tier,
      from: { buildingId: keyToId.get(l.from.key)!, portId: l.from.portId },
      to: { buildingId: keyToId.get(l.to.key)!, portId: l.to.portId },
      waypoints: l.waypoints.map((w) => ({ x: origin.x + w.x, y: origin.y + w.y, z: elev(w.floor) + w.h })),
      routing: 'straight',
    });
    linkIds.push(id);
  }
  if (opts.foundations) {
    for (let i = 0; i < draft.floorHeights.length; i++) {
      const x0 = origin.x;
      const y0 = origin.y;
      const x1 = origin.x + Math.ceil(draft.width / 8) * 8;
      const y1 = origin.y + Math.ceil(draft.depth / 8) * 8;
      addArea(p, {
        factoryId,
        floorId: floorId(i),
        kind: 'foundation',
        foundationType: FOUNDATION,
        name: tr('Fundament (Auto-Layout)'),
        polygon: [
          { x: x0, y: y0 },
          { x: x1, y: y0 },
          { x: x1, y: y1 },
          { x: x0, y: y1 },
        ],
      });
    }
  }
  return { buildingIds: [...keyToId.values()], linkIds, floorIds: created, keyToId };
}

export interface LayoutCheck {
  /** Kleinste und mittlere Auslastung der Maschinen des Layouts (Durchsatzmodell). */
  minUtilization: number;
  avgUtilization: number;
  machines: number;
  /** Feste Überschneidungen von Gebäuden (FAB-001) mit Beteiligung des Layouts. */
  hardOverlaps: number;
  softOverlaps: number;
  beltLengthM: number;
  pipeLengthM: number;
  liftCount: number;
  /** Leitungspaare, die sich auf gleicher Höhe kreuzen oder überdecken. */
  crossings: number;
  /** Leitungspaare, die im Grundriss über mehr als 4 m übereinander liegen (verschiedene Höhen). */
  stacked: number;
}

/**
 * Zählt Leitungspaare, die sich im Grundriss schneiden oder auf einer Strecke
 * überdecken und dort auf gleicher Höhe (< 0,5 m Unterschied) liegen.
 * Senkrechte Abschnitte (Lifte) zählen nicht.
 */
/** `out` sammelt auf Wunsch die betroffenen Leitungspaare (Fehlersuche). */
export function countCrossings(p: Project, gd: GameDataIndex, linkIds: string[], out?: string[][]): number {
  interface Seg {
    link: string;
    floor: string;
    a: { x: number; y: number; z: number };
    b: { x: number; y: number; z: number };
  }
  const segs: Seg[] = [];
  for (const id of linkIds) {
    const l = p.links[id];
    if (!l) continue;
    const path = linkPath(p, gd, l);
    if (!path) continue;
    const floor = p.buildings[l.from.buildingId]?.placement?.floorId ?? '';
    for (let i = 1; i < path.length; i++) {
      const a = path[i - 1]!;
      const b = path[i]!;
      if (Math.hypot(b.x - a.x, b.y - a.y) < 1e-6) continue;
      segs.push({ link: id, floor, a, b });
    }
  }
  const CELL = 8;
  const grid = new Map<string, number[]>();
  segs.forEach((sg, i) => {
    for (let cx = Math.floor(Math.min(sg.a.x, sg.b.x) / CELL); cx <= Math.floor(Math.max(sg.a.x, sg.b.x) / CELL); cx++)
      for (let cy = Math.floor(Math.min(sg.a.y, sg.b.y) / CELL); cy <= Math.floor(Math.max(sg.a.y, sg.b.y) / CELL); cy++) {
        const k = `${cx},${cy}`;
        const list = grid.get(k) ?? [];
        list.push(i);
        grid.set(k, list);
      }
  });
  const zAt = (sg: Seg, t: number) => sg.a.z + (sg.b.z - sg.a.z) * t;
  const hits = new Set<string>();
  const tested = new Set<string>();
  for (const list of grid.values()) {
    for (let i = 0; i < list.length; i++)
      for (let j = i + 1; j < list.length; j++) {
        const s1 = segs[list[i]!]!;
        const s2 = segs[list[j]!]!;
        if (s1.link === s2.link) continue;
        const pairKey = s1.link < s2.link ? `${s1.link}|${s2.link}` : `${s2.link}|${s1.link}`;
        const segKey = `${list[i]}|${list[j]}`;
        if (hits.has(pairKey) || tested.has(segKey)) continue;
        tested.add(segKey);
        const x = segmentIntersection(s1.a, s1.b, s2.a, s2.b);
        if (x) {
          if (Math.abs(zAt(s1, x.ta) - zAt(s2, x.tb)) < 0.5) hits.add(pairKey);
          continue;
        }
        // Überdeckung auf einer Geraden
        const d1 = { x: s1.b.x - s1.a.x, y: s1.b.y - s1.a.y };
        const len = Math.hypot(d1.x, d1.y);
        const u = { x: d1.x / len, y: d1.y / len };
        const off = (q: { x: number; y: number }) => Math.abs((q.x - s1.a.x) * u.y - (q.y - s1.a.y) * u.x);
        const d2 = { x: s2.b.x - s2.a.x, y: s2.b.y - s2.a.y };
        if (Math.abs(d1.x * d2.y - d1.y * d2.x) > 1e-6 * len * Math.hypot(d2.x, d2.y) || off(s2.a) > 0.3 || off(s2.b) > 0.3) continue;
        const t = (q: { x: number; y: number }) => (q.x - s1.a.x) * u.x + (q.y - s1.a.y) * u.y;
        const lo = Math.max(0, Math.min(t(s2.a), t(s2.b)));
        const hi = Math.min(len, Math.max(t(s2.a), t(s2.b)));
        if (hi - lo > 0.3 && Math.abs(zAt(s1, (lo + hi) / 2 / len) - (s2.a.z + s2.b.z) / 2) < 0.5) hits.add(pairKey);
      }
  }
  if (out) for (const k of hits) out.push(k.split('|'));
  return hits.size;
}

/**
 * Leitungen, die im Grundriss auf derselben Linie übereinander liegen
 * (achsparallel, höchstens 1 m seitlicher Versatz, verschiedene Höhe, mehr
 * als `minM` gemeinsame Länge). Liefert die Zahl der Paare und die längste Überdeckung.
 */
export function countStacked(p: Project, gd: GameDataIndex, linkIds: string[], minM = 4, out?: { links: [string, string]; lengthM: number; z: [number, number] }[]): { pairs: number; longestM: number } {
  interface Seg {
    link: string;
    floor: string;
    axis: 'x' | 'y';
    c: number;
    lo: number;
    hi: number;
    z: number;
  }
  const byLine = new Map<string, Seg[]>();
  for (const id of linkIds) {
    const l = p.links[id];
    if (!l) continue;
    const path = linkPath(p, gd, l);
    if (!path) continue;
    const floors = (p.factories[l.factoryId]?.floorIds ?? []).map((fid) => p.floors[fid]!).filter(Boolean);
    for (let i = 1; i < path.length; i++) {
      const a = path[i - 1]!;
      const b = path[i]!;
      // Stockwerk nach Höhe (eine Leitung kann mehrere Stockwerke durchlaufen)
      const floor = floors.filter((f) => f.elevationM <= a.z + 1e-3).sort((x, y) => y.elevationM - x.elevationM)[0]?.id ?? '';
      const axis = Math.abs(a.y - b.y) < EPS && Math.abs(a.x - b.x) > EPS ? 'x' : Math.abs(a.x - b.x) < EPS && Math.abs(a.y - b.y) > EPS ? 'y' : null;
      if (!axis) continue;
      const c = axis === 'x' ? a.y : a.x;
      const sg: Seg = { link: id, floor, axis, c, lo: Math.min(axis === 'x' ? a.x : a.y, axis === 'x' ? b.x : b.y), hi: Math.max(axis === 'x' ? a.x : a.y, axis === 'x' ? b.x : b.y), z: (a.z + b.z) / 2 };
      const k = `${floor}|${axis}|${Math.round(c)}`;
      byLine.set(k, [...(byLine.get(k) ?? []), sg]);
    }
  }
  const pairs = new Map<string, number>();
  for (const [k, list] of byLine) {
    // Nachbarlinien (Rundung) mit einbeziehen
    const [floor, axis, c] = k.split('|');
    const near = [...list, ...(byLine.get(`${floor}|${axis}|${+c! + 1}`) ?? [])];
    for (const s1 of list)
      for (const s2 of near) {
        if (s1.link === s2.link || Math.abs(s1.c - s2.c) > 1 || Math.abs(s1.z - s2.z) < 0.5) continue;
        const ov = Math.min(s1.hi, s2.hi) - Math.max(s1.lo, s2.lo);
        if (ov <= minM) continue;
        const key = s1.link < s2.link ? `${s1.link}|${s2.link}` : `${s2.link}|${s1.link}`;
        if (out && !pairs.has(key)) out.push({ links: [s1.link, s2.link], lengthM: ov, z: [s1.z, s2.z] });
        pairs.set(key, Math.max(pairs.get(key) ?? 0, ov));
      }
  }
  return { pairs: pairs.size, longestM: Math.max(0, ...pairs.values()) };
}

/**
 * Prüft einen Entwurf an einer Kopie des Projekts: Durchsatzmodell mit
 * versorgten Eingängen (je Eingang so viel, wie der Plan zuliefert),
 * Überschneidungen und Leitungslängen.
 */
export function checkLayout(p: Project, gd: GameDataIndex, factoryId: string, draft: LayoutDraft, origin: Vec2): LayoutCheck {
  const copy = clone(p);
  const res = applyLayout(copy, gd, factoryId, draft, origin);
  for (const t of draft.terminals) {
    if (t.dir !== 'in') continue;
    const id = `layoutcheck_${t.key}`;
    const fluid = isFluid(gd, t.itemId);
    const order: TransportOrder = {
      id,
      name: '',
      itemId: t.itemId,
      ratePerMin: t.perMin,
      fromFactoryId: '__layout_check__',
      toFactoryId: factoryId,
      mode: fluid ? 'pipe' : 'belt',
      fromStationId: null,
      toStationId: null,
      trainIds: [],
      roundTripEstimateS: null,
      vehicle: null,
      drone: null,
      direct: { tier: fluid ? gd.pipeTiers.at(-1)!.id : gd.beltTiers.at(-1)!.id, lines: 100, lengthM: 0, from: null, to: { buildingId: res.keyToId.get(t.key)!, portId: t.portId } },
    };
    copy.transportOrders[id] = order;
  }
  const flow = computeFactoryFlow(copy, gd, factoryId);
  const mine = new Set(res.buildingIds);
  const utils = draft.buildings
    .filter((b) => b.role === 'machine')
    .map((b) => flow.machines.get(res.keyToId.get(b.key)!)?.utilization ?? 0);
  const overlaps = findOverlaps(placedShapes(copy, gd, factoryId)).filter((o) => mine.has(o.a.building.id) || mine.has(o.b.building.id));
  let belt = 0;
  let pipe = 0;
  let lifts = 0;
  for (const id of res.linkIds) {
    const l = copy.links[id]!;
    const path = linkPath(copy, gd, l);
    if (!path) continue;
    const len = pathLength(path);
    if (l.kind === 'belt') belt += len.total;
    else pipe += len.total;
    if (len.vertical > 0.5) lifts++;
  }
  return {
    minUtilization: utils.length ? Math.min(...utils) : 0,
    avgUtilization: utils.length ? utils.reduce((s, v) => s + v, 0) / utils.length : 0,
    machines: utils.length,
    hardOverlaps: overlaps.filter((o) => o.hard).length,
    softOverlaps: overlaps.filter((o) => !o.hard).length,
    beltLengthM: belt,
    pipeLengthM: pipe,
    liftCount: lifts,
    crossings: countCrossings(copy, gd, res.linkIds),
    stacked: countStacked(copy, gd, res.linkIds).pairs,
  };
}
