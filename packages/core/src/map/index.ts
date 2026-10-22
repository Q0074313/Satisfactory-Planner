/**
 * Weltkarte: Lage der Fabriken, Rohstoffvorkommen und Entfernungen.
 *
 * Fabriken haben eigene (lokale) Grundrisskoordinaten. Ist eine Fabrik auf
 * der Karte platziert, gilt Welt = Drehung(lokal) + Standort. Schienennetze
 * liegen direkt in Weltkoordinaten.
 */
import { buildingOutline, convexHull, isPlaced, transferInterface } from '../factory/geometry.ts';
import type { GameDataIndex } from '../gamedata/index.ts';
import { add, dist, rectOf, rotate, snap, sub, type Rect, type Vec2 } from '../geometry/index.ts';
import type { Building, Factory, FactoryMapPlacement, Project, TransportOrder } from '../model/schema.ts';
import { extractionRate } from '../production/machine.ts';
import { solveProduction } from '../production/solver.ts';
import type { MapNode } from './types.ts';

export * from './types.ts';

/** Fangweite für „Gebäude steht auf dem Vorkommen“ (Meter, Annahme). */
export const NODE_SNAP_M = 8;

/**
 * Weltraster des Spiels (Wiki „World grid“): ein Raster in globalen
 * Koordinaten, 8 m waagrecht, nur in Himmelsrichtungen. Der Planer legt die
 * Fundamentkanten auf Vielfache von 8 m, deckungsgleich mit dem gezeichneten
 * Weltraster (welcher Punkt des Fundaments im Spiel einrastet, ist nicht belegt).
 */
export const WORLD_GRID_M = 8;

export function toWorldOf(m: FactoryMapPlacement, local: Vec2): Vec2 {
  return add(rotate(local, m.rotationDeg), { x: m.x, y: m.y });
}

export function toLocalOf(m: FactoryMapPlacement, world: Vec2): Vec2 {
  return rotate({ x: world.x - m.x, y: world.y - m.y }, -m.rotationDeg);
}

export interface FactoryFootprint {
  /** Umrisse in lokalen Koordinaten der Fabrik. */
  polygons: Vec2[][];
  rect: Rect;
  /**
   * `areas`: aus Bau- und Fundamentflächen; `buildings`: aus den platzierten
   * Gebäuden geschätzt; `estimate`: Blackbox, Fläche aus den Maschinen der
   * Produktionspläne geschätzt; `none`: Platzhalter (32 × 32 m um den Ursprung).
   */
  source: 'areas' | 'buildings' | 'estimate' | 'none';
}

/** Grundriss einer Fabrik für die Karte (alle Stockwerke übereinander). */
export function factoryFootprint(p: Project, gd: GameDataIndex, factoryId: string): FactoryFootprint {
  const areas = Object.values(p.areas).filter((a) => a.factoryId === factoryId && a.kind !== 'clearance');
  if (areas.length) {
    const polygons = areas.map((a) => a.polygon.map((q) => ({ x: q.x, y: q.y })));
    return { polygons, rect: rectOf(polygons.flat()), source: 'areas' };
  }
  const pts: Vec2[] = [];
  for (const b of Object.values(p.buildings)) {
    if (b.factoryId !== factoryId || !isPlaced(b)) continue;
    const def = gd.building(b.type);
    if (def) pts.push(...buildingOutline(def, b.placement));
  }
  if (pts.length) {
    const r = rectOf(pts);
    const m = 4;
    const rect = { minX: r.minX - m, minY: r.minY - m, maxX: r.maxX + m, maxY: r.maxY + m };
    return { polygons: [rectPolygon(rect)], rect, source: 'buildings' };
  }
  if (p.factories[factoryId]?.blackbox) {
    const side = blackboxSideM(p, gd, factoryId);
    if (side > 0) {
      const rect = { minX: -side / 2, minY: -side / 2, maxX: side / 2, maxY: side / 2 };
      return { polygons: [rectPolygon(rect)], rect, source: 'estimate' };
    }
  }
  const rect = { minX: -16, minY: -16, maxX: 16, maxY: 16 };
  return { polygons: [rectPolygon(rect)], rect, source: 'none' };
}

/** Faktor Grundfläche der Maschinen → Fabrikfläche (Leitungen, Splitter, Wege). Planungsannahme. */
export const BLACKBOX_AREA_FACTOR = 3;

/**
 * Geschätzte Seitenlänge einer Blackbox-Fabrik (Quadrat, 8-m-Raster): Summe
 * der Maschinengrundflächen aus den Produktionsplänen × BLACKBOX_AREA_FACTOR.
 */
export function blackboxSideM(p: Project, gd: GameDataIndex, factoryId: string): number {
  let area = 0;
  for (const plan of Object.values(p.productionPlans)) {
    if (plan.factoryId !== factoryId) continue;
    for (const r of solveProduction(gd, plan).recipes) {
      const b = gd.building(r.building)?.bounds;
      if (b) area += r.machinesCeil * (b.maxX - b.minX + 2) * (b.maxY - b.minY + 2);
    }
  }
  return area > 0 ? Math.ceil(Math.sqrt(area * BLACKBOX_AREA_FACTOR) / 8) * 8 : 0;
}

const rectPolygon = (r: Rect): Vec2[] => [
  { x: r.minX, y: r.minY },
  { x: r.maxX, y: r.minY },
  { x: r.maxX, y: r.maxY },
  { x: r.minX, y: r.maxY },
];

/**
 * Bezugspunkt für den Weltraster im Grundriss: Ecke der Fundamentfläche mit
 * der kleinsten Ecke (x, dann y); ohne Fundamentfläche der Ursprung.
 */
export function gridAnchor(p: Project, factoryId: string): Vec2 {
  let best: Vec2 | null = null;
  for (const a of Object.values(p.areas)) {
    if (a.factoryId !== factoryId || a.kind !== 'foundation') continue;
    const r = rectOf(a.polygon);
    if (!best || r.minX < best.x - 1e-9 || (Math.abs(r.minX - best.x) < 1e-9 && r.minY < best.y)) best = { x: r.minX, y: r.minY };
  }
  return best ?? { x: 0, y: 0 };
}

/**
 * Standort so verschieben, dass der Bezugspunkt der Fabrik auf einem
 * Rasterpunkt des Weltrasters liegt. Bei Drehungen in Himmelsrichtungen
 * liegen damit alle im 8-m-Raster gezeichneten Fundamente auf dem Weltraster.
 */
export function snapToWorldGrid(p: Project, factoryId: string, m: FactoryMapPlacement): FactoryMapPlacement {
  const anchor = rotate(gridAnchor(p, factoryId), m.rotationDeg);
  const w = add(anchor, { x: m.x, y: m.y });
  const snapped = { x: snap(w.x, WORLD_GRID_M), y: snap(w.y, WORLD_GRID_M) };
  const o = sub(snapped, anchor);
  // Rundungsrauschen (z. B. 0,1 + 0,2) vermeiden
  const r = (v: number) => Math.round(v * 1e6) / 1e6;
  return { x: r(o.x), y: r(o.y), rotationDeg: m.rotationDeg };
}

/** Umrisse der Fabrik in Weltkoordinaten; `null`, wenn nicht platziert. */
export function factoryWorldOutline(p: Project, gd: GameDataIndex, factoryId: string): Vec2[][] | null {
  const f = p.factories[factoryId];
  if (!f?.map) return null;
  const m = f.map;
  return factoryFootprint(p, gd, factoryId).polygons.map((poly) => poly.map((q) => toWorldOf(m, q)));
}

/** Konvexe Hülle aller Umrisse in Weltkoordinaten (für Überschneidungen). */
export function factoryWorldHull(p: Project, gd: GameDataIndex, factoryId: string): Vec2[] | null {
  const o = factoryWorldOutline(p, gd, factoryId);
  return o ? convexHull(o.flat()) : null;
}

/** Mitte des Grundrisses in Weltkoordinaten. */
export function factoryWorldCenter(p: Project, gd: GameDataIndex, factoryId: string): Vec2 | null {
  const f = p.factories[factoryId];
  if (!f?.map) return null;
  const r = factoryFootprint(p, gd, factoryId).rect;
  return toWorldOf(f.map, { x: (r.minX + r.maxX) / 2, y: (r.minY + r.maxY) / 2 });
}

/** Weltlage eines platzierten Gebäudes (Ursprung); `null` ohne Kartenstandort. */
export function buildingWorldPosition(p: Project, b: Building): Vec2 | null {
  const m = p.factories[b.factoryId]?.map;
  if (!m || !b.placement) return null;
  return toWorldOf(m, { x: b.placement.x, y: b.placement.y });
}

export function isOnMap(f: Factory | undefined): f is Factory & { map: FactoryMapPlacement } {
  return !!f?.map;
}

// ---------------------------------------------------------------------------
// Vorkommen
// ---------------------------------------------------------------------------

/** Gebäude je verknüpftem Vorkommen. */
export function nodeUsage(p: Project): Map<string, string[]> {
  const m = new Map<string, string[]>();
  for (const b of Object.values(p.buildings)) {
    const id = b.extraction?.nodeId;
    if (id) m.set(id, [...(m.get(id) ?? []), b.id]);
  }
  return m;
}

/**
 * Kann ein Gebäudetyp auf diesem Vorkommen stehen? Miner und Ölpumpe auf
 * Nodes, Quellenextraktoren auf Satelliten einer Quelle. Quellenmitten
 * (Kompressor) und Geysire (Geothermie) fördern keinen Rohstoff und werden
 * nicht verknüpft.
 */
export function canUseNode(gd: GameDataIndex, type: string, node: MapNode): boolean {
  const def = gd.building(type);
  const ex = def?.extractor;
  if (!ex || !node.itemId || !node.purity) return false;
  if (node.kind === 'node' && def.nativeClass !== 'FGBuildableResourceExtractor') return false;
  if (node.kind === 'well' && def.nativeClass !== 'FGBuildableFrackingExtractor') return false;
  if (node.kind !== 'node' && node.kind !== 'well') return false;
  const item = gd.item(node.itemId);
  if (!item) return false;
  return ex.allowedResources.length ? ex.allowedResources.includes(node.itemId) : ex.allowedForms.includes(item.form);
}

/** Gebäudetypen, die das Vorkommen nutzen können (aufsteigend nach Förderrate). */
export function nodeExtractorTypes(gd: GameDataIndex, node: MapNode): string[] {
  return Object.values(gd.data.buildings)
    .filter((b) => canUseNode(gd, b.id, node))
    .map((b) => ({ id: b.id, rate: nodeRate(gd, node, b.id, 1) }))
    .sort((a, b) => a.rate - b.rate)
    .map((x) => x.id);
}

/** Förderrate eines Gebäudes auf dem Vorkommen pro Minute (0, wenn es nicht passt). */
export function nodeRate(gd: GameDataIndex, node: MapNode, type: string, clock = 1): number {
  const def = gd.building(type);
  if (!def || !canUseNode(gd, type, node)) return 0;
  return extractionRate(gd, def, { itemId: node.itemId!, purity: node.purity! }, clock);
}

export interface NodeDistance {
  node: MapNode;
  distM: number;
}

/** Vorkommen um einen Weltpunkt, nach Entfernung sortiert. */
export function nodesNear(gd: GameDataIndex, pt: Vec2, opts: { maxDistM?: number; filter?: (n: MapNode) => boolean } = {}): NodeDistance[] {
  const max = opts.maxDistM ?? Infinity;
  const out: NodeDistance[] = [];
  for (const n of gd.map?.nodes ?? []) {
    if (opts.filter && !opts.filter(n)) continue;
    const d = dist(pt, n);
    if (d <= max) out.push({ node: n, distM: d });
  }
  return out.sort((a, b) => a.distM - b.distM);
}

/** Vorkommen, auf die ein Gebäudetyp in einer platzierten Fabrik gesetzt werden kann. */
export function nodesForBuilding(p: Project, gd: GameDataIndex, b: Building, maxDistM = 1000): NodeDistance[] {
  const pos = buildingWorldPosition(p, b);
  const filter = (n: MapNode) => canUseNode(gd, b.type, n);
  if (pos) return nodesNear(gd, pos, { maxDistM, filter });
  return (gd.map?.nodes ?? []).filter(filter).map((node) => ({ node, distM: NaN }));
}

// ---------------------------------------------------------------------------
// Entfernungen für Transportaufträge
// ---------------------------------------------------------------------------

export interface MapDistance {
  distM: number;
  from: Vec2;
  to: Vec2;
  /** `ports`: zwischen den Übergabegebäuden; `factories`: zwischen den Fabrikmitten. */
  basis: 'ports' | 'factories';
}

function transferPoint(p: Project, gd: GameDataIndex, factoryId: string, kind: 'vehicle' | 'drone', mode: 'load' | 'unload'): Vec2 | null {
  const candidates = Object.values(p.buildings).filter((b) => b.factoryId === factoryId && b.placement && transferInterface(gd.building(b.type)) === kind);
  const best = candidates.find((b) => b.transfer?.mode === mode) ?? candidates[0];
  return best ? buildingWorldPosition(p, best) : null;
}

/**
 * Luftlinie zwischen Absender und Empfänger laut Karte: zwischen Drohnenhäfen
 * bzw. Lkw-Stationen bzw. den Übergabeanschlüssen direkter Leitungen, sonst
 * zwischen den Fabrikmitten. `null`, wenn eine Fabrik nicht platziert ist.
 */
export function orderMapDistance(p: Project, gd: GameDataIndex, order: Pick<TransportOrder, 'fromFactoryId' | 'toFactoryId' | 'mode' | 'direct'>): MapDistance | null {
  const a = factoryWorldCenter(p, gd, order.fromFactoryId);
  const b = factoryWorldCenter(p, gd, order.toFactoryId);
  if (!a || !b) return null;
  let from: Vec2 | null = null;
  let to: Vec2 | null = null;
  if (order.mode === 'drone' || order.mode === 'vehicle') {
    from = transferPoint(p, gd, order.fromFactoryId, order.mode, 'load');
    to = transferPoint(p, gd, order.toFactoryId, order.mode, 'unload');
  } else if ((order.mode === 'belt' || order.mode === 'pipe') && order.direct) {
    const fb = order.direct.from ? p.buildings[order.direct.from.buildingId] : undefined;
    const tb = order.direct.to ? p.buildings[order.direct.to.buildingId] : undefined;
    from = fb ? buildingWorldPosition(p, fb) : null;
    to = tb ? buildingWorldPosition(p, tb) : null;
  }
  if (from && to) return { distM: dist(from, to), from, to, basis: 'ports' };
  return { distM: dist(a, b), from: a, to: b, basis: 'factories' };
}

/** Liegt der Punkt im spielbaren Bereich der Karte? */
export function insideWorld(gd: GameDataIndex, pt: Vec2): boolean {
  const w = gd.map?.world;
  if (!w) return true;
  return pt.x >= w.west && pt.x <= w.east && pt.y >= w.north && pt.y <= w.south;
}
