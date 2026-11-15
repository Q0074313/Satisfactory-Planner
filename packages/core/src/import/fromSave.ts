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
  return rectOf(buildingOutline(def, { x: b.x, y: b.y, rotationDeg: b.yawDeg }));
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

const ANCHOR = new Set(['production', 'extraction', 'power', 'storage']);

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
  const parent = list.map((_, i) => i);
  const find = (i: number): number => (parent[i] === i ? i : (parent[i] = find(parent[i]!)));
  const union = (a: number, b: number) => {
    const ra = find(a);
    const rb = find(b);
    if (ra !== rb) parent[ra] = rb;
  };
  // Verbindungen
  let longLinks = 0;
  const long: [number, number][] = [];
  for (const c of traceChains(ex, (id) => index.has(id))) {
    if (c.lengthM > o.maxLinkM) {
      long.push([index.get(c.from.id)!, index.get(c.to.id)!]);
      continue;
    }
    union(index.get(c.from.id)!, index.get(c.to.id)!);
  }
  // Bahnsteige gehören zu ihrem Bahnhof
  for (const b of list)
    for (const r of Object.values(b.platformConns)) if (r && index.has(r.id)) union(index.get(b.id)!, index.get(r.id)!);
  // Nähe (Raster für die Suche)
  const rects = list.map((b) => worldRect(defs.get(b.id)!, b));
  const cell = 64;
  const grid = new Map<string, number[]>();
  rects.forEach((r, i) => {
    for (let gx = Math.floor((r.minX - o.gapM) / cell); gx <= Math.floor((r.maxX + o.gapM) / cell); gx++)
      for (let gy = Math.floor((r.minY - o.gapM) / cell); gy <= Math.floor((r.maxY + o.gapM) / cell); gy++) {
        const k = `${gx},${gy}`;
        const cellList = grid.get(k) ?? [];
        for (const j of cellList) {
          const a = rects[j]!;
          const gapX = Math.max(0, Math.max(a.minX, r.minX) - Math.min(a.maxX, r.maxX));
          const gapY = Math.max(0, Math.max(a.minY, r.minY) - Math.min(a.maxY, r.maxY));
          if (Math.hypot(gapX, gapY) <= o.gapM && Math.abs(list[i]!.z - list[j]!.z) < o.maxDzM) union(i, j);
        }
        cellList.push(i);
        grid.set(k, cellList);
      }
  });

  // Gewinnungsposten (ohne Maschinen) gehören zu der Fabrik, die sie beliefern – auch über lange Bänder
  const producing = () => {
    const has = new Set<number>();
    list.forEach((b, i) => {
      if (defs.get(b.id)!.category === 'production' || defs.get(b.id)!.category === 'power') has.add(find(i));
    });
    return has;
  };
  for (let round = 0, changed = true; changed && round < 4; round++) {
    changed = false;
    const has = producing();
    for (const [a, b] of long) {
      const ra = find(a);
      const rb = find(b);
      if (ra === rb) continue;
      if (!has.has(ra) || !has.has(rb)) {
        union(a, b);
        changed = true;
      }
    }
  }
  for (const [a, b] of long) if (find(a) !== find(b)) longLinks++;

  const members = new Map<number, number[]>();
  list.forEach((_, i) => members.set(find(i), [...(members.get(find(i)) ?? []), i]));
  const groups: SaveGroup[] = [];
  let ungrouped = 0;
  const names = new Map<string, number>();
  for (const idx of members.values()) {
    const bs = idx.map((i) => list[i]!);
    if (!bs.some((b) => ANCHOR.has(defs.get(b.id)!.category))) {
      ungrouped += bs.length;
      continue;
    }
    const rect = idx.map((i) => rects[i]!).reduce((a, r) => ({ minX: Math.min(a.minX, r.minX), minY: Math.min(a.minY, r.minY), maxX: Math.max(a.maxX, r.maxX), maxY: Math.max(a.maxY, r.maxY) }));
    // Bilanz der Maschinen: Endprodukte = Überschuss, nach Wert (AWESOME-Punkte) geordnet
    const net = new Map<string, number>();
    const resources = new Map<string, number>();
    const counts = { buildings: bs.length, machines: 0, extractors: 0, generators: 0, storage: 0 };
    for (const b of bs) {
      const def = defs.get(b.id)!;
      if (def.category === 'extraction') counts.extractors++;
      else if (def.category === 'power') counts.generators++;
      else if (def.category === 'storage') counts.storage++;
      else if (def.category === 'production') counts.machines++;
      const node = b.node ? gd.mapNode(b.node) : undefined;
      if (def.extractor) {
        const item = node?.itemId ?? (def.nativeClass === 'FGBuildableWaterPump' ? 'Desc_Water_C' : null);
        if (item) resources.set(item, (resources.get(item) ?? 0) + 1);
        continue;
      }
      if (def.category !== 'production' || !b.recipe || !gd.recipe(b.recipe)) continue;
      const rates = machineRates(gd, { type: b.type, recipeId: b.recipe, clock: b.clock, somersloops: b.somersloops });
      for (const x of rates.outputs) net.set(x.item, (net.get(x.item) ?? 0) + x.perMin);
      for (const x of rates.inputs) net.set(x.item, (net.get(x.item) ?? 0) - x.perMin);
    }
    const value = (id: string) => gd.item(id)?.sinkPoints ?? 0;
    const finals = [...net].filter(([, v]) => v > 0.5).sort((a, b) => value(b[0]) - value(a[0]) || b[1] - a[1]).map(([id]) => id);
    const top = finals.length ? finals : [...net].sort((a, b) => b[1] - a[1]).map(([id]) => id);
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
    groups.push({
      key: bs[0]!.id,
      name: base,
      buildingIds: bs.map((b) => b.id),
      center: { x: (rect.minX + rect.maxX) / 2, y: (rect.minY + rect.maxY) / 2 },
      rect,
      counts,
      products: top.slice(0, 3),
      shapes: idx.map((i) => rects[i]!),
    });
  }
  groups.sort((a, b) => b.counts.buildings - a.counts.buildings);
  return { groups, ungrouped, longLinks };
}

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
    const separate = !cur || (lv.z - cur.level.z > SAME_FLOOR_GAP_M && (lv.water || cur.level.water || (above > 0 && above >= through)));
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
    // Ebenen bilden Maschinen, Kraftwerke und Lager; Miner stehen auf Gelände (Versatz zur Ebene darunter)
    const anchors = bs.filter((b) => cat(b) === 'production' || cat(b) === 'power' || cat(b) === 'storage');
    const item = (b: SaveBuilding) => ({ z: b.z, h: buildingHeight(gd.building(b.type)!) });
    const main = floorLevels((anchors.length ? anchors : bs.filter((b) => !isWater(b))).map(item)).map((l) => ({ ...l, kind: 'production' as const }));
    const water = floorLevels(bs.filter(isWater).map((b) => ({ z: b.z, h: 0 })))
      .filter((w) => !main.some((m) => Math.abs(m.z - w.z) < 1))
      .map((l) => ({ ...l, kind: 'production' as const, water: true }));
    // Logistikebenen: mindestens 10 Splitter, Zusammenführungen, Rohrkreuzungen u. ä. auf eigener Höhe
    const logZ = bs.filter((b) => cat(b) === 'logistics').map((b) => b.z).sort((a, b) => a - b);
    const clusters: { z: number; n: number }[] = [];
    for (const z of logZ) {
      const c = clusters.at(-1);
      if (c && z - c.z <= 3) c.n++;
      else clusters.push({ z, n: 1 });
    }
    const known = [...main, ...water];
    const logistics = clusters
      .filter((c) => c.n >= 10 && !known.some((l) => c.z >= l.z - 1 && c.z <= l.z + 4))
      .map((c) => ({ z: Math.floor(c.z * 1000) / 1000, height: DEFAULT_FLOOR_HEIGHT_M.logistics, kind: 'logistics' as const }));
    // Fundamente im Bereich der Fabrik (8 m Rand)
    const box = { minX: rect.minX - 8, minY: rect.minY - 8, maxX: rect.maxX + 8, maxY: rect.maxY + 8 };
    const mine = (raw.foundations ?? []).filter((fd, i) => !usedFoundations.has(i) && fd.x >= box.minX && fd.x <= box.maxX && fd.y >= box.minY && fd.y <= box.maxY && (usedFoundations.add(i), true));
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
      const fl = floorFor(b.z);
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
            zOffsetM: r3(b.z - fl.elevation),
            rotationDeg: r3(normalizeDeg(b.yawDeg)),
            ...(b.vertical && canBeVertical(def) ? { vertical: b.vertical } : {}),
          },
          extraction,
          // Lkw- und Tanklaster-Stationen: Be- bzw. Entladen wie im Spiel
          transfer: transferInterface(def) === 'vehicle' && b.loadMode !== null ? { mode: b.loadMode ? 'load' : 'unload', stationId: null } : null,
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
  // Leitungen zwischen Fabriken: direkte Transportaufträge (Band bzw. Rohr)
  for (const c of between) {
    const fa = idOf.get(c.from.id)!;
    const fb = idOf.get(c.to.id)!;
    const a = p.buildings[fa]!;
    const b = p.buildings[fb]!;
    const pa = portOfComp(gd.building(a.type)!, c.from.comp);
    const pb = portOfComp(gd.building(b.type)!, c.to.comp);
    const tier = c.types.map((t) => tierOf(gd, t)).find((t): t is string => !!t);
    const what = pa && pb && tier ? deliveredItem(p, gd, fa, pa, fb, c.kind) : null;
    if (!what || !tier) {
      report.linksSkipped++;
      continue;
    }
    try {
      addOrder(p, gd, {
        name: tr('{kind}: {item}', { kind: c.kind === 'belt' ? tr('Band') : tr('Rohr'), item: gd.name(what.itemId) }),
        itemId: what.itemId,
        ratePerMin: Math.round(what.perMin * 1000) / 1000,
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
 * Rohre haben im Spiel keine Richtung; der Planer rechnet in Zeichenrichtung.
 * Rohre mit Ein- bzw. Ausgang an einem Ende werden danach ausgerichtet, Rohre
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
  const out = chains.map((c) => {
    if (c.kind !== 'pipe') return c;
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

/**
 * Gegenstand und Menge einer Leitung zwischen Fabriken: aus dem liefernden
 * Ausgang (Maschine, Gewinnung), sonst aus dem empfangenden Eingang (Rezept mit
 * genau einem passenden Eingang), sonst aus der Herstellung davor (über
 * Splitter, Zusammenführungen, Lager, Pumpen; eindeutiger Gegenstand).
 */
function deliveredItem(p: Project, gd: GameDataIndex, fromId: string, fromPort: string, toId: string, kind: 'belt' | 'pipe'): { itemId: string; perMin: number } | null {
  const fluid = (item: string) => (gd.item(item)?.form ?? 'solid') !== 'solid';
  const fits = (item: string) => fluid(item) === (kind === 'pipe');
  const outputsOf = (id: string) => {
    const b = p.buildings[id]!;
    const def = gd.building(b.type);
    if (!def) return new Map<string, { itemId: string; perMin: number }>();
    return outputPortAssignment(
      gd,
      def,
      machineRates(gd, b).outputs.map((x) => ({ itemId: x.item, perMin: x.perMin })),
    );
  };
  const direct = outputsOf(fromId).get(fromPort);
  if (direct) return direct;
  const to = p.buildings[toId]!;
  const ins = machineRates(gd, to).inputs.filter((x) => fits(x.item));
  if (ins.length === 1) return { itemId: ins[0]!.item, perMin: ins[0]!.perMin };
  // Rückwärts durch die Logistik der liefernden Fabrik
  const found = new Map<string, number>();
  const seen = new Set<string>([fromId]);
  let frontier = [fromId];
  for (let depth = 0; depth < 8 && frontier.length; depth++) {
    const next: string[] = [];
    for (const l of Object.values(p.links)) {
      if (!frontier.includes(l.to.buildingId) || seen.has(l.from.buildingId)) continue;
      seen.add(l.from.buildingId);
      const out = outputsOf(l.from.buildingId).get(l.from.portId);
      if (out && fits(out.itemId)) found.set(out.itemId, (found.get(out.itemId) ?? 0) + out.perMin);
      else if (!out) next.push(l.from.buildingId);
    }
    frontier = next;
  }
  if (found.size !== 1) return null;
  const [itemId, perMin] = [...found][0]!;
  return { itemId, perMin };
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
  const heightOf = (type: string) => gd.building(type)?.foundation?.heightM ?? Number(/8x(\d)/.exec(type)?.[1] ?? 1);
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
