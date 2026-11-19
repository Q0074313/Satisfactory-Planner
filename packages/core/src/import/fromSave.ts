/**
 * Projekt aus einem Spielstand-Auszug (`SaveExtract`) aufbauen.
 *
 * 1. `groupSave`: Gebäude mit Anschlüssen werden zu Fabriken gruppiert –
 *    über Band- bzw. Rohrverbindungen (bis `maxLinkM` Länge) und Nähe
 *    (Abstand der Umrisse bis `gapM`). Gruppen ohne Maschine, Gewinnung,
 *    Kraftwerk oder Lager entfallen. Die Oberfläche zeigt den Vorschlag und
 *    lässt Gruppen zusammenlegen, umbenennen oder weglassen.
 * 2. `projectFromSave`: je Gruppe eine Fabrik auf der Karte (Ursprung auf dem
 *    Weltraster), Stockwerke aus den Höhen der Gebäude, Gebäude mit Rezept,
 *    Takt, Somersloops und Vorkommen, Bänder und Rohre als Leitungen mit dem
 *    Verlauf aus dem Spielstand; optional das Schienennetz (Gleise, Weichen,
 *    Signale, Bahnhöfe, Züge, Fahrpläne) und je Fabrik ein Produktionsplan,
 *    der ihre Maschinen nachbildet. Der Spielfortschritt (gekaufte
 *    Schaltpläne) wird übernommen.
 */
import type { GameDataIndex, GdBuilding } from '../gamedata/index.ts';
import { dot, normalize, normalizeDeg, rectOf, rotate, scale, sub, type Rect, type Vec2 } from '../geometry/index.ts';
import { tr } from '../i18n/index.ts';
import { WORLD_GRID_M, WORLD_GRID_OFFSET_M } from '../map/index.ts';
import { newId } from '../model/ids.ts';
import type { NodeSide, Platform, PortRef, ProductionPlan, Project, Purity, RailNode, Vec3 } from '../model/schema.ts';
import { machineRates } from '../production/machine.ts';
import { createProject, makeFactory } from '../project/create.ts';
import { addArea, addBuilding, addLink, DEFAULT_FLOOR_HEIGHT_M } from '../project/ops/factory.ts';
import { addOrder } from '../project/ops/transport.ts';
import { outputPortAssignment } from '../factory/flow.ts';
import { PLATFORM_LENGTH_M } from '../project/ops/rail.ts';
import { PLATFORM_BUILDING, STATION_BUILDING, syncStations } from '../project/ops/stationSync.ts';
import { portDefs, portId, worldPorts, type WorldPort } from '../factory/ports.ts';
import { PORT_STUB_M } from '../factory/linkPath.ts';
import { buildingHeight, buildingOutline, canBeVertical, transferInterface } from '../factory/geometry.ts';
import type { SaveBuilding, SaveConveyor, SaveExtract, SaveRef } from './saveTypes.ts';

export interface SaveGroupOptions {
  /** Höchster Abstand der Umrisse, damit Gebäude zur selben Fabrik zählen (m). */
  gapM: number;
  /** Längere Band- bzw. Rohrverbindungen verbinden keine Fabriken (m). */
  maxLinkM: number;
  /** Nähe zählt nur bei höchstens diesem Höhenunterschied (m): übereinander gebaute Fabriken bleiben getrennt. */
  maxDzM: number;
}

export const SAVE_GROUP_DEFAULTS: SaveGroupOptions = { gapM: 16, maxLinkM: 150, maxDzM: 6 };

export interface SaveGroup {
  key: string;
  name: string;
  buildingIds: string[];
  center: Vec2;
  rect: Rect;
  counts: { buildings: number; machines: number; extractors: number; generators: number; storage: number };
  /** Endprodukte (Überschuss der Maschinen), wertvollste zuerst. */
  products: string[];
  /** Umrisse der Gebäude (für die Kartenansicht). */
  shapes: Rect[];
  /** Vorschlag: Aufteilung nach Produktionsketten (mindestens zwei Teile). */
  split?: SaveGroup[];
}

export interface SaveGrouping {
  groups: SaveGroup[];
  /** Gebäude ohne Gruppe (z. B. einzelne Splitter, Werkbänke). */
  ungrouped: number;
  /** Band- bzw. Rohrverbindungen länger als `maxLinkM`. */
  longLinks: number;
}

const EPS = 1e-6;
const isStationPart = (type: string) => type === STATION_BUILDING || Object.values(PLATFORM_BUILDING).includes(type);

const SMART_LIFT = 'Build_ConveyorAttachmentSplitterSmartLift_C';
const SMART = 'Build_ConveyorAttachmentSplitterSmart_C';

/**
 * Auszug für den Planer vereinheitlichen: Den Smart-Splitter am Förderlift
 * kennen die Spieldaten nicht; er wird als Smart-Splitter übernommen
 * (ankommender Lift = Eingang, weiterführender Lift = mittlerer Ausgang,
 * Seitenausgänge außen).
 */
function normalizeExtract(ex: SaveExtract): SaveExtract {
  if (!ex.buildings.some((b) => b.type === SMART_LIFT)) return ex;
  const buildings = ex.buildings.map((b) => {
    if (b.type !== SMART_LIFT) return b;
    const top = b.conns.TopConnection ?? null;
    const bottom = b.conns.BottomConnection ?? null;
    // Lift-Ende 1 (ConveyorAny1) ist der Ausgang des Lifts, also der Zulauf des Splitters
    const incoming = top && /1$/.test(top.comp) ? top : bottom;
    const onward = incoming === top ? bottom : top;
    const conns: Record<string, SaveRef | null> = { Input1: incoming, Output2: onward, Output1: b.conns.Output1 ?? null, Output3: b.conns.Output2 ?? null };
    return { ...b, type: SMART, conns };
  });
  // Gegenstellen der Lifte zeigen auf die neuen Komponentennamen
  const renamed = new Map<string, string>();
  for (const b of buildings) {
    const orig = ex.buildings.find((x) => x.id === b.id)!;
    if (orig.type !== SMART_LIFT) continue;
    for (const [comp, r] of Object.entries(b.conns)) {
      const old = Object.entries(orig.conns).find(([, x]) => x && r && x.id === r.id && x.comp === r.comp)?.[0];
      if (old) renamed.set(`${b.id}|${old}`, comp);
    }
  }
  const conveyors = ex.conveyors.map((c) => ({
    ...c,
    conns: c.conns.map((r) => (r && renamed.has(`${r.id}|${r.comp}`) ? { id: r.id, comp: renamed.get(`${r.id}|${r.comp}`)! } : r)) as [SaveRef | null, SaveRef | null],
  }));
  return { ...ex, buildings, conveyors };
}

/** Gebäude, die der Planer übernimmt: bekannt und mit Band- bzw. Rohranschlüssen (plus Bahnhöfe). */
function usable(gd: GameDataIndex, b: SaveBuilding): GdBuilding | null {
  const def = gd.building(b.type);
  if (!def || def.conveyor || def.pipe) return null;
  if (isStationPart(b.type)) return def;
  const c = def.ports;
  return c && c.beltIn + c.beltOut + c.pipeIn + c.pipeOut + c.pipeAny > 0 ? def : null;
}

function worldRect(def: GdBuilding, b: SaveBuilding): Rect {
  return rectOf(buildingOutline(def, { x: b.x, y: b.y, rotationDeg: b.yawDeg, ...(b.vertical && canBeVertical(def) ? { vertical: b.vertical } : {}) }));
}

/**
 * Unterkante eines Gebäudes im Spiel: Senkrechte Pumpen stehen im Spiel mit
 * ihrem Ursprung auf der Längsachse (lokal x von `minX` bis `maxX`), im Planer
 * mit der Unterkante auf der Höhe.
 */
function baseZ(def: GdBuilding, b: SaveBuilding): number {
  const bounds = def.bounds;
  if (!b.vertical || !canBeVertical(def) || !bounds) return b.z;
  return b.vertical === 'up' ? b.z + bounds.minX : b.z - bounds.maxX;
}

/** Bandkette von einem Gebäudeanschluss bis zum nächsten Gebäude. */
interface Chain {
  from: SaveRef;
  to: SaveRef;
  kind: 'belt' | 'pipe';
  points: Vec3[];
  types: string[];
  lengthM: number;
}

const endIndex = (comp: string) => (/1$/.test(comp) ? 1 : 0);

function traceChains(ex: SaveExtract, isBuilding: (id: string) => boolean): Chain[] {
  const conv = new Map(ex.conveyors.map((c) => [c.id, c]));
  const seen = new Set<string>();
  const chains: Chain[] = [];
  for (const b of ex.buildings) {
    if (!isBuilding(b.id)) continue;
    for (const [comp, ref] of Object.entries(b.conns)) {
      if (!ref || !conv.has(ref.id) || seen.has(ref.id)) continue;
      const points: Vec3[] = [{ x: b.x, y: b.y, z: b.z }];
      const types: string[] = [];
      let cur: SaveConveyor | undefined = conv.get(ref.id);
      let entered = endIndex(ref.comp);
      let to: SaveRef | null = null;
      let kind: 'belt' | 'pipe' = cur!.kind;
      while (cur && !seen.has(cur.id)) {
        seen.add(cur.id);
        types.push(cur.type);
        kind = cur.kind;
        // Ausrichtung: Ende, an dem die Kette ankommt, zuerst (bei Liften nach Lage)
        const last = points.at(-1)!;
        const d = (q: Vec3) => Math.hypot(q.x - last.x, q.y - last.y, q.z - last.z);
        const pts = cur.lift ? (d(cur.ends[0]) <= d(cur.ends[1]) ? cur.points : [...cur.points].reverse()) : entered === 0 ? cur.points : [...cur.points].reverse();
        for (const q of pts) if (d(q) > 0.05 || points.length === 1) points.push(q);
        const next = cur.conns[1 - entered];
        if (!next) break;
        if (conv.has(next.id)) {
          entered = endIndex(next.comp);
          cur = conv.get(next.id);
          continue;
        }
        to = next;
        break;
      }
      if (!to || !isBuilding(to.id)) continue;
      const tb = ex.buildings.find((x) => x.id === to!.id);
      if (tb) points.push({ x: tb.x, y: tb.y, z: tb.z });
      let len = 0;
      for (let i = 1; i < points.length; i++) len += Math.hypot(points[i]!.x - points[i - 1]!.x, points[i]!.y - points[i - 1]!.y);
      // Erster und letzter Punkt sind die Gebäudeursprünge (nur für die Länge)
      chains.push({ from: { id: b.id, comp }, to, kind, points: points.slice(1, -1), types, lengthM: len });
    }
  }
  return chains;
}

/** Gruppen mit mindestens einem dieser Gebäude bleiben erhalten. */
const ANCHOR = new Set(['production', 'extraction', 'power', 'storage']);
/** Kern einer Fabrik: Maschinen, Gewinnung, Kraftwerke. */
const CORE = new Set(['production', 'extraction', 'power']);

/**
 * Rolle beim Gruppieren: Maschinen (`core`) bilden Fabriken; Splitter,
 * Zusammenführungen, Rohrkreuzungen, Pumpen und Ventile (`logistics`) leiten
 * nur weiter; Lager, Bahnhöfe, Lkw-Stationen, Senke u. Ä. (`attach`) sind
 * Schnittstellen und verbinden keine Fabriken, sie gehören zur nächsten.
 */
function roleOf(def: GdBuilding): 'core' | 'logistics' | 'attach' {
  if (CORE.has(def.category)) return 'core';
  return def.category === 'logistics' ? 'logistics' : 'attach';
}

/** Höhe eines Fundaments laut Spieldaten (sonst aus dem Klassennamen, z. B. 8x2 → 2 m). */
const foundationHeight = (gd: GameDataIndex, type: string) => gd.building(type)?.foundation?.heightM ?? Number(/8x(\d)/.exec(type)?.[1] ?? 1);

/**
 * Zusammenhängende Fundamentflächen: Fundamente mit höchstens 8,6 m Abstand
 * der Mitten (Nachbarn im 8-m-Raster, auch gedreht) und gleicher Oberkante
 * (±1 m). Liefert zu einem Gebäude die Fläche, auf der es steht (`null` = Gelände).
 */
function foundationIslands(gd: GameDataIndex, list: SaveExtract['foundations']): (b: { x: number; y: number; z: number }) => number | null {
  const fds = (list ?? []).map((f) => ({ x: f.x, y: f.y, top: f.z + foundationHeight(gd, f.type) / 2 }));
  if (!fds.length) return () => null;
  const parent = fds.map((_, i) => i);
  const find = (i: number): number => (parent[i] === i ? i : (parent[i] = find(parent[i]!)));
  const cell = 8;
  const grid = new Map<string, number[]>();
  fds.forEach((f, i) => {
    const k = `${Math.floor(f.x / cell)},${Math.floor(f.y / cell)}`;
    grid.set(k, [...(grid.get(k) ?? []), i]);
  });
  const near = (x: number, y: number, r: number, fn: (j: number) => void) => {
    for (let gx = Math.floor((x - r) / cell); gx <= Math.floor((x + r) / cell); gx++)
      for (let gy = Math.floor((y - r) / cell); gy <= Math.floor((y + r) / cell); gy++) for (const j of grid.get(`${gx},${gy}`) ?? []) fn(j);
  };
  fds.forEach((f, i) =>
    near(f.x, f.y, 8.6, (j) => {
      const g = fds[j]!;
      if (j !== i && Math.hypot(g.x - f.x, g.y - f.y) <= 8.6 && Math.abs(g.top - f.top) <= 1) {
        const a = find(i);
        const b = find(j);
        if (a !== b) parent[a] = b;
      }
    }),
  );
  return (b) => {
    let best: { d: number; i: number } | null = null;
    near(b.x, b.y, 5.7, (j) => {
      const f = fds[j]!;
      const d = Math.hypot(f.x - b.x, f.y - b.y);
      if (d <= 5.7 && b.z - f.top > -1 && b.z - f.top < 1.5 && (!best || d < best.d)) best = { d, i: j };
    });
    return best ? find((best as { i: number }).i) : null;
  };
}

/** Kleinster Abstand zweier Rechtecke (0 bei Überlappung). */
function rectGap(a: Rect, b: Rect): number {
  const gx = Math.max(0, Math.max(a.minX, b.minX) - Math.min(a.maxX, b.maxX));
  const gy = Math.max(0, Math.max(a.minY, b.minY) - Math.min(a.maxY, b.maxY));
  return Math.hypot(gx, gy);
}

/** Kürzeste Wege (Dijkstra) ab mehreren Startpunkten bis `radius`; `pass` entscheidet, über welche Knoten es weitergeht. */
function shortestPaths(
  adj: { to: number; len: number }[][],
  starts: { node: number; label: number }[],
  radius: number,
  pass: (node: number) => boolean,
): Map<number, { dist: number; label: number }> {
  const best = new Map<number, { dist: number; label: number }>();
  const heap: [number, number, number][] = [];
  const push = (e: [number, number, number]) => {
    heap.push(e);
    for (let i = heap.length - 1; i > 0; ) {
      const p = (i - 1) >> 1;
      if (heap[p]![0] <= heap[i]![0]) break;
      [heap[p], heap[i]] = [heap[i]!, heap[p]!];
      i = p;
    }
  };
  const pop = (): [number, number, number] => {
    const top = heap[0]!;
    const last = heap.pop()!;
    if (heap.length) {
      heap[0] = last;
      for (let i = 0; ; ) {
        const l = 2 * i + 1;
        const r = l + 1;
        let m = i;
        if (l < heap.length && heap[l]![0] < heap[m]![0]) m = l;
        if (r < heap.length && heap[r]![0] < heap[m]![0]) m = r;
        if (m === i) break;
        [heap[m], heap[i]] = [heap[i]!, heap[m]!];
        i = m;
      }
    }
    return top;
  };
  for (const s of starts) push([0, s.node, s.label]);
  const startSet = new Set(starts.map((s) => s.node));
  while (heap.length) {
    const [d, n, label] = pop();
    if (best.has(n)) continue;
    best.set(n, { dist: d, label });
    if (!startSet.has(n) && !pass(n)) continue;
    for (const e of adj[n]!) if (!best.has(e.to) && d + e.len <= radius) push([d + e.len, e.to, label]);
  }
  return best;
}

/**
 * Gemeinschaften eines gewichteten Graphen (Louvain: Knoten wandern zur
 * Nachbargruppe mit dem größten Modularitätsgewinn, dann werden Gruppen zu
 * Knoten zusammengefasst). Liefert je Knoten die Nummer seiner Gemeinschaft.
 */
export function louvain(n: number, edges: [number, number, number][]): number[] {
  let comm = Array.from({ length: n }, (_, i) => i);
  let size = n;
  let list = edges;
  for (let level = 0; level < 12; level++) {
    const adj = Array.from({ length: size }, () => new Map<number, number>());
    const k = new Array<number>(size).fill(0);
    let m2 = 0;
    for (const [a, b, w] of list) {
      if (a !== b) {
        adj[a]!.set(b, (adj[a]!.get(b) ?? 0) + w);
        adj[b]!.set(a, (adj[b]!.get(a) ?? 0) + w);
      }
      k[a]! += w;
      k[b]! += w;
      m2 += 2 * w;
    }
    if (m2 === 0) break;
    const c = Array.from({ length: size }, (_, i) => i);
    const tot = [...k];
    let any = false;
    for (let pass = 0, moved = true; moved && pass < 50; pass++) {
      moved = false;
      for (let i = 0; i < size; i++) {
        const ci = c[i]!;
        const links = new Map<number, number>();
        for (const [j, w] of adj[i]!) links.set(c[j]!, (links.get(c[j]!) ?? 0) + w);
        tot[ci]! -= k[i]!;
        let target = ci;
        let gain = (links.get(ci) ?? 0) - (tot[ci]! * k[i]!) / m2;
        for (const [cj, w] of links) {
          const g = w - (tot[cj]! * k[i]!) / m2;
          if (g > gain + 1e-9) {
            gain = g;
            target = cj;
          }
        }
        tot[target]! += k[i]!;
        if (target !== ci) {
          c[i] = target;
          moved = true;
          any = true;
        }
      }
    }
    if (!any) break;
    const ids = new Map<number, number>();
    for (const x of c) if (!ids.has(x)) ids.set(x, ids.size);
    comm = comm.map((x) => ids.get(c[x]!)!);
    const agg = new Map<string, number>();
    for (const [a, b, w] of list) {
      const ca = ids.get(c[a]!)!;
      const cb = ids.get(c[b]!)!;
      const key = ca < cb ? `${ca},${cb}` : `${cb},${ca}`;
      agg.set(key, (agg.get(key) ?? 0) + w);
    }
    list = [...agg].map(([key, w]) => {
      const [a, b] = key.split(',').map(Number) as [number, number];
      return [a, b, w];
    });
    size = ids.size;
  }
  return comm;
}

export function groupSave(raw: SaveExtract, gd: GameDataIndex, opts: Partial<SaveGroupOptions> = {}): SaveGrouping {
  const o = { ...SAVE_GROUP_DEFAULTS, ...opts };
  const ex = normalizeExtract(raw);
  const defs = new Map<string, GdBuilding>();
  for (const b of ex.buildings) {
    const def = usable(gd, b);
    if (def) defs.set(b.id, def);
  }
  const list = ex.buildings.filter((b) => defs.has(b.id));
  const index = new Map(list.map((b, i) => [b.id, i]));
  const role = list.map((b) => roleOf(defs.get(b.id)!));
  const rects = list.map((b) => worldRect(defs.get(b.id)!, b));

  // Graph: Band- bzw. Rohrketten (Länge) und Bahnsteige (Länge 0)
  const adj: { to: number; len: number }[][] = list.map(() => []);
  const chains = traceChains(ex, (id) => index.has(id));
  for (const c of chains) {
    const a = index.get(c.from.id)!;
    const b = index.get(c.to.id)!;
    adj[a]!.push({ to: b, len: c.lengthM });
    adj[b]!.push({ to: a, len: c.lengthM });
  }
  for (const b of list)
    for (const r of Object.values(b.platformConns))
      if (r && index.has(r.id)) {
        adj[index.get(b.id)!]!.push({ to: index.get(r.id)!, len: 0 });
        adj[index.get(r.id)!]!.push({ to: index.get(b.id)!, len: 0 });
      }

  const parent = list.map((_, i) => i);
  const find = (i: number): number => (parent[i] === i ? i : (parent[i] = find(parent[i]!)));
  const union = (a: number, b: number) => {
    const ra = find(a);
    const rb = find(b);
    if (ra !== rb) parent[ra] = rb;
  };
  const cores = list.map((_, i) => i).filter((i) => role[i] === 'core');

  // 1. Maschinen über Wege durch Splitter, Zusammenführungen, Rohrkreuzungen (insgesamt bis maxLinkM); längere Wege sind Verbindungen zwischen Fabriken
  for (const i of cores)
    for (const [j] of shortestPaths(adj, [{ node: i, label: i }], o.maxLinkM, (n) => role[n] === 'logistics')) if (j !== i && role[j] === 'core') union(i, j);

  // Nähe (Raster für die Suche)
  const cell = 64;
  const nearby = (idx: number[], fn: (i: number, j: number) => void) => {
    const grid = new Map<string, number[]>();
    for (const i of idx) {
      const r = rects[i]!;
      for (let gx = Math.floor((r.minX - o.gapM) / cell); gx <= Math.floor((r.maxX + o.gapM) / cell); gx++)
        for (let gy = Math.floor((r.minY - o.gapM) / cell); gy <= Math.floor((r.maxY + o.gapM) / cell); gy++) {
          const k = `${gx},${gy}`;
          const cellList = grid.get(k) ?? [];
          for (const j of cellList) if (rectGap(rects[j]!, r) <= o.gapM && Math.abs(list[i]!.z - list[j]!.z) < o.maxDzM) fn(i, j);
          cellList.push(i);
          grid.set(k, cellList);
        }
    }
  };
  // 2. Maschinen nah beieinander, außer sie stehen auf getrennten Fundamentflächen
  const island = foundationIslands(gd, ex.foundations);
  const islandOf = list.map((b, i) => (role[i] === 'core' ? island(b) : null));
  nearby(cores, (i, j) => {
    const a = islandOf[i];
    const b = islandOf[j];
    if (a === null || a === undefined || b === null || b === undefined || a === b) union(i, j);
  });

  // 3. Übrige Gebäude zur Fabrik mit dem kürzesten Weg (Lager und Bahnhöfe werden durchlaufen, verbinden aber keine Fabriken)
  const label = list.map((_, i) => (role[i] === 'core' ? find(i) : -1));
  for (const [n, r] of shortestPaths(
    adj,
    cores.map((i) => ({ node: i, label: find(i) })),
    o.maxLinkM,
    (n) => role[n] !== 'core',
  ))
    if (role[n] !== 'core') label[n] = r.label;
  // ohne Weg: nah an einem zugeordneten Gebäude
  const labeled = list.map((_, i) => i).filter((i) => label[i]! >= 0);
  const open = list.map((_, i) => i).filter((i) => label[i]! < 0);
  const nearest = new Map<number, { gap: number; label: number }>();
  nearby([...labeled, ...open], (i, j) => {
    const [u, l] = label[i]! < 0 && label[j]! >= 0 ? [i, j] : label[j]! < 0 && label[i]! >= 0 ? [j, i] : [-1, -1];
    if (u < 0) return;
    const gap = rectGap(rects[u]!, rects[l]!);
    if (!nearest.has(u) || gap < nearest.get(u)!.gap) nearest.set(u, { gap, label: label[l]! });
  });
  for (const [u, x] of nearest) label[u] = x.label;
  // Rest (z. B. ein Bahnhof mit Lager ohne Maschinen): eigene Gruppen über Verbindungen und Nähe
  const rest = list.map((_, i) => i).filter((i) => label[i]! < 0);
  const restSet = new Set(rest);
  for (const i of rest) for (const e of adj[i]!) if (restSet.has(e.to) && e.len <= o.maxLinkM) union(i, e.to);
  nearby(rest, union);
  for (const i of rest) label[i] = find(i);
  // Reste ohne Maschine und Lager (z. B. Bahnhof eines Gewinnungspostens über ein langes Band) entfielen sonst:
  // sie gehören zu der Fabrik, mit der sie über den kürzesten Weg verbunden sind (Hotfix 0.10.3)
  const restGroups = new Map<number, number[]>();
  for (const i of rest) restGroups.set(label[i]!, [...(restGroups.get(label[i]!) ?? []), i]);
  for (const idx of restGroups.values()) {
    if (idx.some((i) => ANCHOR.has(defs.get(list[i]!.id)!.category))) continue;
    const reach = shortestPaths(
      adj,
      idx.map((i) => ({ node: i, label: 0 })),
      Infinity,
      (n) => restSet.has(n),
    );
    let best: { dist: number; label: number } | null = null;
    for (const [n, r] of reach) if (!restSet.has(n) && label[n]! >= 0 && (!best || r.dist < best.dist)) best = { dist: r.dist, label: label[n]! };
    if (best) for (const i of idx) label[i] = best.label;
  }

  // 4. Gewinnungsposten (ohne Maschinen) gehören zu der Fabrik, die sie beliefern – auch über lange Bänder (Hotfix 0.9.1);
  //    lange Wege zwischen zwei Fabriken mit Maschinen bleiben Verbindungen zwischen Fabriken
  for (let round = 0, changed = true; changed && round < 4; round++) {
    changed = false;
    const producing = new Set<number>();
    list.forEach((b, i) => {
      const c = defs.get(b.id)!.category;
      if (c === 'production' || c === 'power') producing.add(label[i]!);
    });
    for (const c of chains) {
      const la = label[index.get(c.from.id)!]!;
      const lb = label[index.get(c.to.id)!]!;
      if (la === lb || producing.has(la) === producing.has(lb)) continue;
      const [from, into] = producing.has(la) ? [lb, la] : [la, lb];
      for (let i = 0; i < label.length; i++) if (label[i] === from) label[i] = into;
      changed = true;
    }
  }

  const members = new Map<number, number[]>();
  list.forEach((_, i) => members.set(label[i]!, [...(members.get(label[i]!) ?? []), i]));
  const groupOf = new Map<number, string>();
  const groups: SaveGroup[] = [];
  let ungrouped = 0;
  const names = new Map<string, number>();
  const kept: number[][] = [];
  /** Name ohne laufende Nummer (z. B. „Kraftwerk 3“ → „Kraftwerk“). */
  const baseName = (name: string) => name.replace(/ \d+$/, '');
  for (const idx of members.values()) {
    if (!idx.some((i) => ANCHOR.has(defs.get(list[i]!.id)!.category))) {
      ungrouped += idx.length;
      continue;
    }
    kept.push(idx);
  }

  /** Fabrikvorschlag aus Gebäuden (Name, Zählung, Endprodukte). */
  const describe = (idx: number[], names: Map<string, number>): SaveGroup => {
    const bs = idx.map((i) => list[i]!);
    const rect = idx.map((i) => rects[i]!).reduce((a, r) => ({ minX: Math.min(a.minX, r.minX), minY: Math.min(a.minY, r.minY), maxX: Math.max(a.maxX, r.maxX), maxY: Math.max(a.maxY, r.maxY) }));
    const counts = { buildings: bs.length, machines: 0, extractors: 0, generators: 0, storage: 0 };
    const resources = new Map<string, number>();
    for (const b of bs) {
      const def = defs.get(b.id)!;
      if (def.category === 'extraction') counts.extractors++;
      else if (def.category === 'power') counts.generators++;
      else if (def.category === 'storage') counts.storage++;
      else if (def.category === 'production') counts.machines++;
      if (def.extractor) {
        const node = b.node ? gd.mapNode(b.node) : undefined;
        const item = node?.itemId ?? (def.nativeClass === 'FGBuildableWaterPump' ? 'Desc_Water_C' : null);
        if (item) resources.set(item, (resources.get(item) ?? 0) + 1);
      }
    }
    const top = productsOf(bs);
    const res = [...resources].sort((a, b) => b[1] - a[1]).map(([id]) => id);
    let base = top[0]
      ? tr('Fabrik: {item}', { item: gd.name(top[0]) })
      : counts.generators
        ? tr('Kraftwerk')
        : res[0]
          ? tr('Gewinnung: {item}', { item: gd.name(res[0]) })
          : tr('Lager');
    const n = (names.get(base) ?? 0) + 1;
    names.set(base, n);
    if (n > 1) base = `${base} ${n}`;
    return {
      key: bs[0]!.id,
      name: base,
      buildingIds: bs.map((b) => b.id),
      center: { x: (rect.minX + rect.maxX) / 2, y: (rect.minY + rect.maxY) / 2 },
      rect,
      counts,
      products: top.slice(0, 3),
      shapes: idx.map((i) => rects[i]!),
    };
  };
  /** Endprodukte der Maschinen (Überschuss), wertvollste zuerst; ohne Überschuss die größten Mengen. */
  /** Bilanz der Maschinen: Überschuss (`net`) und Herstellung (`made`) je Gegenstand. */
  const balanceOf = (bs: SaveBuilding[]) => {
    const net = new Map<string, number>();
    const made = new Map<string, number>();
    for (const b of bs) {
      const def = defs.get(b.id)!;
      if (def.category !== 'production' || !b.recipe || !gd.recipe(b.recipe)) continue;
      const rates = machineRates(gd, { type: b.type, recipeId: b.recipe, clock: b.clock, somersloops: b.somersloops });
      for (const x of rates.outputs) {
        net.set(x.item, (net.get(x.item) ?? 0) + x.perMin);
        made.set(x.item, (made.get(x.item) ?? 0) + x.perMin);
      }
      for (const x of rates.inputs) net.set(x.item, (net.get(x.item) ?? 0) - x.perMin);
    }
    return { net, made };
  };
  const productsOf = (bs: SaveBuilding[]): string[] => {
    const { net } = balanceOf(bs);
    const value = (id: string) => gd.item(id)?.sinkPoints ?? 0;
    const finals = [...net].filter(([, v]) => v > 0.5).sort((a, b) => value(b[0]) - value(a[0]) || b[1] - a[1]).map(([id]) => id);
    return finals.length ? finals : [...net].sort((a, b) => b[1] - a[1]).map(([id]) => id);
  };

  for (const idx of kept) {
    const g = describe(idx, names);
    for (const i of idx) groupOf.set(i, g.key);
    groups.push(g);
  }
  // 4. Vorschlag: große Fabriken nach Produktionsketten teilen
  for (const [k, idx] of kept.entries()) {
    const parts = splitByChains(idx);
    if (!parts) continue;
    // Namen der Teile: nummeriert gegen die übrigen Fabriken (die geteilte entfällt)
    const others = new Map<string, number>();
    for (const g of groups) if (g !== groups[k]) others.set(baseName(g.name), Math.max(others.get(baseName(g.name)) ?? 0, Number(/ (\d+)$/.exec(g.name)?.[1] ?? 1)));
    groups[k]!.split = parts.map((p) => describe(p, others));
  }
  groups.sort((a, b) => b.counts.buildings - a.counts.buildings);
  // Verbindungen zwischen Fabriken (werden Transportaufträge)
  let longLinks = 0;
  for (const c of chains) {
    const a = groupOf.get(index.get(c.from.id)!);
    const b = groupOf.get(index.get(c.to.id)!);
    if (a && b && a !== b) longLinks++;
  }
  return { groups, ungrouped, longLinks };

  /**
   * Teilungsvorschlag nach Produktionsketten: Gemeinschaften im Leitungsgraphen
   * der Fabrik (Louvain); zu kleine Teile und Teile ohne Maschinen gehen in den
   * am stärksten verbundenen Nachbarn, ebenso Teile, deren Hauptprodukt
   * überwiegend in der Fabrik verbraucht wird; Teile mit demselben
   * Hauptprodukt (z. B. Hälften eines Kraftwerks) werden wieder vereint.
   */
  function splitByChains(idx: number[]): number[][] | null {
    const isMachine = (i: number) => {
      const c = defs.get(list[i]!.id)!.category;
      return c === 'production' || c === 'power';
    };
    const machines = idx.filter(isMachine).length;
    if (machines < SPLIT_MIN_MACHINES) return null;
    const local = new Map(idx.map((i, k) => [i, k]));
    const edges: [number, number, number][] = [];
    for (const i of idx) for (const e of adj[i]!) if (local.has(e.to) && i < e.to) edges.push([local.get(i)!, local.get(e.to)!, 1]);
    const comm = louvain(idx.length, edges);
    const parts = new Map<number, number[]>();
    idx.forEach((i, k) => parts.set(comm[k]!, [...(parts.get(comm[k]!) ?? []), i]));
    let cur = [...parts.values()];
    const minSize = Math.max(SPLIT_MIN_PART, Math.min(8, Math.ceil(machines * 0.25)));
    const whole = balanceOf(idx.map((i) => list[i]!));
    for (let round = 0; round < 100 && cur.length > 1; round++) {
      const partOf = new Map<number, number>();
      cur.forEach((p, k) => p.forEach((i) => partOf.set(i, k)));
      const weight = (a: number, b: number) => {
        let w = 0;
        for (const i of cur[a]!) for (const e of adj[i]!) if (partOf.get(e.to) === b) w++;
        return w;
      };
      const neighbours = (a: number) => {
        const s = new Set<number>();
        for (const i of cur[a]!) for (const e of adj[i]!) if (partOf.has(e.to) && partOf.get(e.to) !== a) s.add(partOf.get(e.to)!);
        return [...s];
      };
      const size = (p: number[]) => p.filter(isMachine).length;
      // Kennung je Teil: Hauptprodukt, bei reinen Kraftwerken die Generatorarten
      const top = cur.map((p) => {
        const bs = p.map((i) => list[i]!);
        const item = productsOf(bs)[0];
        if (item) return item;
        const gens = [...new Set(bs.filter((b) => defs.get(b.id)!.category === 'power').map((b) => b.type))].sort();
        return gens.length ? `power:${gens.join(',')}` : null;
      });
      // Zwischenprodukt: das Hauptprodukt bleibt überwiegend in der Fabrik → gehört zur Kette, die es verbraucht
      const intermediate = (k: number) => {
        const item = top[k];
        if (!item || item.startsWith('power:')) return false;
        const made = balanceOf(cur[k]!.map((i) => list[i]!)).made.get(item) ?? 0;
        return made > 0 && (whole.net.get(item) ?? 0) < made * 0.5;
      };
      const strongest = (from: number) => {
        const ns = neighbours(from);
        return ns.length ? ns.reduce((a, b) => (weight(from, b) > weight(from, a) ? b : a)) : cur.reduce((a, p, k) => (k !== from && (a < 0 || size(p) > size(cur[a]!)) ? k : a), -1);
      };
      let from = -1;
      let into = -1;
      // 1. gleiches Hauptprodukt (auch ohne Verbindung, z. B. zwei gleiche Kraftwerksblöcke)
      for (let a = 0; a < cur.length && from < 0; a++)
        for (let b = a + 1; b < cur.length; b++)
          if (top[a] && top[a] === top[b]) {
            from = a;
            into = b;
            break;
          }
      // 2. Maschinen zum Teil ihres Produkts (Louvain schneidet Ketten auch mitten durch)
      if (from < 0 && moveToProduct(cur, partOf, top)) continue;
      // 3. Teile mit Zwischenprodukten, dann zu kleine Teile (kleinster zuerst) zum stärksten Nachbarn
      if (from < 0) {
        const pick = (ok: (k: number) => boolean) =>
          cur
            .map((p, k) => ({ k, n: size(p) }))
            .filter((x) => ok(x.k))
            .sort((a, b) => a.n - b.n)[0];
        const x = pick(intermediate) ?? pick((k) => size(cur[k]!) < minSize);
        if (x) {
          from = x.k;
          into = strongest(from);
        }
      }
      if (from < 0 || into < 0) break;
      cur[into] = [...cur[into]!, ...cur[from]!];
      cur = cur.filter((_, k) => k !== from);
    }
    return cur.length > 1 ? cur : null;
  }

  /**
   * Maschinen, deren Produkt das Hauptprodukt eines angrenzenden anderen Teils
   * ist (und nicht das des eigenen), wechseln dorthin. Liefert, ob sich etwas
   * geändert hat (Teile werden an Ort und Stelle angepasst).
   */
  function moveToProduct(cur: number[][], partOf: Map<number, number>, top: (string | null)[]): boolean {
    let changed = false;
    for (let pass = 0, again = true; again && pass < 50; pass++) {
      again = false;
      for (const [i, k] of partOf) {
        const b = list[i]!;
        if (defs.get(b.id)!.category !== 'production' || !b.recipe) continue;
        const item = gd.recipe(b.recipe)?.outputs[0]?.item;
        if (!item || item === top[k]) continue;
        const target = adj[i]!.map((e) => partOf.get(e.to)).find((q) => q !== undefined && q !== k && top[q] === item);
        if (target === undefined || cur[k]!.length <= 1) continue;
        cur[k] = cur[k]!.filter((x) => x !== i);
        cur[target]!.push(i);
        partOf.set(i, target);
        again = changed = true;
      }
    }
    return changed;
  }
}

/** Teilungsvorschlag erst ab so vielen Maschinen bzw. Kraftwerken. */
const SPLIT_MIN_MACHINES = 20;
/** Kleinster Teil eines Teilungsvorschlags (Maschinen). */
const SPLIT_MIN_PART = 4;

// ---------------------------------------------------------------------------
// Projekt
// ---------------------------------------------------------------------------

export interface SaveImportOptions {
  name: string;
  datasetId: string;
  gameVersion: string;
  /** Fabriken (aus `groupSave`, ggf. zusammengelegt, umbenannt oder weggelassen). */
  groups: { name: string; buildingIds: string[] }[];
  rail: boolean;
  plans: boolean;
  now?: Date;
}

export interface SaveImportReport {
  factories: number;
  buildings: number;
  links: number;
  /** Leitungen zu Gebäuden außerhalb der übernommenen Fabriken bzw. zwischen Fabriken. */
  linksSkipped: number;
  /** Leitungen, die der Planer ablehnt (z. B. Anschluss unbekannt). */
  linksFailed: number;
  /** Transportaufträge für Bänder bzw. Rohre zwischen Fabriken. */
  orders: number;
  /** Fundamentflächen (zusammengefasste Fundamente). */
  areas: number;
  railNodes: number;
  railSegments: number;
  stations: number;
  trains: number;
  plans: number;
  notes: string[];
}

const r3 = (v: number) => Math.round(v * 1000) / 1000;
const snapGrid = (v: number) => Math.round((v - WORLD_GRID_OFFSET_M) / WORLD_GRID_M) * WORLD_GRID_M + WORLD_GRID_OFFSET_M;

/** Sonderklassen der Splitterfilter → Regel im Planer. */
const SORT_SPECIAL: Record<string, string> = { Desc_Wildcard_C: 'any', Desc_None_C: 'none', Desc_Overflow_C: 'overflow', Desc_AnyUndefined_C: 'any-undefined' };

/**
 * Filter eines Smart- bzw. programmierbaren Splitters je Planer-Anschluss (Hotfix 0.10.3). Index 0–2 =
 * Output1–3; am Förderlift-Splitter (nach `normalizeExtract`) 0 = weiterführender Lift (Output2), 1 = Output1, 2 = Output3.
 */
function sortRulesOf(gd: GameDataIndex, def: GdBuilding, b: SaveBuilding, lift: boolean): Record<string, string[]> | null {
  if (!b.sortRules?.length) return null;
  const out: Record<string, string[]> = {};
  for (const r of b.sortRules) {
    const comp = lift ? (['Output2', 'Output1', 'Output3'][r.output] ?? null) : `Output${r.output + 1}`;
    const port = comp ? portOfComp(def, comp) : null;
    const rule = SORT_SPECIAL[r.item] ?? (gd.item(r.item) ? r.item : null);
    if (!port || !rule) continue;
    out[port] = [...(out[port] ?? []), rule];
  }
  return Object.keys(out).length ? out : null;
}

/** Planer-Anschluss-ID zu einem Komponentennamen des Spiels. */
function portOfComp(def: GdBuilding, comp: string): string | null {
  const p = def.portLayout?.find((q) => q.component === comp);
  return p ? portId(p.kind, p.direction, p.index) : null;
}

/** Band- bzw. Rohrstufe des Planers zu einem Abschnittstyp. */
function tierOf(gd: GameDataIndex, type: string): string | null {
  const t = type.replace('ConveyorLift', 'ConveyorBelt').replace('_NoIndicator', '');
  return gd.building(t) ? t : null;
}

/** Kollineare Zwischenpunkte entfernen (Abweichung unter 5 cm). */
function simplify(pts: Vec3[]): Vec3[] {
  if (pts.length < 3) return pts;
  const out = [pts[0]!];
  for (let i = 1; i < pts.length - 1; i++) {
    const a = out.at(-1)!;
    const b = pts[i]!;
    const c = pts[i + 1]!;
    const ab = { x: b.x - a.x, y: b.y - a.y, z: b.z - a.z };
    const ac = { x: c.x - a.x, y: c.y - a.y, z: c.z - a.z };
    const l = Math.hypot(ac.x, ac.y, ac.z);
    const cr = { x: ab.y * ac.z - ab.z * ac.y, y: ab.z * ac.x - ab.x * ac.z, z: ab.x * ac.y - ab.y * ac.x };
    // senkrechte Abschnitte (Lifte) bleiben erhalten
    const vertical = Math.hypot(b.x - a.x, b.y - a.y) < 0.05 || Math.hypot(c.x - b.x, c.y - b.y) < 0.05;
    if (vertical || l < EPS || Math.hypot(cr.x, cr.y, cr.z) / l > 0.05) out.push(b);
  }
  out.push(pts.at(-1)!);
  return out;
}

/**
 * Höhenstufen der Gebäude einer Fabrik: Lücken von mehr als 3 m trennen
 * Stufen (Boden = niedrigstes Gebäude, auf Millimeter abgerundet). Welche
 * Stufen eigene Stockwerke werden, entscheidet `mergeLevels`.
 */
function floorLevels(items: { z: number; h: number }[]): { z: number; height: number }[] {
  const sorted = [...items].sort((a, b) => a.z - b.z);
  const levels: { z: number; last: number; top: number }[] = [];
  for (const it of sorted) {
    const cur = levels.at(-1);
    if (cur && it.z - cur.last <= 3) {
      cur.last = it.z;
      cur.top = Math.max(cur.top, it.z + it.h);
    } else levels.push({ z: Math.floor(it.z * 1000) / 1000, last: it.z, top: it.z + it.h });
  }
  return levels.map((l, i) => {
    const next = levels[i + 1];
    const height = next ? next.z - l.z : Math.max(DEFAULT_FLOOR_HEIGHT_M.production, l.top - l.z);
    return { z: l.z, height: Math.round(Math.max(2, height) * 10) / 10 };
  });
}

/** Abstand zweier Stockwerke von Boden zu Boden (m), bis zu dem es dasselbe Stockwerk ist. */
const SAME_FLOOR_GAP_M = 10;
/** Dasselbe bei einer Logistikebene darüber bzw. darunter (m). */
const LOGISTICS_GAP_M = 4;

/**
 * Höhenstufen zu Stockwerken zusammenfassen. Eine Stufe wird nur dann ein
 * eigenes Stockwerk, wenn sie mehr als 10 m über dem Boden des Stockwerks
 * darunter liegt und überwiegend auf ihm steht: In den gemeinsamen 8-m-Zellen
 * enden Gebäude und Fundamente darunter unterhalb der Stufe. Liegt sie
 * daneben oder ragen die Gebäude darunter durch sie hindurch, ist es dasselbe
 * Stockwerk (Höhe als Versatz). Wasserextraktoren behalten ihre Ebene, außer
 * sie ist zu nah.
 */
function mergeLevels<L extends { z: number; height: number; kind: 'production' | 'logistics'; water?: boolean }>(
  levels: L[],
  items: { z: number; top: number; rect: Rect }[],
): L[] {
  if (levels.length < 2) return levels;
  const levelOf = (z: number) => {
    let k = 0;
    for (let i = 0; i < levels.length; i++) if (levels[i]!.z <= z + 0.5) k = i;
    return k;
  };
  // Je Stufe: belegte Zellen mit der höchsten Oberkante darin
  const cells = levels.map(() => new Map<string, number>());
  for (const it of items) {
    const map = cells[levelOf(it.z)]!;
    // Zellen leicht nach innen versetzt: bloßes Berühren zählt nicht
    for (let x = Math.floor((it.rect.minX + 0.5) / 8); x <= Math.floor((it.rect.maxX - 0.5) / 8); x++)
      for (let y = Math.floor((it.rect.minY + 0.5) / 8); y <= Math.floor((it.rect.maxY - 0.5) / 8); y++) {
        const k = `${x},${y}`;
        map.set(k, Math.max(map.get(k) ?? -Infinity, it.top));
      }
  }
  const out: { level: L; cells: Map<string, number>; top: number }[] = [];
  levels.forEach((lv, i) => {
    const cur = out.at(-1);
    const own = cells[i]!;
    let above = 0;
    let through = 0;
    if (cur)
      for (const k of own.keys()) {
        const below = cur.cells.get(k);
        if (below === undefined) continue;
        if (below <= lv.z + 1) above++;
        else through++;
      }
    const ownTop = Math.max(lv.z, ...own.values());
    // Logistikebenen sind niedriger: eigenes Stockwerk schon ab 4 m Abstand
    const minGap = lv.kind === 'logistics' || cur?.level.kind === 'logistics' ? LOGISTICS_GAP_M : SAME_FLOOR_GAP_M;
    const separate = !cur || (lv.z - cur.level.z > minGap && (lv.water || cur.level.water || (above > 0 && above >= through)));
    if (!separate) {
      for (const [k, v] of own) cur!.cells.set(k, Math.max(cur!.cells.get(k) ?? -Infinity, v));
      cur!.top = Math.max(cur!.top, ownTop);
      // Logistik nur, solange keine Produktion dazukommt
      if (lv.kind === 'production') cur!.level = { ...cur!.level, kind: 'production' };
      return;
    }
    out.push({ level: lv, cells: new Map(own), top: ownTop });
  });
  // Höhen: bis zum nächsten Stockwerk, beim obersten bis zum höchsten Gebäude (mindestens Standardhöhe)
  return out.map((x, i) => {
    const next = out[i + 1];
    const minH = x.level.kind === 'logistics' ? DEFAULT_FLOOR_HEIGHT_M.logistics : DEFAULT_FLOOR_HEIGHT_M.production;
    // Oberstes: bis zum höchsten Gebäude, höchstens 50 m (einzelne Gebäude am Hang mit Versatz)
    const height = next ? next.level.z - x.level.z : Math.max(minH, Math.min(50, x.top - x.level.z));
    return { ...x.level, height: Math.round(Math.max(2, height) * 10) / 10 };
  });
}

export function projectFromSave(raw: SaveExtract, gd: GameDataIndex, o: SaveImportOptions): { project: Project; report: SaveImportReport } {
  const ex = normalizeExtract(raw);
  const p = createProject({ name: o.name, datasetId: o.datasetId, gameVersion: o.gameVersion, now: o.now, empty: true });
  const report: SaveImportReport = { factories: 0, buildings: 0, links: 0, linksSkipped: 0, linksFailed: 0, orders: 0, areas: 0, railNodes: 0, railSegments: 0, stations: 0, trains: 0, plans: 0, notes: [] };
  const notes = new Set<string>();
  const save = new Map(ex.buildings.map((b) => [b.id, b]));
  const idOf = new Map<string, string>();
  const usedFoundations = new Set<number>();
  const factoryOfSave = new Map<string, string>();

  // Spielfortschritt
  const tiers = ex.schematics.map((id) => gd.data.schematics?.[id]).filter((s) => s?.kind === 'milestone').map((s) => s!.tier);
  // Züge und Lkw fahren im Spiel, Transportaufträge gibt es noch nicht: Stationen liefern nach Bedarf
  p.settings.stationsOnDemand = true;
  p.settings.progress = { source: 'save', maxTier: Math.max(0, ...tiers), schematics: [...ex.schematics].sort(), phase: ex.phase };
  p.description = tr('Aus dem Spielstand „{save}“ ({session}) übernommen.', { save: ex.meta.saveName, session: ex.meta.sessionName });

  // --- Fabriken, Stockwerke, Gebäude ---
  for (const g of o.groups) {
    const bs = g.buildingIds.map((id) => save.get(id)).filter((b): b is SaveBuilding => !!b && !!usable(gd, b));
    if (!bs.length) continue;
    const { factory, floor } = makeFactory(p, g.name);
    const rect = bs.map((b) => worldRect(gd.building(b.type)!, b)).reduce((a, r) => ({ minX: Math.min(a.minX, r.minX), minY: Math.min(a.minY, r.minY), maxX: Math.max(a.maxX, r.maxX), maxY: Math.max(a.maxY, r.maxY) }));
    // Ursprung auf einer Fundamentkante des Weltrasters: lokales 8-m-Raster = Fundamente im Spiel
    const origin = { x: snapGrid((rect.minX + rect.maxX) / 2), y: snapGrid((rect.minY + rect.maxY) / 2) };
    factory.map = { x: origin.x, y: origin.y, rotationDeg: 0 };
    p.factories[factory.id] = factory;
    // Stockwerke aus den Höhen der Hauptgebäude (Maschinen, Gewinnung, Kraftwerke, Lager)
    // Wasserextraktoren stehen im Wasser: eigene Ebene, auch wenn sie in die Fundamente darüber ragen
    const isWater = (b: SaveBuilding) => gd.building(b.type)!.nativeClass === 'FGBuildableWaterPump';
    const cat = (b: SaveBuilding) => gd.building(b.type)!.category;
    // Fundamente im Bereich der Fabrik (8 m Rand)
    const box = { minX: rect.minX - 8, minY: rect.minY - 8, maxX: rect.maxX + 8, maxY: rect.maxY + 8 };
    const mine = (raw.foundations ?? []).filter((fd, i) => !usedFoundations.has(i) && fd.x >= box.minX && fd.x <= box.maxX && fd.y >= box.minY && fd.y <= box.maxY && (usedFoundations.add(i), true));
    // Ebenen bilden Maschinen, Kraftwerke und Lager; Miner stehen auf Gelände (Versatz zur Ebene darunter)
    const machine = (b: SaveBuilding) => cat(b) === 'production' || cat(b) === 'power';
    const item = (b: SaveBuilding) => ({ z: b.z, h: buildingHeight(gd.building(b.type)!) });
    const machineLevels = floorLevels(bs.filter(machine).map(item));
    // Logistikebenen (Hotfix 0.10.3): mindestens 10 Splitter, Zusammenführungen, Rohrkreuzungen, Lager, Senken u. ä.
    // auf eigener Höhe (überwiegend Logistik), nicht auf der Höhe einer Maschinenebene. Lager darauf bilden keine eigene Ebene.
    const support = bs.filter((b) => !machine(b) && cat(b) !== 'extraction' && cat(b) !== 'rail').sort((a, b) => a.z - b.z);
    const clusters: { z: number; top: number; members: SaveBuilding[] }[] = [];
    for (const b of support) {
      const c = clusters.at(-1);
      if (c && b.z - c.top <= 3) {
        c.top = b.z;
        c.members.push(b);
      } else clusters.push({ z: b.z, top: b.z, members: [b] });
    }
    const onMachineLevel = (z: number) => machineLevels.some((l) => z >= l.z - 1 && z <= l.z + 4);
    // … auf Fundamenten (Splitter, Rohrkreuzungen u. Ä. bis 6 m darüber), deren Oberkante nicht die einer
    // Maschinenebene ist (sonst z. B. eine Splitterreihe über den Maschinen)
    const floorUnder = (b: SaveBuilding): number | null => {
      let best: number | null = null;
      for (const fd of mine) {
        if (Math.abs(fd.x - b.x) > 5 || Math.abs(fd.y - b.y) > 5) continue;
        const top = fd.z + foundationHeight(gd, fd.type) / 2;
        if (b.z - top > -1 && b.z - top <= 6 && (best === null || top > best)) best = top;
      }
      return best;
    };
    const logClusters = clusters.flatMap((c) => {
      const n = c.members.length;
      const nLog = c.members.filter((b) => cat(b) === 'logistics').length;
      const floors = c.members.map(floorUnder).filter((z): z is number => z !== null).sort((a, b) => a - b);
      if (n < 10 || nLog * 2 < n) return [];
      // Mehr als 10 m von jeder Maschinenebene entfernt: auch ohne Fundamente (wie bisher)
      if (!onMachineLevel(c.z) && machineLevels.every((l) => Math.abs(c.z - l.z) > SAME_FLOOR_GAP_M)) return [c];
      if (floors.length * 2 < n) return [];
      const z = floors[Math.floor(floors.length / 2)]!;
      return onMachineLevel(z) ? [] : [{ ...c, z: Math.min(z, c.z) }];
    });
    const inLogistics = (b: SaveBuilding) => logClusters.some((c) => b.z >= c.z - 0.5 && b.z <= c.top + 0.5);
    const anchors = bs.filter((b) => machine(b) || (cat(b) === 'storage' && !inLogistics(b)));
    const main = floorLevels((anchors.length ? anchors : bs.filter((b) => !isWater(b))).map(item)).map((l) => ({ ...l, kind: 'production' as const }));
    const water = floorLevels(bs.filter(isWater).map((b) => ({ z: b.z, h: 0 })))
      .filter((w) => !main.some((m) => Math.abs(m.z - w.z) < 1))
      .map((l) => ({ ...l, kind: 'production' as const, water: true }));
    const known = [...main, ...water];
    const logistics = logClusters
      .filter((c) => !known.some((l) => c.z >= l.z - 1 && c.z <= l.z + 4))
      .map((c) => ({ z: Math.floor(c.z * 1000) / 1000, height: DEFAULT_FLOOR_HEIGHT_M.logistics, kind: 'logistics' as const }));
    const levels = mergeLevels(
      [...known, ...logistics].sort((a, b) => a.z - b.z),
      [
        // Für die Höhe zählen Maschinen, Kraftwerke und Lager (Miner, Splitter u. Ä. stehen oft am Hang)
        ...bs.map((b) => ({ z: b.z, top: b.z + (anchors.includes(b) ? buildingHeight(gd.building(b.type)!) : 0), rect: worldRect(gd.building(b.type)!, b) })),
        ...mine.map((fd) => {
          const top = fd.z + (gd.building(fd.type)?.foundation?.heightM ?? 1) / 2;
          return { z: top, top, rect: { minX: fd.x - 4, minY: fd.y - 4, maxX: fd.x + 4, maxY: fd.y + 4 } };
        }),
      ],
    );
    const floorIds: string[] = [];
    levels.forEach((lv, i) => {
      const fl = i === 0 ? floor : { ...floor, id: newId('floor') };
      fl.name = levels.length > 1 ? tr('Ebene {n} ({z} m)', { n: i + 1, z: Math.round(lv.z) }) : floor.name;
      fl.elevationM = lv.z;
      fl.heightM = lv.height;
      fl.kind = lv.kind;
      p.floors[fl.id] = fl;
      floorIds.push(fl.id);
    });
    factory.floorIds = floorIds;
    const floorFor = (z: number) => {
      let k = 0;
      for (let i = 0; i < levels.length; i++) if (levels[i]!.z <= z + 0.5) k = i;
      return { floorId: floorIds[k]!, elevation: levels[k]!.z };
    };
    for (const b of bs) {
      factoryOfSave.set(b.id, factory.id);
      if (isStationPart(b.type)) continue; // entstehen über den Bahnhofsabgleich
      if (raw.buildings.find((x) => x.id === b.id)?.type === SMART_LIFT) notes.add(tr('Smart-Splitter am Förderlift als Smart-Splitter übernommen.'));
      const def = gd.building(b.type)!;
      const z = baseZ(def, b);
      const fl = floorFor(z);
      const recipe = b.recipe && gd.recipe(b.recipe)?.producedIn.includes(b.type) ? b.recipe : null;
      if (b.recipe && !recipe) notes.add(tr('Rezept {r} ist im Planer nicht für {b} bekannt – ohne Rezept übernommen.', { r: b.recipe, b: gd.name(b.type) }));
      const gen = def.category === 'power' && b.fuel ? `Power_${b.type}_${b.fuel}` : null;
      let extraction: { itemId: string; purity: Purity; nodeId?: string | null } | null = null;
      if (def.extractor) {
        const node = b.node ? gd.mapNode(b.node) : undefined;
        if (node?.itemId) extraction = { itemId: node.itemId, purity: node.purity ?? 'normal', nodeId: node.id };
        else if (def.nativeClass === 'FGBuildableWaterPump') extraction = { itemId: 'Desc_Water_C', purity: 'normal' };
        else notes.add(tr('{b}: Vorkommen nicht in den Kartendaten – ohne Rohstoff übernommen.', { b: gd.name(b.type) }));
      }
      const maxClock = gd.fact('production.clock.maxWithShards') ?? 2.5;
      const clock = def.clock ? Math.min(maxClock, Math.max(def.clock.min, Math.round(b.clock * 1e4) / 1e4)) : 1;
      try {
        const id = addBuilding(p, gd, {
          factoryId: factory.id,
          type: b.type,
          recipeId: recipe ?? (gen && gd.recipe(gen) ? gen : null),
          clock,
          somersloops: Math.min(def.somersloopSlots ?? 0, b.somersloops),
          placement: {
            floorId: fl.floorId,
            x: r3(b.x - origin.x),
            y: r3(b.y - origin.y),
            zOffsetM: r3(z - fl.elevation),
            rotationDeg: r3(normalizeDeg(b.yawDeg)),
            ...(b.vertical && canBeVertical(def) ? { vertical: b.vertical } : {}),
          },
          extraction,
          // Lkw- und Tanklaster-Stationen: Be- bzw. Entladen wie im Spiel
          transfer: transferInterface(def) === 'vehicle' && b.loadMode !== null ? { mode: b.loadMode ? 'load' : 'unload', stationId: null } : null,
          sortRules: sortRulesOf(gd, def, b, raw.buildings.find((x) => x.id === b.id)?.type === SMART_LIFT),
        });
        idOf.set(b.id, id);
        report.buildings++;
      } catch (e) {
        notes.add(tr('{b} nicht übernommen: {msg}', { b: gd.name(b.type), msg: (e as Error).message }));
      }
    }
    // Fundamente je Ebene zu Rechtecken zusammengefasst
    report.areas += importFoundations(p, gd, factory.id, origin, levels.map((l, i) => ({ z: l.z, floorId: floorIds[i]! })), mine);
    report.factories++;
  }

  // --- Schienennetz ---
  if (o.rail && ex.tracks.length) importRail(p, gd, ex, factoryOfSave, idOf, report, notes);

  // --- Leitungen ---
  const chains = orientPipes(gd, save, traceChains(ex, (id) => save.has(id)));
  const between: Chain[] = [];
  for (const c of chains) {
    const fa = idOf.get(c.from.id);
    const fb = idOf.get(c.to.id);
    if (!fa || !fb || p.buildings[fa]!.factoryId !== p.buildings[fb]!.factoryId) {
      if (fa && fb) between.push(c);
      else report.linksSkipped++;
      continue;
    }
    const a = p.buildings[fa]!;
    const b = p.buildings[fb]!;
    const pa = portOfComp(gd.building(a.type)!, c.from.comp);
    const pb = portOfComp(gd.building(b.type)!, c.to.comp);
    const tiers = c.types.map((t) => tierOf(gd, t)).filter((t): t is string => !!t);
    const cap = (t: string) => gd.building(t)!.conveyor?.itemsPerMin ?? gd.building(t)!.pipe?.m3PerMin ?? 0;
    const tier = tiers.sort((x, y) => cap(x) - cap(y))[0];
    if (!pa || !pb || !tier) {
      report.linksFailed++;
      continue;
    }
    const f = p.factories[a.factoryId]!.map!;
    // Punkte in lokale Koordinaten; die ersten bzw. letzten Punkte am Anschluss ersetzt der Planer (Austritt 1 m)
    const local = simplify(c.points).map((q) => ({ x: r3(q.x - f.x), y: r3(q.y - f.y), z: r3(q.z) }));
    const trimmed = snapToStubs(p, gd, local, { buildingId: fa, portId: pa }, { buildingId: fb, portId: pb });
    try {
      addLink(p, gd, { kind: c.kind, tier, from: { buildingId: fa, portId: pa }, to: { buildingId: fb, portId: pb }, waypoints: trimmed, routing: 'direct' });
      report.links++;
    } catch {
      report.linksFailed++;
    }
  }
  // Leitungen zwischen Fabriken: direkte Transportaufträge (Band bzw. Rohr), einer je Gegenstand
  const graph = chainGraph(chains);
  for (const c of between) {
    const fa = idOf.get(c.from.id)!;
    const fb = idOf.get(c.to.id)!;
    const a = p.buildings[fa]!;
    const b = p.buildings[fb]!;
    const pa = portOfComp(gd.building(a.type)!, c.from.comp);
    const pb = portOfComp(gd.building(b.type)!, c.to.comp);
    const tier = c.types.map((t) => tierOf(gd, t)).find((t): t is string => !!t);
    const what = pa && pb && tier ? deliveredItems(p, gd, idOf, graph, c) : [];
    if (!what.length || !tier) {
      report.linksSkipped++;
      continue;
    }
    for (const x of what) {
      try {
        addOrder(p, gd, {
          name: tr('{kind}: {item}', { kind: c.kind === 'belt' ? tr('Band') : tr('Rohr'), item: gd.name(x.itemId) }),
          itemId: x.itemId,
          ratePerMin: Math.round(x.perMin * 1000) / 1000,
          fromFactoryId: a.factoryId,
          toFactoryId: b.factoryId,
          mode: c.kind,
          fromStationId: null,
          toStationId: null,
          trainIds: [],
          roundTripEstimateS: null,
          direct: { tier, lines: 1, lengthM: Math.round(c.lengthM), from: { buildingId: fa, portId: pa! }, to: { buildingId: fb, portId: pb! } },
        });
        report.orders++;
      } catch {
        report.linksSkipped++;
      }
    }
  }
  if (report.orders) notes.add(tr('{n} Band- bzw. Rohrverbindungen zwischen Fabriken als Transportaufträge übernommen.', { n: report.orders }));
  if (report.linksFailed) notes.add(tr('{n} Leitungen konnten nicht übernommen werden (Anschluss unbekannt oder schon belegt).', { n: report.linksFailed }));
  if (report.linksSkipped) notes.add(tr('{n} Leitungen führen zu Gebäuden außerhalb der übernommenen Fabriken bzw. zwischen Fabriken und wurden ausgelassen.', { n: report.linksSkipped }));

  // --- Produktionspläne ---
  if (o.plans) for (const f of Object.values(p.factories)) if (planFromMachines(p, gd, f.id)) report.plans++;

  const unknown = Object.entries(ex.skipped).reduce((s, [, n]) => s + n, 0);
  if (unknown) notes.add(tr('{n} Objekte ohne Bedeutung für die Planung ausgelassen (Wände, Rampen, Stromleitungen u. a.).', { n: unknown }));
  notes.add(tr('Das Stromnetz wird nicht übernommen; Bänder und Rohre folgen dem Verlauf im Spiel, Kurven als Ecken.'));
  report.notes = [...notes];
  return { project: p, report };
}

/**
 * Punkte direkt am Anschluss (bis 1,6 m waagrecht, z. B. ein Lift unmittelbar
 * vor der Maschine) auf den Austrittspunkt des Anschlusses legen: Der Planer
 * zeichnet die Leitung vom Anschluss 1 m nach außen; so bleibt der Lift
 * senkrecht statt schräg.
 */
function snapToStubs(p: Project, gd: GameDataIndex, pts: Vec3[], from: PortRef, to: PortRef): Vec3[] {
  const port = (r: PortRef) => {
    const b = p.buildings[r.buildingId]!;
    return worldPorts(b, gd.building(b.type)!, p.floors[b.placement!.floorId]).find((q) => q.id === r.portId);
  };
  // Punkte am Anschluss selbst ersetzt der Planer (Anschluss → 1 m Austritt)
  const at = (q: WorldPort | undefined, w: Vec3) => !!q && Math.hypot(w.x - q.world.x, w.y - q.world.y, w.z - q.world.z) < 0.6;
  const pf = port(from);
  const pt = port(to);
  let a = 0;
  let b = pts.length;
  while (a < b && at(pf, pts[a]!)) a++;
  while (b > a && at(pt, pts[b - 1]!)) b--;
  const out = pts.slice(a, b).map((q) => ({ ...q }));
  const snap = (q: WorldPort | undefined, order: number[]) => {
    if (!q) return;
    const stub = { x: q.world.x + q.worldNormal.x * PORT_STUB_M, y: q.world.y + q.worldNormal.y * PORT_STUB_M };
    for (const i of order) {
      const w = out[i]!;
      if (Math.hypot(w.x - q.world.x, w.y - q.world.y) > 1.6) break;
      w.x = r3(stub.x);
      w.y = r3(stub.y);
    }
  };
  snap(pf, out.map((_, i) => i));
  snap(pt, out.map((_, i) => out.length - 1 - i));
  return out.filter((w, i) => i === 0 || Math.abs(w.x - out[i - 1]!.x) > 1e-6 || Math.abs(w.y - out[i - 1]!.y) > 1e-6 || Math.abs(w.z - out[i - 1]!.z) > 1e-6);
}

/**
 * Ketten vom Ausgang zum Eingang ausrichten (die Suche findet sie von
 * beiden Enden). Rohre haben im Spiel keine Richtung; der Planer rechnet in
 * Zeichenrichtung. Rohre mit Ein- bzw. Ausgang an einem Ende werden danach ausgerichtet, Rohre
 * zwischen richtungsfreien Anschlüssen (Rohrkreuzungen) von den Quellen weg
 * (Breitensuche über das Rohrnetz, Abstand in Rohren).
 */
function orientPipes(gd: GameDataIndex, save: Map<string, SaveBuilding>, chains: Chain[]): Chain[] {
  const dirOf = (r: SaveRef) => {
    const b = save.get(r.id);
    const def = b && gd.building(b.type);
    // Richtung laut Planer (Flüssigkeitspuffer: richtungsfrei)
    const pid = def ? portOfComp(def, r.comp) : null;
    return (def && pid && portDefs(def).find((q) => q.id === pid)?.direction) ?? 'any';
  };
  const flip = (c: Chain): Chain => ({ ...c, from: c.to, to: c.from, points: [...c.points].reverse() });
  // Bänder (Hotfix 0.10.3) und Rohre mit Ein- bzw. Ausgang an einem Ende: vom Ausgang zum Eingang
  const out = chains.map((c) => {
    const a = dirOf(c.from);
    const b = dirOf(c.to);
    return a === 'in' || b === 'out' ? flip(c) : c;
  });
  // Abstand jedes Gebäudes von einer Quelle (Ausgang an einem gerichteten Rohr)
  const free = out.map((c, i) => (c.kind === 'pipe' && dirOf(c.from) === 'any' && dirOf(c.to) === 'any' ? i : -1)).filter((i) => i >= 0);
  if (!free.length) return out;
  const distance = new Map<string, number>();
  const queue: string[] = [];
  for (const c of out) {
    if (c.kind !== 'pipe' || dirOf(c.from) === 'any') continue;
    if (!distance.has(c.to.id)) {
      distance.set(c.from.id, 0);
      distance.set(c.to.id, 1);
      queue.push(c.to.id);
    }
  }
  const adj = new Map<string, string[]>();
  for (const i of free) {
    const c = out[i]!;
    adj.set(c.from.id, [...(adj.get(c.from.id) ?? []), c.to.id]);
    adj.set(c.to.id, [...(adj.get(c.to.id) ?? []), c.from.id]);
  }
  while (queue.length) {
    const id = queue.shift()!;
    for (const n of adj.get(id) ?? []) {
      if (distance.has(n)) continue;
      distance.set(n, distance.get(id)! + 1);
      queue.push(n);
    }
  }
  for (const i of free) {
    const c = out[i]!;
    const da = distance.get(c.from.id) ?? Infinity;
    const db = distance.get(c.to.id) ?? Infinity;
    if (db < da) out[i] = flip(c);
  }
  return out;
}

/** Ketten je Gebäude (Spielstand-IDs): ankommend bzw. abgehend. */
interface ChainGraph {
  into: Map<string, Chain[]>;
  out: Map<string, Chain[]>;
}

function chainGraph(chains: Chain[]): ChainGraph {
  const into = new Map<string, Chain[]>();
  const out = new Map<string, Chain[]>();
  for (const c of chains) {
    into.set(c.to.id, [...(into.get(c.to.id) ?? []), c]);
    out.set(c.from.id, [...(out.get(c.from.id) ?? []), c]);
  }
  return { into, out };
}

/**
 * Gegenstände und Mengen einer Leitung zwischen Fabriken (Hotfix 0.10.3: über
 * den ganzen Spielstand, also auch über andere Fabriken, Splitter, Lager und
 * Pumpen hinweg):
 * - rückwärts die Ausgänge der Maschinen bzw. Gewinnung, die hierher liefern;
 * - vorwärts die Eingänge der Maschinen dahinter, ohne Gegenstände, die sie
 *   schon über ihre anderen Eingänge bekommen.
 * Es gilt die Schnittmenge, dazu der Bedarf, wenn eine Station mit
 * unbekannter Ladung liefert, bzw. die Lieferung, wenn auch Lager, Senken
 * oder Stationen abnehmen; ist sie leer, die bekannte Seite. Menge: die
 * kleinere der beiden Seiten.
 * Rohre haben im Spiel keine Richtung und werden in beide Richtungen
 * durchsucht. Bahnhöfe und Lkw-Stationen beenden die Suche (Ladung unbekannt).
 */
function deliveredItems(p: Project, gd: GameDataIndex, idOf: Map<string, string>, graph: ChainGraph, c: Chain): { itemId: string; perMin: number }[] {
  const fluid = (item: string) => (gd.item(item)?.form ?? 'solid') !== 'solid';
  const fits = (item: string) => fluid(item) === (c.kind === 'pipe');
  const building = (saveId: string) => {
    const id = idOf.get(saveId);
    const b = id ? p.buildings[id] : undefined;
    const def = b ? gd.building(b.type) : undefined;
    return b && def ? { id: id!, b, def } : null;
  };
  const isMachine = (def: GdBuilding) => def.category === 'production' || def.category === 'power' || def.category === 'extraction';
  const stops = (def: GdBuilding) => isStationPart(def.id) || transferInterface(def) !== null;
  const outputsCache = new Map<string, Map<string, { itemId: string; perMin: number }>>();
  const outputsOf = (id: string) => {
    let m = outputsCache.get(id);
    if (!m) {
      const b = p.buildings[id]!;
      m = outputPortAssignment(
        gd,
        gd.building(b.type)!,
        machineRates(gd, b).outputs.map((x) => ({ itemId: x.item, perMin: x.perMin })),
      );
      outputsCache.set(id, m);
    }
    return m;
  };
  /** Nachbarn über Ketten derselben Art: Bänder in Flussrichtung, Rohre in beide Richtungen. */
  const next = (saveId: string, dir: 'back' | 'fwd'): SaveRef[] => {
    const res: SaveRef[] = [];
    for (const q of graph.into.get(saveId) ?? []) if (q.kind === c.kind && (dir === 'back' || q.kind === 'pipe')) res.push(q.from);
    for (const q of graph.out.get(saveId) ?? []) if (q.kind === c.kind && (dir === 'fwd' || q.kind === 'pipe')) res.push(q.to);
    return res;
  };
  /** Rückwärts: liefernde Maschinenausgänge ab einem Anschluss. */
  const back = (start: SaveRef[], skip: string | null = null) => {
    const found = new Map<string, number>();
    let unknown = false;
    const seen = new Set<string>(skip ? [skip] : []);
    const queue = [...start];
    while (queue.length && seen.size < 500) {
      const r = queue.shift()!;
      const x = building(r.id);
      if (!x) continue;
      if (isMachine(x.def)) {
        const port = portOfComp(x.def, r.comp);
        const o = port ? outputsOf(x.id).get(port) : undefined;
        if (o && fits(o.itemId)) found.set(o.itemId, (found.get(o.itemId) ?? 0) + o.perMin);
        continue;
      }
      if (seen.has(r.id)) continue;
      if (stops(x.def)) {
        unknown = true;
        continue;
      }
      seen.add(r.id);
      queue.push(...next(r.id, 'back'));
    }
    return { found, unknown };
  };
  /** Vorwärts: Bedarf der Maschinen dahinter (`null`, wenn auch Lager-Enden, Senken oder Stationen abnehmen). */
  const fwd = (start: SaveRef) => {
    const demand = new Map<string, number>();
    let open = false;
    const seen = new Set<string>([c.from.id]);
    const queue = [start];
    while (queue.length && seen.size < 500) {
      const r = queue.shift()!;
      const x = building(r.id);
      if (!x) continue;
      if (isMachine(x.def)) {
        // Was nur über die anderen Eingänge ankommt, fließt nicht über diese Leitung
        const others = new Set<string>();
        const own = new Set<string>();
        for (const q of graph.into.get(r.id) ?? []) if (q.kind === c.kind && q.to.comp === r.comp) for (const it of back([q.from], r.id).found.keys()) own.add(it);
        for (const q of graph.into.get(r.id) ?? []) if (q.kind === c.kind && q.to.comp !== r.comp) for (const it of back([q.from], r.id).found.keys()) others.add(it);
        if (c.kind === 'pipe') for (const q of graph.out.get(r.id) ?? []) if (q.kind === 'pipe' && q.from.comp !== r.comp) for (const it of back([q.to], r.id).found.keys()) others.add(it);
        for (const inp of machineRates(gd, x.b).inputs) if (fits(inp.item) && (!others.has(inp.item) || own.has(inp.item))) demand.set(inp.item, (demand.get(inp.item) ?? 0) + inp.perMin);
        continue;
      }
      if (seen.has(r.id)) continue;
      seen.add(r.id);
      const onward = next(r.id, 'fwd');
      if (stops(x.def) || x.def.category === 'other' || (!onward.length && x.def.category === 'storage')) open = true;
      if (!stops(x.def)) queue.push(...onward);
    }
    return { demand, open };
  };
  const { found: supply, unknown } = back([c.from]);
  const { demand, open } = fwd(c.to);
  // Schnittmenge; dazu, was eine Station mit unbekannter Ladung liefern kann bzw. was Lager, Senken oder Stationen abnehmen
  const items = new Set([...supply.keys()].filter((i) => demand.has(i)));
  if (unknown) for (const i of demand.keys()) items.add(i);
  if (open || !demand.size) for (const i of supply.keys()) items.add(i);
  if (!items.size) for (const i of (supply.size ? supply : demand).keys()) items.add(i);
  return [...items].map((itemId) => {
    const s = supply.get(itemId);
    const d = demand.get(itemId);
    return { itemId, perMin: s !== undefined && d !== undefined ? Math.min(s, d) : (s ?? d ?? 0) };
  });
}

/**
 * Fundamente einer Fabrik als Fundamentflächen: Oberkante (Mitte + halbe Höhe)
 * muss auf einer Ebene liegen (±1 m), sonst sind es Stützen bzw. Unterbau.
 * Im Weltraster liegen die Mitten auf Vielfachen von 8 m (nicht eingerastete
 * Fundamente: je Versatz und Drehung ein eigenes Raster); je Ebene werden die belegten
 * Zellen zu Rechtecken gleicher Fundamentart zusammengefasst (waagrechte
 * Läufe, dann gleiche Läufe darunter angehängt). Schräg gedrehte Fundamente
 * werden im gedrehten Raster zusammengefasst.
 */
function importFoundations(
  p: Project,
  gd: GameDataIndex,
  factoryId: string,
  origin: Vec2,
  levels: { z: number; floorId: string }[],
  list: { type: string; x: number; y: number; z: number; yawDeg: number }[],
): number {
  const heightOf = (type: string) => foundationHeight(gd, type);
  const cells = new Map<string, Map<string, { type: string; top: number }>>();
  for (const fd of list) {
    const top = fd.z + heightOf(fd.type) / 2;
    const level = levels.find((l) => Math.abs(l.z - top) <= 1);
    if (!level) continue;
    // Drehung (Rest zu 90°, auf 0,5° gerundet) und Versatz im gedrehten Raster: je Kombination ein eigenes Raster
    const turn = (Math.round((((fd.yawDeg % 90) + 90) % 90) * 2) / 2) % 90;
    const q = rotate({ x: fd.x, y: fd.y }, -turn);
    const off = (v: number) => (Math.round((((v % WORLD_GRID_M) + WORLD_GRID_M) % WORLD_GRID_M) * 10) / 10) % WORLD_GRID_M;
    const ox = off(q.x);
    const oy = off(q.y);
    const groupKey = `${level.floorId}|${ox}|${oy}|${turn}`;
    const grid = cells.get(groupKey) ?? new Map<string, { type: string; top: number }>();
    const k = `${Math.round((q.x - ox) / WORLD_GRID_M)},${Math.round((q.y - oy) / WORLD_GRID_M)}`;
    const prev = grid.get(k);
    if (!prev || top > prev.top) grid.set(k, { type: fd.type, top });
    cells.set(groupKey, grid);
  }
  let count = 0;
  const half = WORLD_GRID_M / 2;
  for (const [groupKey, grid] of cells) {
    const [floorId, oxs, oys, turns] = groupKey.split('|') as [string, string, string, string];
    const ox = Number(oxs);
    const oy = Number(oys);
    const turn = Number(turns);
    // Waagrechte Läufe je Zeile
    const rows = new Map<number, { x0: number; x1: number; type: string }[]>();
    const keys = [...grid.keys()].map((k) => k.split(',').map(Number) as [number, number]).sort((a, b) => a[1] - b[1] || a[0] - b[0]);
    for (const [x, y] of keys) {
      const type = grid.get(`${x},${y}`)!.type;
      const row = rows.get(y) ?? [];
      const last = row.at(-1);
      if (last && last.x1 === x - 1 && last.type === type) last.x1 = x;
      else row.push({ x0: x, x1: x, type });
      rows.set(y, row);
    }
    // Gleiche Läufe in den Zeilen darunter anhängen
    const done = new Set<string>();
    for (const y of [...rows.keys()].sort((a, b) => a - b)) {
      for (const run of rows.get(y)!) {
        const key = `${y}:${run.x0}:${run.x1}`;
        if (done.has(key)) continue;
        let y1 = y;
        while (rows.get(y1 + 1)?.some((r) => r.x0 === run.x0 && r.x1 === run.x1 && r.type === run.type)) {
          y1++;
          done.add(`${y1}:${run.x0}:${run.x1}`);
        }
        const poly = [
          { x: run.x0 * WORLD_GRID_M - half, y: y * WORLD_GRID_M - half },
          { x: run.x1 * WORLD_GRID_M + half, y: y * WORLD_GRID_M - half },
          { x: run.x1 * WORLD_GRID_M + half, y: y1 * WORLD_GRID_M + half },
          { x: run.x0 * WORLD_GRID_M - half, y: y1 * WORLD_GRID_M + half },
        ]
          .map((q) => rotate({ x: q.x + ox, y: q.y + oy }, turn))
          .map((q) => ({ x: r3(q.x - origin.x), y: r3(q.y - origin.y) }));
        const type = gd.building(run.type) ? run.type : 'Build_Foundation_8x4_01_C';
        addArea(p, { factoryId, floorId, kind: 'foundation', polygon: poly, foundationType: type });
        count++;
      }
    }
  }
  return count;
}

// ---------------------------------------------------------------------------
// Produktionsplan aus den Maschinen
// ---------------------------------------------------------------------------

function planFromMachines(p: Project, gd: GameDataIndex, factoryId: string): boolean {
  const net = new Map<string, number>();
  const extracted = new Map<string, number>();
  const used = new Set<string>();
  const generators = new Map<string, number>();
  for (const b of Object.values(p.buildings)) {
    if (b.factoryId !== factoryId) continue;
    const r = b.recipeId ? gd.recipe(b.recipeId) : undefined;
    const rates = machineRates(gd, b);
    if (r?.generator) {
      // Kraftwerke: feste Anzahl im Plan; ihr Brennstoff zählt zum Verbrauch der Fabrik
      generators.set(r.id, (generators.get(r.id) ?? 0) + b.clock);
      for (const x of rates.inputs) net.set(x.item, (net.get(x.item) ?? 0) - x.perMin);
      continue;
    }
    if (gd.building(b.type)?.extractor) for (const x of rates.outputs) extracted.set(x.item, (extracted.get(x.item) ?? 0) + x.perMin);
    else {
      if (r) used.add(r.id);
      for (const x of rates.outputs) net.set(x.item, (net.get(x.item) ?? 0) + x.perMin);
      for (const x of rates.inputs) net.set(x.item, (net.get(x.item) ?? 0) - x.perMin);
    }
  }
  if (!used.size && !generators.size) return false;
  const round = (v: number) => Math.round(v * 1000) / 1000;
  // Ziele: Überschuss der Fabrik (Rundungsreste der Takte unter 0,5/min zählen nicht)
  const targets = [...net].filter(([, v]) => v > 0.5).map(([itemId, v]) => ({ itemId, ratePerMin: round(v) }));
  const supplies: ProductionPlan['supplies'] = [];
  for (const [itemId, v] of net) {
    if (v >= -0.5) continue;
    // Ein Eintrag je Gegenstand: eigene Gewinnung plus Rest als Zulieferung; Herkunft „lokal“, sobald gefördert wird
    const local = extracted.get(itemId) ?? 0;
    supplies.push({ itemId, maxPerMin: round(Math.max(local, -v)), origin: local > 1e-3 ? 'local' : 'import' });
  }
  // Rezepte wie aufgestellt: die vorhandenen Maschinen sind die Obergrenze, genutzte Alternativen frei
  const plan: ProductionPlan = {
    id: newId('productionPlan'),
    factoryId,
    name: tr('Aus Spielstand'),
    mode: 'target',
    targets,
    supplies,
    enabledAlternates: [...used].filter((id) => gd.recipe(id)!.alternate),
    disabledRecipes: [],
    machineLimits: [],
    limitToExistingMachines: true,
    optimize: 'resources',
    power: { generators: [...generators].map(([recipeId, count]) => ({ recipeId, count: round(count) })) },
    suggestAlternates: false,
  };
  p.productionPlans[plan.id] = plan;
  return true;
}

// ---------------------------------------------------------------------------
// Schienennetz
// ---------------------------------------------------------------------------

function importRail(
  p: Project,
  gd: GameDataIndex,
  ex: SaveExtract,
  factoryOfSave: Map<string, string>,
  idOf: Map<string, string>,
  report: SaveImportReport,
  notes: Set<string>,
): void {
  const networkId = newId('railNetwork');
  p.railNetworks[networkId] = { id: networkId, name: tr('Schienennetz'), color: '#e0a030', notes: '' };
  const tracks = new Map(ex.tracks.map((t) => [t.id, t]));
  const buildings = new Map(ex.buildings.map((b) => [b.id, b]));
  const endKey = (id: string, e: number) => `${id}#${e}`;
  /** Gleisende: Lage und Richtung in das Gleis hinein. */
  const endInfo = (id: string, e: number): { pos: Vec3; dir: Vec2 } => {
    const t = tracks.get(id)!;
    if (e === 0) return { pos: t.points[0]!.p, dir: normalize(t.points[0]!.leave) };
    const last = t.points.at(-1)!;
    return { pos: last.p, dir: normalize(scale(last.arrive, -1)) };
  };

  // --- Bahnhöfe: Bahnhofsgleis + Bahnsteiggleise als ein Stück ---
  interface Complex {
    station: SaveBuilding;
    platforms: SaveBuilding[];
    trackIds: Set<string>;
    u: Vec2;
    front: Vec3;
    back: Vec3;
  }
  const complexes: Complex[] = [];
  const complexOfTrack = new Map<string, Complex>();
  for (const st of ex.buildings.filter((b) => b.type === STATION_BUILDING)) {
    const sides: SaveBuilding[][] = [];
    for (const r of Object.values(st.platformConns)) {
      const chain: SaveBuilding[] = [];
      let ref = r;
      let prev = st.id;
      while (ref && buildings.has(ref.id) && !chain.some((x) => x.id === ref!.id) && ref.id !== st.id) {
        const pl = buildings.get(ref.id)!;
        chain.push(pl);
        const nextRef: SaveRef | null = Object.values(pl.platformConns).find((x) => x && x.id !== prev) ?? null;
        prev = pl.id;
        ref = nextRef;
      }
      if (chain.length) sides.push(chain);
    }
    sides.sort((a, b) => b.length - a.length);
    if (sides.length > 1) notes.add(tr('Bahnhof mit Bahnsteigen auf beiden Seiten: nur die längere Seite übernommen.'));
    const platforms = sides[0] ?? [];
    const yawDir = { x: Math.cos((st.yawDeg * Math.PI) / 180), y: Math.sin((st.yawDeg * Math.PI) / 180) };
    // Fahrtrichtung: vom letzten Bahnsteig zum Bahnhofsgebäude (ohne Bahnsteige: Ausrichtung des Gebäudes)
    const u = platforms.length ? normalize(sub(st, platforms[0]!)) : yawDir;
    const front = { x: st.x + (u.x * PLATFORM_LENGTH_M) / 2, y: st.y + (u.y * PLATFORM_LENGTH_M) / 2, z: st.z };
    const len = PLATFORM_LENGTH_M * (1 + platforms.length);
    const back = { x: front.x - u.x * len, y: front.y - u.y * len, z: st.z };
    const ids = new Set([st.track, ...platforms.map((x) => x.track)].filter((x): x is string => !!x && tracks.has(x)));
    const c: Complex = { station: st, platforms, trackIds: ids, u, front, back };
    complexes.push(c);
    for (const id of ids) complexOfTrack.set(id, c);
  }

  // --- Knoten: verbundene Gleisenden zusammenfassen ---
  const groupOf = new Map<string, number>();
  const groups: { keys: string[] }[] = [];
  const join = (a: string, b: string) => {
    const ga = groupOf.get(a);
    const gb = groupOf.get(b);
    if (ga === undefined && gb === undefined) {
      groups.push({ keys: [a, b] });
      groupOf.set(a, groups.length - 1);
      groupOf.set(b, groups.length - 1);
    } else if (ga !== undefined && gb === undefined) {
      groups[ga]!.keys.push(b);
      groupOf.set(b, ga);
    } else if (ga === undefined && gb !== undefined) {
      groups[gb]!.keys.push(a);
      groupOf.set(a, gb);
    } else if (ga !== gb) {
      for (const k of groups[gb!]!.keys) {
        groups[ga!]!.keys.push(k);
        groupOf.set(k, ga!);
      }
      groups[gb!]!.keys = [];
    }
  };
  /** Gleisenden eines Bahnhofs nach außen: „front“ bzw. „back“ des Bahnhofs. */
  const outer = (key: string): string => {
    const [id, e] = key.split('#') as [string, string];
    const c = complexOfTrack.get(id);
    if (!c) return key;
    const pos = endInfo(id, Number(e)).pos;
    const dF = Math.hypot(pos.x - c.front.x, pos.y - c.front.y);
    const dB = Math.hypot(pos.x - c.back.x, pos.y - c.back.y);
    return `${c.station.id}#${dF <= dB ? 'front' : 'back'}`;
  };
  for (const t of ex.tracks) {
    for (const e of [0, 1]) {
      const k = outer(endKey(t.id, e));
      if (!groupOf.has(k)) {
        groups.push({ keys: [k] });
        groupOf.set(k, groups.length - 1);
      }
      for (const r of t.conns[e]!) {
        if (!tracks.has(r.id)) continue;
        const other = outer(endKey(r.id, endIndex(r.comp)));
        // innere Enden eines Bahnhofs
        if (other === k && complexOfTrack.has(t.id) && complexOfTrack.get(t.id) === complexOfTrack.get(r.id)) continue;
        join(k, other);
      }
    }
  }
  const info = (key: string): { pos: Vec3; dir: Vec2 } => {
    const [id, e] = key.split('#') as [string, string];
    const c = complexes.find((x) => x.station.id === id);
    if (c) return e === 'front' ? { pos: c.front, dir: scale(c.u, -1) } : { pos: c.back, dir: c.u };
    return endInfo(id, Number(e));
  };
  // Innere Bahnhofsenden (zwischen Bahnhofs- und Bahnsteiggleisen) haben keinen Knoten
  const isInner = (key: string) => {
    const [id] = key.split('#') as [string];
    return complexOfTrack.has(id) && !complexes.some((c) => c.station.id === id);
  };
  const nodeOfGroup = new Map<number, RailNode>();
  groups.forEach((g, gi) => {
    const keys = g.keys.filter((k) => !isInner(k));
    if (!keys.length) return;
    const ins = keys.map(info);
    const pos = ins.reduce((a, x) => ({ x: a.x + x.pos.x / ins.length, y: a.y + x.pos.y / ins.length, z: a.z + x.pos.z / ins.length }), { x: 0, y: 0, z: 0 });
    const d = ins[0]!.dir;
    const node: RailNode = { id: newId('railNode'), networkId, position: { x: r3(pos.x), y: r3(pos.y), z: r3(pos.z) }, headingDeg: r3(normalizeDeg((Math.atan2(d.y, d.x) * 180) / Math.PI)) };
    p.railNodes[node.id] = node;
    nodeOfGroup.set(gi, node);
  });
  const nodeAt = (key: string) => nodeOfGroup.get(groupOf.get(key)!)!;
  const sideOf = (node: RailNode, dir: Vec2): NodeSide => (dot(dir, { x: Math.cos((node.headingDeg * Math.PI) / 180), y: Math.sin((node.headingDeg * Math.PI) / 180) }) >= 0 ? 'B' : 'A');
  const addSeg = (aKey: { node: RailNode; dir: Vec2 }, bKey: { node: RailNode; dir: Vec2 }, handleA: number | null, handleB: number | null, stationId: string | null = null) => {
    const id = newId('railSegment');
    p.railSegments[id] = {
      id,
      networkId,
      a: { nodeId: aKey.node.id, side: sideOf(aKey.node, aKey.dir) },
      b: { nodeId: bKey.node.id, side: sideOf(bKey.node, bKey.dir) },
      handleA,
      handleB,
      stationId,
      intendedDirection: 'both',
    };
    report.railSegments++;
    return id;
  };

  // --- Gleise ---
  for (const t of ex.tracks) {
    if (complexOfTrack.has(t.id)) continue;
    let prev = { node: nodeAt(endKey(t.id, 0)), dir: endInfo(t.id, 0).dir };
    for (let i = 1; i < t.points.length; i++) {
      const a = t.points[i - 1]!;
      const b = t.points[i]!;
      const last = i === t.points.length - 1;
      let next: { node: RailNode; dir: Vec2 };
      if (last) next = { node: nodeAt(endKey(t.id, 1)), dir: endInfo(t.id, 1).dir };
      else {
        // Zwischenpunkt der Spline: eigener Knoten
        const d = normalize(b.arrive);
        const node: RailNode = { id: newId('railNode'), networkId, position: { x: r3(b.p.x), y: r3(b.p.y), z: r3(b.p.z) }, headingDeg: r3(normalizeDeg((Math.atan2(d.y, d.x) * 180) / Math.PI)) };
        p.railNodes[node.id] = node;
        next = { node, dir: scale(d, -1) };
      }
      // Hermite-Tangente → Länge des Bézier-Kontrollarms (Tangente / 3)
      const hA = Math.hypot(a.leave.x, a.leave.y) / 3;
      const hB = Math.hypot(b.arrive.x, b.arrive.y) / 3;
      addSeg(prev, next, r3(hA), r3(hB));
      prev = { node: next.node, dir: scale(next.dir, -1) };
    }
  }

  // --- Bahnhöfe ---
  const stationOfSave = new Map<string, string>();
  const platformOfSave = new Map<string, string>();
  const names = new Map(ex.stations.map((s) => [s.building, s.name]));
  for (const c of complexes) {
    const frontKey = `${c.station.id}#front`;
    const backKey = `${c.station.id}#back`;
    if (!groupOf.has(frontKey) || !groupOf.has(backKey)) continue;
    const front = nodeAt(frontKey);
    const back = nodeAt(backKey);
    const stationId = newId('station');
    const segmentId = addSeg({ node: back, dir: c.u }, { node: front, dir: scale(c.u, -1) }, null, null, stationId);
    const heading = (Math.atan2(c.u.y, c.u.x) * 180) / Math.PI;
    const platforms: Platform[] = c.platforms.map((pl) => {
      const type = pl.type === PLATFORM_BUILDING.fluid ? 'fluid' : pl.type === PLATFORM_BUILDING.freight ? 'freight' : 'empty';
      const diff = Math.abs(((pl.yawDeg - heading + 540) % 360) - 180);
      const id = newId('platform');
      platformOfSave.set(pl.id, id);
      return { id, type, mode: pl.loadMode === false ? 'unload' : 'load', flipped: diff > 90 };
    });
    const factoryId = factoryOfSave.get(c.station.id) ?? c.platforms.map((x) => factoryOfSave.get(x.id)).find((x) => x) ?? null;
    p.stations[stationId] = { id: stationId, networkId, name: names.get(c.station.id) || tr('Bahnhof {n}', { n: complexes.indexOf(c) + 1 }), factoryId, platforms, backNodeId: back.id, frontNodeId: front.id, segmentId };
    stationOfSave.set(c.station.id, stationId);
    report.stations++;
  }
  // Bahnhofsteile im Grundriss anlegen und den Gebäuden des Spielstands zuordnen
  const before: Project = { ...p, stations: {} };
  syncStations(before, p, gd);
  for (const b of Object.values(p.buildings)) {
    if (!b.stationPart) continue;
    const saveId =
      b.stationPart.platformId === null
        ? [...stationOfSave].find(([, sid]) => sid === b.stationPart!.stationId)?.[0]
        : [...platformOfSave].find(([, pid]) => pid === b.stationPart!.platformId)?.[0];
    if (saveId) idOf.set(saveId, b.id);
    report.buildings++;
  }

  // --- Signale: an dem Knoten des geschützten Gleisendes ---
  for (const s of ex.signals) {
    const r = s.guarded[0];
    if (!r || !tracks.has(r.id)) continue;
    const key = outer(endKey(r.id, endIndex(r.comp)));
    if (isInner(key) || !groupOf.has(key)) continue;
    const node = nodeAt(key);
    const side = sideOf(node, info(key).dir);
    const id = newId('railSignal');
    // Das Signal gilt für Züge, die das geschützte Gleis verlassen (am Spielstand geprüft: Züge finden ihren Fahrweg nur so)
    p.railSignals[id] = { id, networkId, nodeId: node.id, kind: s.kind, facing: side === 'B' ? 'backward' : 'forward' };
  }

  // --- Züge und Fahrpläne ---
  ex.trains.forEach((t, i) => {
    const name = t.name || tr('Zug {n}', { n: i + 1 });
    const stops = t.stops.filter((s) => stationOfSave.has(s.station));
    let timetableId: string | null = null;
    if (stops.length) {
      timetableId = newId('timetable');
      p.timetables[timetableId] = {
        id: timetableId,
        networkId,
        name,
        stops: stops.map((s) => {
          const st = p.stations[stationOfSave.get(s.station)!]!;
          const loads = st.platforms.some((x) => x.mode === 'load');
          const full = s.rule === 'TDD_FullyLoadUnload';
          return { id: newId('stop'), stationId: st.id, waitS: s.waitS, condition: full ? (loads ? 'fully-loaded' : 'fully-unloaded') : 'none', transfer: 'all', itemIds: [] };
        }),
      };
    }
    const consist = t.vehicles.map((v) => (v.kind === 'locomotive' ? { kind: 'locomotive' as const, reversed: v.reversed } : { kind: 'wagon' as const, cargo: v.type.includes('Fluid') ? ('liquid' as const) : ('solid' as const) }));
    if (!consist.length) return;
    const id = newId('train');
    p.trains[id] = { id, networkId, name, color: '#d04040', consist, timetableId, startSegmentId: null };
    report.trains++;
  });
  report.railNodes = Object.keys(p.railNodes).length;
}
