/**
 * Automatisch verbinden: Die Gebäude stehen schon (von Hand gesetzt), Bänder,
 * Rohre, Splitter, Zusammenführungen und Rohrkreuzungen legt der Planer an.
 *
 * Verfahren:
 * 1. Bedarf aus den aufgestellten Maschinen (Rezept, Takt, Somersloops bzw.
 *    Gewinnung): je Gegenstand die freien Ausgänge (Quellen) und Eingänge
 *    (Senken). Ausgänge laut Rezeptreihenfolge, Eingänge in Reihenfolge
 *    (im Spiel nimmt jeder Eingang jeden Gegenstand an).
 * 2. Je Gegenstand eine Kette (Manifold): Quellen über Zusammenführungen vor
 *    ihren Ausgängen gesammelt, dann über Splitter vor den Eingängen verteilt
 *    (Rohre: Rohrkreuzungen). Reihenfolge entlang der Richtung Quellen → Senken.
 *    Fehlt Menge bzw. bleibt etwas übrig, kommen Ein- bzw. Ausgänge (Lager,
 *    Flüssigkeitspuffer) an den Rand.
 * 3. Wege: A*-Suche auf einem 1-m-Raster mit zwei Höhen (Anschlusshöhe und
 *    4 m darüber). Gebäude und andere Leitungen auf derselben Höhe sind
 *    Hindernisse (mit 1 m Abstand), ein Wechsel der Höhe ist ein Lift. So
 *    kreuzen sich keine Leitungen auf gleicher Höhe.
 *
 * Bestehende Leitungen bleiben unverändert. Gegenstände, deren Anschlüsse
 * schon teilweise verbunden sind, werden übersprungen (Hinweis).
 */
import type { GameDataIndex, GdBuilding } from '../gamedata/index.ts';
import { add, dist, dot, normalize, rectOf, rotate, scale, sub, type Rect, type Vec2 } from '../geometry/index.ts';
import { tr } from '../i18n/index.ts';
import type { Placement, Project, Vec3 } from '../model/schema.ts';
import { machineRates } from '../production/machine.ts';
import { addBuilding, addLink } from '../project/ops/factory.ts';
import { outputPortAssignment } from './flow.ts';
import { buildingHeight, buildingOutline } from './geometry.ts';
import { linkPath } from './linkPath.ts';
import { portDefs, worldPorts, type WorldPort } from './ports.ts';

export interface AutoConnectOptions {
  /** Höchste Band- bzw. Rohrstufe (Gebäudetyp). */
  beltTier: string;
  pipeTier: string;
  /** Ein- und Ausgänge (Lager, Flüssigkeitspuffer) für fehlende bzw. überschüssige Mengen anlegen. */
  terminals: boolean;
}

export interface AutoConnectResult {
  linkIds: string[];
  buildingIds: string[];
  counts: { links: number; splitters: number; mergers: number; junctions: number; terminals: number; lifts: number; unrouted: number; items: number };
  notes: string[];
}

const SPLITTER = 'Build_ConveyorAttachmentSplitter_C';
const MERGER = 'Build_ConveyorAttachmentMerger_C';
const JUNCTION = 'Build_PipelineJunction_Cross_C';
const STORAGE = 'Build_StorageContainerMk1_C';
const FLUID_BUFFER = 'Build_PipeStorageTank_C';
/** Höhe der Leitungen über dem Boden: Bänder wie die Maschinenanschlüsse, Rohre wie Rohranschlüsse. */
const BELT_H = 1;
const PIPE_H = 1.75;
/** Zweite Ebene für Kreuzungen. */
const OVER = 4;
const EPS = 1e-6;
const R4 = [0, 90, 180, 270];

interface End {
  buildingId: string;
  portId: string;
  port: WorldPort;
  perMin: number;
  floorId: string;
}

interface Node {
  buildingId: string;
  /** Anschluss zum Vorgänger bzw. Nachfolger in der Kette. */
  inPort: string;
  outPort: string;
  /** Anschluss zur Maschine. */
  sidePort: string;
}

const isFluid = (gd: GameDataIndex, item: string) => (gd.item(item)?.form ?? 'solid') !== 'solid';

/** Drehung (Himmelsrichtung), bei der ein Anschluss in Richtung `want` zeigt. */
function rotationFacing(def: GdBuilding, portId: string, want: Vec2): number {
  const port = portDefs(def).find((q) => q.id === portId)!;
  let best = 0;
  let score = -Infinity;
  for (const r of R4) {
    const s = dot(rotate(port.normal, r), want);
    if (s > score + EPS) {
      score = s;
      best = r;
    }
  }
  return best;
}

function placedRect(def: GdBuilding, placement: Pick<Placement, 'x' | 'y' | 'rotationDeg' | 'vertical'>, grow = 0): Rect {
  const r = rectOf(buildingOutline(def, placement));
  return { minX: r.minX - grow, minY: r.minY - grow, maxX: r.maxX + grow, maxY: r.maxY + grow };
}

const inRect = (r: Rect, q: Vec2) => q.x > r.minX + EPS && q.x < r.maxX - EPS && q.y > r.minY + EPS && q.y < r.maxY - EPS;
const overlaps = (a: Rect, b: Rect) => a.minX < b.maxX - EPS && b.minX < a.maxX - EPS && a.minY < b.maxY - EPS && b.minY < a.maxY - EPS;

/** Abstand vom Anschluss entlang seiner Richtung bis außerhalb des (vergrößerten) Gebäudeumrisses. */
function exitDistance(port: WorldPort, rect: Rect): number {
  let t = 0;
  while (t < 30 && inRect(rect, add(port.world, scale(port.worldNormal, t)))) t += 0.25;
  return t;
}

// ---------------------------------------------------------------------------
// Raster und Wegsuche
// ---------------------------------------------------------------------------

class Router {
  readonly minX: number;
  readonly minY: number;
  readonly w: number;
  readonly h: number;
  /** Gebäude je Ebene (0 = Anschlusshöhe, 1 = darüber). */
  private blocked: [Uint8Array, Uint8Array];
  /** Belegung durch Leitungen je Ebene: Nummer der Leitung + 1. */
  private occ: [Int32Array, Int32Array];

  constructor(bounds: Rect) {
    this.minX = Math.floor(bounds.minX);
    this.minY = Math.floor(bounds.minY);
    this.w = Math.ceil(bounds.maxX) - this.minX + 1;
    this.h = Math.ceil(bounds.maxY) - this.minY + 1;
    const n = this.w * this.h;
    this.blocked = [new Uint8Array(n), new Uint8Array(n)];
    this.occ = [new Int32Array(n), new Int32Array(n)];
  }

  cell(q: Vec2): number | null {
    const ix = Math.round(q.x) - this.minX;
    const iy = Math.round(q.y) - this.minY;
    return ix < 0 || iy < 0 || ix >= this.w || iy >= this.h ? null : iy * this.w + ix;
  }

  pos(c: number): Vec2 {
    return { x: (c % this.w) + this.minX, y: Math.floor(c / this.w) + this.minY };
  }

  blockRect(r: Rect, layers: (0 | 1)[]): void {
    for (let y = Math.ceil(r.minY); y <= Math.floor(r.maxY); y++)
      for (let x = Math.ceil(r.minX); x <= Math.floor(r.maxX); x++) {
        const c = this.cell({ x, y });
        if (c !== null) for (const l of layers) this.blocked[l][c] = 1;
      }
  }

  /** Strecke (waagrecht) auf einer Ebene als belegt markieren. */
  markSegment(a: Vec2, b: Vec2, layer: 0 | 1, id: number): void {
    const n = Math.max(1, Math.ceil(dist(a, b) * 2));
    for (let i = 0; i <= n; i++) {
      const c = this.cell(add(a, scale(sub(b, a), i / n)));
      if (c !== null && this.occ[layer][c] === 0) this.occ[layer][c] = id;
    }
  }

  markPoint(q: Vec2, layers: (0 | 1)[], id: number): void {
    const c = this.cell(q);
    if (c !== null) for (const l of layers) if (this.occ[l][c] === 0) this.occ[l][c] = id;
  }

  private free(c: number, layer: 0 | 1, id: number, near: (c: number) => boolean, endpoint = false): boolean {
    if (this.blocked[layer][c] && !endpoint) return false;
    const o = this.occ[layer][c];
    if (o !== 0 && o !== id) return false;
    if (near(c)) return true;
    // 1 m Abstand zu anderen Leitungen auf derselben Ebene
    const x = c % this.w;
    for (const d of [-1, 1, -this.w, this.w]) {
      if ((d === -1 && x === 0) || (d === 1 && x === this.w - 1)) continue;
      const k = c + d;
      if (k < 0 || k >= this.occ[layer].length) continue;
      const v = this.occ[layer][k];
      if (v !== 0 && v !== id) return false;
    }
    return true;
  }

  /**
   * Kürzester Weg von `start` nach `goal` (Zellen), beginnend und endend auf
   * Ebene 0. Liefert die Zellfolge mit Ebene; `null`, wenn keiner gefunden wurde.
   */
  route(start: number, goal: number, id: number, startLayer: 0 | 1 = 0, goalLayer: 0 | 1 = 0): { c: number; l: 0 | 1 }[] | null {
    const W = this.w;
    const n = this.w * this.h;
    const near = (c: number) => {
      const dx = (k: number) => Math.abs((c % W) - (k % W)) + Math.abs(Math.floor(c / W) - Math.floor(k / W));
      return dx(start) <= 2 || dx(goal) <= 2;
    };
    // Zustand: Zelle × Ebene × Richtung (0–3, 4 = Anfang)
    const key = (c: number, l: number, d: number) => (c * 2 + l) * 5 + d;
    const g = new Float64Array(n * 10).fill(Infinity);
    const prev = new Int32Array(n * 10).fill(-1);
    const gx = goal % W;
    const gy = Math.floor(goal / W);
    const hOf = (c: number) => Math.abs((c % W) - gx) + Math.abs(Math.floor(c / W) - gy);
    // Binärer Heap über (f, Zustand)
    const heap: number[] = [];
    const fval: number[] = [];
    const push = (s: number, f: number) => {
      heap.push(s);
      fval.push(f);
      let i = heap.length - 1;
      while (i > 0) {
        const p = (i - 1) >> 1;
        if (fval[p]! <= fval[i]!) break;
        [heap[p], heap[i]] = [heap[i]!, heap[p]!];
        [fval[p], fval[i]] = [fval[i]!, fval[p]!];
        i = p;
      }
    };
    const pop = (): number => {
      const top = heap[0]!;
      const lastS = heap.pop()!;
      const lastF = fval.pop()!;
      if (heap.length) {
        heap[0] = lastS;
        fval[0] = lastF;
        let i = 0;
        for (;;) {
          const a = 2 * i + 1;
          const b = a + 1;
          let m = i;
          if (a < heap.length && fval[a]! < fval[m]!) m = a;
          if (b < heap.length && fval[b]! < fval[m]!) m = b;
          if (m === i) break;
          [heap[m], heap[i]] = [heap[i]!, heap[m]!];
          [fval[m], fval[i]] = [fval[i]!, fval[m]!];
          i = m;
        }
      }
      return top;
    };
    // Start und Ziel liegen knapp vor dem Gebäude: von der Gebäudesperre ausgenommen
    const isEnd = (c: number) => c === start || c === goal;
    if (!this.free(start, startLayer, id, near, true) || !this.free(goal, goalLayer, id, near, true)) return null;
    const s0 = key(start, startLayer, 4);
    g[s0] = 0;
    push(s0, hOf(start));
    const steps = [1, W, -1, -W];
    let expanded = 0;
    while (heap.length && expanded++ < 400_000) {
      const s = pop();
      const d = s % 5;
      const l = (Math.floor(s / 5) % 2) as 0 | 1;
      const c = Math.floor(s / 10);
      const gs = g[s]!;
      if (c === goal && l === goalLayer) {
        const out: { c: number; l: 0 | 1 }[] = [];
        for (let k = s; k >= 0; k = prev[k]!) out.push({ c: Math.floor(k / 10), l: (Math.floor(k / 5) % 2) as 0 | 1 });
        return out.reverse();
      }
      const relax = (c2: number, l2: 0 | 1, d2: number, cost: number) => {
        const s2 = key(c2, l2, d2);
        if (gs + cost < g[s2]! - EPS) {
          g[s2] = gs + cost;
          prev[s2] = s;
          push(s2, gs + cost + hOf(c2) + (l2 !== goalLayer ? 3 : 0));
        }
      };
      for (let k = 0; k < 4; k++) {
        const x = c % W;
        if ((k === 0 && x === W - 1) || (k === 2 && x === 0)) continue;
        const c2 = c + steps[k]!;
        if (c2 < 0 || c2 >= n || !this.free(c2, l, id, near, isEnd(c2))) continue;
        relax(c2, l, k, 1 + (d !== 4 && d !== k ? 0.6 : 0) + (l === 1 ? 0.15 : 0));
      }
      // Lift: Ebene wechseln, wenn beide Ebenen frei sind
      const l2 = (1 - l) as 0 | 1;
      if (this.free(c, l2, id, near, isEnd(c))) relax(c, l2, d, 3);
    }
    return null;
  }
}

// ---------------------------------------------------------------------------
// Hauptfunktion
// ---------------------------------------------------------------------------

export function autoConnect(p: Project, gd: GameDataIndex, factoryId: string, opts: AutoConnectOptions): AutoConnectResult {
  const result: AutoConnectResult = {
    linkIds: [],
    buildingIds: [],
    counts: { links: 0, splitters: 0, mergers: 0, junctions: 0, terminals: 0, lifts: 0, unrouted: 0, items: 0 },
    notes: [],
  };
  const notes = new Set<string>();
  const factory = p.factories[factoryId];
  if (!factory) return result;
  const placed = Object.values(p.buildings).filter((b) => b.factoryId === factoryId && b.placement);
  const connected = new Set<string>();
  for (const l of Object.values(p.links)) {
    if (l.factoryId !== factoryId) continue;
    connected.add(`${l.from.buildingId}|${l.from.portId}`);
    connected.add(`${l.to.buildingId}|${l.to.portId}`);
  }

  // --- 1. Quellen und Senken je Gegenstand ---
  const sources = new Map<string, End[]>();
  const sinks = new Map<string, End[]>();
  const touched = new Set<string>();
  for (const b of placed) {
    const def = gd.building(b.type);
    if (!def) continue;
    const rates = machineRates(gd, b);
    if (!rates.inputs.length && !rates.outputs.length) continue;
    const ports = worldPorts(b, def, p.floors[b.placement!.floorId]);
    const outMap = outputPortAssignment(
      gd,
      def,
      rates.outputs.map((o) => ({ itemId: o.item, perMin: o.perMin })),
    );
    for (const [portId, r] of outMap) {
      if (r.perMin <= EPS) continue;
      if (connected.has(`${b.id}|${portId}`)) {
        touched.add(r.itemId);
        continue;
      }
      const port = ports.find((q) => q.id === portId)!;
      sources.set(r.itemId, [...(sources.get(r.itemId) ?? []), { buildingId: b.id, portId, port, perMin: r.perMin, floorId: b.placement!.floorId }]);
    }
    const beltIn = ports.filter((q) => q.kind === 'belt' && q.direction === 'in' && q.role !== 'fuel');
    const pipeIn = ports.filter((q) => q.kind === 'pipe' && (q.direction === 'in' || q.direction === 'any') && !outMap.has(q.id));
    let bi = 0;
    let pi = 0;
    for (const r of rates.inputs) {
      const port = isFluid(gd, r.item) ? pipeIn[pi++] : beltIn[bi++];
      if (!port || r.perMin <= EPS) continue;
      if (connected.has(`${b.id}|${port.id}`)) {
        touched.add(r.item);
        continue;
      }
      sinks.set(r.item, [...(sinks.get(r.item) ?? []), { buildingId: b.id, portId: port.id, port, perMin: r.perMin, floorId: b.placement!.floorId }]);
    }
  }

  // --- Raster: Gebäude als Hindernisse, bestehende Leitungen als belegt ---
  const floorOf = (id: string) => p.floors[id];
  const rects = new Map<string, Rect>();
  for (const b of placed) {
    const def = gd.building(b.type);
    if (def) rects.set(b.id, placedRect(def, b.placement!));
  }
  const all = [...rects.values()];
  if (!all.length) return result;
  const box = all.reduce((a, r) => ({ minX: Math.min(a.minX, r.minX), minY: Math.min(a.minY, r.minY), maxX: Math.max(a.maxX, r.maxX), maxY: Math.max(a.maxY, r.maxY) }));
  const routers = new Map<string, Router>();
  const routerFor = (floorId: string): Router => {
    let r = routers.get(floorId);
    if (r) return r;
    r = new Router({ minX: box.minX - 40, minY: box.minY - 40, maxX: box.maxX + 40, maxY: box.maxY + 40 });
    routers.set(floorId, r);
    return r;
  };
  let linkNo = 0;
  const elevation = (floorId: string) => floorOf(floorId)?.elevationM ?? 0;
  const blockBuilding = (id: string) => {
    const b = p.buildings[id]!;
    const def = gd.building(b.type)!;
    const r = routerFor(b.placement!.floorId);
    const top = b.placement!.zOffsetM + buildingHeight(def, b.placement);
    r.blockRect(placedRect(def, b.placement!, 0.5), top > BELT_H + OVER - 1 ? [0, 1] : [0]);
  };
  for (const b of placed) blockBuilding(b.id);
  const markLink = (linkId: string, no: number) => {
    const l = p.links[linkId]!;
    const fb = p.buildings[l.from.buildingId]?.placement?.floorId;
    if (!fb) return;
    const r = routerFor(fb);
    const base = elevation(fb);
    const path = linkPath(p, gd, l) ?? [];
    const layerOf = (z: number): 0 | 1 | null => {
      const h = z - base;
      return h < BELT_H + OVER / 2 + 0.5 ? 0 : h < BELT_H + OVER + 2 ? 1 : null;
    };
    for (let i = 1; i < path.length; i++) {
      const a = path[i - 1]!;
      const b = path[i]!;
      if (dist(a, b) < EPS) {
        // Lift: alle Ebenen dazwischen
        const lo = Math.min(a.z, b.z) - base;
        const hi = Math.max(a.z, b.z) - base;
        r.markPoint(a, [...(lo < BELT_H + OVER / 2 ? [0 as const] : []), ...(hi > BELT_H + OVER / 2 ? [1 as const] : [])], no);
        continue;
      }
      const la = layerOf(a.z);
      const lb = layerOf(b.z);
      if (la !== null) r.markSegment(a, b, la, no);
      if (lb !== null && lb !== la) r.markSegment(a, b, lb, no);
    }
  };
  for (const l of Object.values(p.links)) if (l.factoryId === factoryId) markLink(l.id, ++linkNo);

  // --- Knoten (Splitter, Zusammenführungen, Rohrkreuzungen, Ein-/Ausgänge) setzen ---
  const occupied: { floorId: string; rect: Rect }[] = placed.map((b) => ({ floorId: b.placement!.floorId, rect: rects.get(b.id)! })).filter((x) => x.rect);
  const freeAt = (floorId: string, r: Rect) => !occupied.some((o) => o.floorId === floorId && overlaps(o.rect, r));
  const place = (type: string, floorId: string, at: Vec2, rotationDeg: number, zOffsetM: number, label = ''): string => {
    const id = addBuilding(p, gd, { factoryId, type, placement: { floorId, x: round(at.x), y: round(at.y), zOffsetM, rotationDeg }, label });
    const def = gd.building(type)!;
    const r = placedRect(def, p.buildings[id]!.placement!);
    occupied.push({ floorId, rect: r });
    rects.set(id, r);
    blockBuilding(id);
    result.buildingIds.push(id);
    return id;
  };
  const portsOf = (id: string) => {
    const b = p.buildings[id]!;
    return worldPorts(b, gd.building(b.type)!, floorOf(b.placement!.floorId));
  };

  /** Knoten vor einem Maschinenanschluss: Seitenanschluss zur Maschine, Kette quer dazu. */
  const nodeBefore = (end: End, kind: 'merger' | 'splitter' | 'junction', towardNext: Vec2): Node | null => {
    const type = kind === 'merger' ? MERGER : kind === 'splitter' ? SPLITTER : JUNCTION;
    const def = gd.building(type)!;
    const n = end.port.worldNormal;
    const own = placedRect(gd.building(p.buildings[end.buildingId]!.type)!, p.buildings[end.buildingId]!.placement!, 0.5);
    const half = Math.max(def.bounds!.maxX, def.bounds!.maxY);
    const base = exitDistance(end.port, own) + half + 1.5;
    // Kette quer zur Anschlussrichtung, so nah wie möglich an der gewünschten Richtung
    const perp = Math.abs(dot(towardNext, { x: -n.y, y: n.x })) > EPS ? normalize(scale({ x: -n.y, y: n.x }, Math.sign(dot(towardNext, { x: -n.y, y: n.x })))) : { x: -n.y, y: n.x };
    let rot = 0;
    let sidePort = '';
    let inPort = '';
    let outPort = '';
    if (kind !== 'junction') {
      // Drehung: Ausgang (Zusammenführung) bzw. Eingang gegen die Kette (Splitter) entlang `perp`
      const chainPort = kind === 'merger' ? 'belt-out-0' : 'belt-in-0';
      rot = rotationFacing(def, chainPort, kind === 'merger' ? perp : scale(perp, -1));
    }
    for (let extra = 0; extra <= 8; extra++) {
      const at = add(end.port.world, scale(n, base + extra));
      const pl = { x: round(at.x), y: round(at.y), rotationDeg: rot };
      if (!freeAt(end.floorId, placedRect(def, pl))) continue;
      const z = end.port.world.z - elevation(end.floorId);
      const id = place(type, end.floorId, at, rot, z);
      const ports = portsOf(id);
      const facing = (want: Vec2, dirs: string[], skip: string[] = []) =>
        ports.filter((q) => dirs.includes(q.direction) && !skip.includes(q.id)).sort((a, b) => dot(b.worldNormal, want) - dot(a.worldNormal, want))[0]!.id;
      if (kind === 'junction') {
        sidePort = facing(scale(n, -1), ['any']);
        outPort = facing(perp, ['any'], [sidePort]);
        inPort = facing(scale(perp, -1), ['any'], [sidePort, outPort]);
      } else if (kind === 'merger') {
        sidePort = facing(scale(n, -1), ['in']);
        outPort = 'belt-out-0';
        inPort = facing(scale(perp, -1), ['in'], [sidePort]);
      } else {
        sidePort = facing(scale(n, -1), ['out']);
        inPort = 'belt-in-0';
        outPort = facing(perp, ['out'], [sidePort]);
      }
      if (kind === 'merger') result.counts.mergers++;
      else if (kind === 'splitter') result.counts.splitters++;
      else result.counts.junctions++;
      return { buildingId: id, inPort, outPort, sidePort };
    }
    notes.add(tr('Kein Platz für einen Knoten vor {name} – Anschluss übersprungen.', { name: gd.name(p.buildings[end.buildingId]!.type) }));
    return null;
  };

  // --- Leitungen anlegen und verlegen ---
  const tierFor = (kind: 'belt' | 'pipe', perMin: number) => {
    const list = kind === 'belt' ? gd.beltTiers : gd.pipeTiers;
    const maxIdx = Math.max(0, list.findIndex((t) => t.id === (kind === 'belt' ? opts.beltTier : opts.pipeTier)));
    const allowed = list.slice(0, maxIdx + 1);
    const cap = (t: GdBuilding) => (kind === 'belt' ? t.conveyor!.itemsPerMin : t.pipe!.m3PerMin);
    const hit = allowed.find((t) => cap(t) >= perMin - 1e-6);
    if (!hit) notes.add(tr('Durchsatz {n}/min über der höchsten gewählten Stufe – mit {tier} verlegt.', { n: Math.round(perMin * 10) / 10, tier: gd.name(allowed.at(-1)!.id) }));
    return (hit ?? allowed.at(-1)!).id;
  };
  // Erst alle Knoten setzen, dann alle Wege verlegen (kurze zuerst), damit kein Knoten auf einer schon verlegten Leitung landet
  type Ref = { buildingId: string; portId: string };
  const pending: { kind: 'belt' | 'pipe'; perMin: number; from: Ref; to: Ref }[] = [];
  const connect = (kind: 'belt' | 'pipe', perMin: number, from: Ref, to: Ref) => pending.push({ kind, perMin, from, to });
  const lay = (kind: 'belt' | 'pipe', perMin: number, from: Ref, to: Ref) => {
    const pf = portsOf(from.buildingId).find((q) => q.id === from.portId)!;
    const pt = portsOf(to.buildingId).find((q) => q.id === to.portId)!;
    const floorId = p.buildings[from.buildingId]!.placement!.floorId;
    const r = routerFor(floorId);
    const base = elevation(floorId);
    const laneZ = (l: 0 | 1) => base + (kind === 'pipe' ? PIPE_H : BELT_H) + l * OVER;
    const exitOf = (q: WorldPort, buildingId: string) => add(q.world, scale(q.worldNormal, Math.max(1, exitDistance(q, placedRect(gd.building(p.buildings[buildingId]!.type)!, p.buildings[buildingId]!.placement!, 0.5)) + 1)));
    const a = exitOf(pf, from.buildingId);
    const b = exitOf(pt, to.buildingId);
    const ca = r.cell(a);
    const cb = r.cell(b);
    const no = ++linkNo;
    // Knoten direkt vor dem Anschluss: kurze gerade Leitung ohne Wegsuche
    const close = dist(a, b) < 2.5;
    const cells = !close && ca !== null && cb !== null ? r.route(ca, cb, no) : null;
    const wps: Vec3[] = [];
    if (close) {
      if (Math.abs(a.x - b.x) > EPS && Math.abs(a.y - b.y) > EPS) wps.push({ x: a.x, y: a.y, z: pf.world.z }, { x: Math.abs(pf.worldNormal.x) > 0.5 ? b.x : a.x, y: Math.abs(pf.worldNormal.x) > 0.5 ? a.y : b.y, z: pf.world.z });
      r.markSegment(a, b, 0, no);
    } else if (cells) {
      const pa = r.pos(cells[0]!.c);
      const zA = pf.world.z;
      wps.push({ x: a.x, y: a.y, z: zA });
      // Versatz auf das Raster (höchstens 0,5 m) in Austrittsrichtung beibehalten
      if (Math.abs(pa.x - a.x) > EPS || Math.abs(pa.y - a.y) > EPS) {
        const along = Math.abs(pf.worldNormal.x) > 0.5 ? { x: pa.x, y: a.y } : { x: a.x, y: pa.y };
        wps.push({ ...along, z: zA }, { ...pa, z: zA });
      }
      if (Math.abs(zA - laneZ(0)) > EPS) wps.push({ ...pa, z: laneZ(0) });
      for (let i = 1; i < cells.length; i++) {
        const prev = cells[i - 1]!;
        const cur = cells[i]!;
        const q = r.pos(cur.c);
        if (cur.c === prev.c) {
          // Lift
          wps.push({ ...q, z: laneZ(prev.l) }, { ...q, z: laneZ(cur.l) });
          result.counts.lifts++;
          continue;
        }
        const next = cells[i + 1];
        const straight = next && next.c !== cur.c && next.l === cur.l && r.pos(next.c).x - q.x === q.x - r.pos(prev.c).x && r.pos(next.c).y - q.y === q.y - r.pos(prev.c).y;
        if (!straight) wps.push({ ...q, z: laneZ(cur.l) });
      }
      const pb = r.pos(cells.at(-1)!.c);
      const zB = pt.world.z;
      if (Math.abs(zB - laneZ(0)) > EPS) wps.push({ ...pb, z: zB });
      if (Math.abs(pb.x - b.x) > EPS || Math.abs(pb.y - b.y) > EPS) {
        const along = Math.abs(pt.worldNormal.x) > 0.5 ? { x: pb.x, y: b.y } : { x: b.x, y: pb.y };
        wps.push({ ...along, z: zB });
      }
      wps.push({ x: b.x, y: b.y, z: zB });
      for (const x of cells) r.markPoint(r.pos(x.c), [x.l], no);
      // Lifte belegen beide Ebenen
      for (let i = 1; i < cells.length; i++) if (cells[i]!.c === cells[i - 1]!.c) r.markPoint(r.pos(cells[i]!.c), [0, 1], no);
    } else {
      result.counts.unrouted++;
      notes.add(tr('{n} Verbindungen ohne freien Weg – direkt verlegt, bitte von Hand nacharbeiten.', { n: result.counts.unrouted }));
    }
    const id = addLink(p, gd, { kind, tier: tierFor(kind, perMin), from, to, waypoints: dedupe(wps), routing: 'direct' });
    result.linkIds.push(id);
    result.counts.links++;
  };

  // --- 2. Ketten je Gegenstand ---
  const items = [...new Set([...sources.keys(), ...sinks.keys()])].sort((a, b) => gd.name(a).localeCompare(gd.name(b)));
  // Ein- und Ausgänge stehen links bzw. rechts neben allem
  let entryY = box.minY;
  let exitY = box.minY;
  const firstFloor = factory.floorIds[0]!;
  for (const item of items) {
    if (touched.has(item)) {
      notes.add(tr('{item}: Anschlüsse schon teilweise verbunden – übersprungen.', { item: gd.name(item) }));
      continue;
    }
    const kind: 'belt' | 'pipe' = isFluid(gd, item) ? 'pipe' : 'belt';
    const src = [...(sources.get(item) ?? [])];
    const dst = [...(sinks.get(item) ?? [])];
    const supply = src.reduce((s, e) => s + e.perMin, 0);
    const demand = dst.reduce((s, e) => s + e.perMin, 0);
    // Fehlende bzw. überschüssige Menge über Ein- und Ausgänge
    const terminal = (dir: 'in' | 'out', amount: number) => {
      const type = kind === 'pipe' ? FLUID_BUFFER : STORAGE;
      const def = gd.building(type)!;
      const portId = kind === 'pipe' ? (dir === 'in' ? 'pipe-out-0' : 'pipe-in-0') : dir === 'in' ? 'belt-out-0' : 'belt-in-0';
      const rot = rotationFacing(def, portId, { x: dir === 'in' ? 1 : -1, y: 0 });
      const rr = placedRect(def, { x: 0, y: 0, rotationDeg: rot });
      const floorId = (dir === 'in' ? dst[0] : src[0])?.floorId ?? firstFloor;
      let y = dir === 'in' ? entryY : exitY;
      const x = dir === 'in' ? box.minX - 12 - rr.maxX : box.maxX + 12 - rr.minX;
      while (!freeAt(floorId, { minX: x + rr.minX, maxX: x + rr.maxX, minY: y + rr.minY - 1, maxY: y + rr.maxY + 1 })) y += 2;
      const label = dir === 'in' ? tr('Eingang: {item}', { item: gd.name(item) }) : tr('Ausgang: {item}', { item: gd.name(item) });
      const id = place(type, floorId, { x, y: y - rr.minY }, rot, 0, label);
      if (dir === 'in') entryY = y + (rr.maxY - rr.minY) + 4;
      else exitY = y + (rr.maxY - rr.minY) + 4;
      result.counts.terminals++;
      const port = portsOf(id).find((q) => q.id === portId)!;
      return { buildingId: id, portId, port, perMin: amount, floorId } satisfies End;
    };
    if (demand > supply + 1e-6) {
      if (opts.terminals) src.push(terminal('in', demand - supply));
      else if (dst.length) notes.add(tr('{item}: {n}/min fehlen (keine Eingänge angelegt).', { item: gd.name(item), n: Math.round((demand - supply) * 10) / 10 }));
    }
    if (supply > demand + 1e-6) {
      if (opts.terminals) dst.push(terminal('out', supply - demand));
      else if (src.length) notes.add(tr('{item}: {n}/min übrig (keine Ausgänge angelegt).', { item: gd.name(item), n: Math.round((supply - demand) * 10) / 10 }));
    }
    if (!src.length || !dst.length) continue;
    result.counts.items++;
    // Reihenfolge entlang der Flussrichtung
    const centroid = (es: End[]) => scale(es.reduce((s, e) => add(s, e.port.world), { x: 0, y: 0 }), 1 / es.length);
    const cs = centroid(src);
    const cd = centroid(dst);
    let u = normalize(sub(cd, cs));
    if (Math.abs(u.x) < EPS && Math.abs(u.y) < EPS) u = { x: 1, y: 0 };
    src.sort((a, b) => dot(a.port.world, u) - dot(b.port.world, u));
    dst.sort((a, b) => dot(a.port.world, u) - dot(b.port.world, u));

    // Kette: erste Quelle direkt, weitere über Zusammenführungen; Senken über Splitter, letzte direkt
    let current: { buildingId: string; portId: string } = { buildingId: src[0]!.buildingId, portId: src[0]!.portId };
    let flow = src[0]!.perMin;
    for (let i = 1; i < src.length; i++) {
      const e = src[i]!;
      const toward = normalize(sub(i + 1 < src.length ? src[i + 1]!.port.world : cd, e.port.world));
      const node = nodeBefore(e, kind === 'pipe' ? 'junction' : 'merger', toward);
      if (!node) continue;
      connect(kind, flow, current, { buildingId: node.buildingId, portId: node.inPort });
      connect(kind, e.perMin, { buildingId: e.buildingId, portId: e.portId }, { buildingId: node.buildingId, portId: node.sidePort });
      flow += e.perMin;
      current = { buildingId: node.buildingId, portId: node.outPort };
    }
    for (let j = 0; j < dst.length; j++) {
      const e = dst[j]!;
      if (j === dst.length - 1) {
        connect(kind, flow, current, { buildingId: e.buildingId, portId: e.portId });
        break;
      }
      const toward = normalize(sub(dst[j + 1]!.port.world, e.port.world));
      const node = nodeBefore(e, kind === 'pipe' ? 'junction' : 'splitter', toward);
      if (!node) continue;
      connect(kind, flow, current, { buildingId: node.buildingId, portId: node.inPort });
      connect(kind, e.perMin, { buildingId: node.buildingId, portId: node.sidePort }, { buildingId: e.buildingId, portId: e.portId });
      flow = Math.max(0, flow - e.perMin);
      current = { buildingId: node.buildingId, portId: node.outPort };
    }
  }
  const portAt = (r: Ref) => portsOf(r.buildingId).find((q) => q.id === r.portId)!.world;
  const span = (t: (typeof pending)[number]) => {
    const a = portAt(t.from);
    const b = portAt(t.to);
    return Math.abs(a.x - b.x) + Math.abs(a.y - b.y);
  };
  for (const t of pending.sort((x, y) => span(x) - span(y))) lay(t.kind, t.perMin, t.from, t.to);
  result.notes = [...notes];
  return result;
}

const round = (v: number) => Math.round(v * 2) / 2;

/** Aufeinanderfolgende gleiche Punkte entfernen. */
function dedupe(pts: Vec3[]): Vec3[] {
  const out: Vec3[] = [];
  for (const q of pts) {
    const l = out.at(-1);
    if (!l || Math.abs(l.x - q.x) > EPS || Math.abs(l.y - q.y) > EPS || Math.abs(l.z - q.z) > EPS) out.push(q);
  }
  return out;
}
