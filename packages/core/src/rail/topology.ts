/**
 * Gleistopologie: Fahrzustände, Durchfahrbarkeit von Knoten (Signale),
 * Blockbildung und Erreichbarkeit.
 *
 * Fahrzustand = (Segment, Richtung). Richtung `ab` heißt: Fahrt vom Ende a
 * zum Ende b. An einem Knoten fährt ein Zug immer von einer Seite zur
 * anderen (A → B = „vorwärts“ entlang der Knotenachse).
 */
import type { NodeSide, Project, RailNetwork, RailSegment, RailSignal, Station, Train } from '../model/schema.ts';
import { CROSSING_HEIGHT_TOLERANCE_M, findCrossings, otherSide, segmentLength, segmentShape, type Crossing } from './geometry.ts';

export type Dir = 'ab' | 'ba';
export interface SegEnd {
  segId: string;
  end: 'a' | 'b';
}
export interface TrackState {
  segId: string;
  dir: Dir;
}

export const stateKey = (s: TrackState) => `${s.segId}:${s.dir}`;

export interface RailGraph {
  network: RailNetwork;
  segments: Map<string, RailSegment>;
  /** Je Knoten die angeschlossenen Segmentenden pro Seite. */
  sides: Map<string, { A: SegEnd[]; B: SegEnd[] }>;
  signals: Map<string, RailSignal[]>;
  stations: Station[];
  trains: Train[];
  lengths: Map<string, number>;
}

export function buildGraph(p: Project, networkId: string): RailGraph {
  const network = p.railNetworks[networkId]!;
  const segments = new Map<string, RailSegment>();
  const sides = new Map<string, { A: SegEnd[]; B: SegEnd[] }>();
  const lengths = new Map<string, number>();
  for (const n of Object.values(p.railNodes)) if (n.networkId === networkId) sides.set(n.id, { A: [], B: [] });
  for (const s of Object.values(p.railSegments)) {
    if (s.networkId !== networkId) continue;
    segments.set(s.id, s);
    sides.get(s.a.nodeId)?.[s.a.side].push({ segId: s.id, end: 'a' });
    sides.get(s.b.nodeId)?.[s.b.side].push({ segId: s.id, end: 'b' });
    const shape = segmentShape(p, s);
    lengths.set(s.id, shape ? segmentLength(shape) : 0);
  }
  const signals = new Map<string, RailSignal[]>();
  for (const sig of Object.values(p.railSignals)) {
    if (sig.networkId !== networkId) continue;
    signals.set(sig.nodeId, [...(signals.get(sig.nodeId) ?? []), sig]);
  }
  return {
    network,
    segments,
    sides,
    signals,
    stations: Object.values(p.stations).filter((s) => s.networkId === networkId),
    trains: Object.values(p.trains).filter((t) => t.networkId === networkId),
    lengths,
  };
}

/** Knoten, an dem ein Zug im Zustand `s` ankommt, und die Ankunftsseite. */
export function arrival(g: RailGraph, s: TrackState): { nodeId: string; side: NodeSide } | null {
  const seg = g.segments.get(s.segId);
  if (!seg) return null;
  const end = s.dir === 'ab' ? seg.b : seg.a;
  return { nodeId: end.nodeId, side: end.side };
}

/**
 * Darf ein Zug den Knoten in dieser Richtung passieren? Ein Signal ohne
 * Gegenstück sperrt die Gegenrichtung (Wiki „Train Signals“: „If only one
 * signal is present, it will prevent trains in the opposite direction from
 * passing through“).
 */
export function passable(g: RailGraph, nodeId: string, fromSide: NodeSide): boolean {
  const sigs = g.signals.get(nodeId);
  if (!sigs || sigs.length === 0) return true;
  const moving = fromSide === 'A' ? 'forward' : 'backward';
  const hasWith = sigs.some((s) => s.facing === moving);
  const hasAgainst = sigs.some((s) => s.facing !== moving);
  return hasWith || !hasAgainst;
}

export interface TraverseOptions {
  ignoreSignals?: boolean;
}

export function nextStates(g: RailGraph, s: TrackState, opts: TraverseOptions = {}): TrackState[] {
  const arr = arrival(g, s);
  if (!arr) return [];
  if (!opts.ignoreSignals && !passable(g, arr.nodeId, arr.side)) return [];
  const out = g.sides.get(arr.nodeId)?.[otherSide(arr.side)] ?? [];
  return out.map((e) => ({ segId: e.segId, dir: e.end === 'a' ? 'ab' : 'ba' }));
}

// ---------------------------------------------------------------------------
// Blöcke
// ---------------------------------------------------------------------------

class UnionFind {
  parent = new Map<string, string>();
  find(x: string): string {
    let p = this.parent.get(x) ?? x;
    if (p !== x) {
      p = this.find(p);
      this.parent.set(x, p);
    }
    return p;
  }
  union(a: string, b: string) {
    const ra = this.find(a);
    const rb = this.find(b);
    if (ra !== rb) this.parent.set(ra, rb);
  }
}

export interface SignalInfo {
  signal: RailSignal;
  /** Block, in den das Signal Einfahrt gewährt (null = kein Gleis). */
  entryBlock: string | null;
  /** Block, den das Signal als Ausfahrt begrenzt (null = kein Gleis). */
  exitBlock: string | null;
}

export interface Block {
  id: string;
  segments: string[];
  entrySignals: RailSignal[];
  exitSignals: RailSignal[];
  stations: string[];
  lengthM: number;
  minZ: number;
  maxZ: number;
  isPath: boolean;
}

export interface BlockAnalysis {
  blockOf: Map<string, string>;
  blocks: Map<string, Block>;
  signalInfo: Map<string, SignalInfo>;
  crossings: Crossing[];
}

export function analyzeBlocks(p: Project, g: RailGraph): BlockAnalysis {
  const uf = new UnionFind();
  for (const id of g.segments.keys()) uf.find(id);
  for (const [nodeId, s] of g.sides) {
    for (const list of [s.A, s.B]) for (let i = 1; i < list.length; i++) uf.union(list[0]!.segId, list[i]!.segId);
    const hasSignal = (g.signals.get(nodeId)?.length ?? 0) > 0;
    if (!hasSignal && s.A.length && s.B.length) uf.union(s.A[0]!.segId, s.B[0]!.segId);
  }
  const crossings = findCrossings(p, [...g.segments.values()]);
  for (const c of crossings) if (Math.abs(c.zA - c.zB) < CROSSING_HEIGHT_TOLERANCE_M) uf.union(c.segA, c.segB);

  const blockOf = new Map<string, string>();
  const blocks = new Map<string, Block>();
  for (const id of g.segments.keys()) {
    const root = uf.find(id);
    blockOf.set(id, root);
    let b = blocks.get(root);
    if (!b) {
      b = { id: root, segments: [], entrySignals: [], exitSignals: [], stations: [], lengthM: 0, minZ: Infinity, maxZ: -Infinity, isPath: false };
      blocks.set(root, b);
    }
    b.segments.push(id);
    b.lengthM += g.lengths.get(id) ?? 0;
    const seg = g.segments.get(id)!;
    for (const nid of [seg.a.nodeId, seg.b.nodeId]) {
      const z = p.railNodes[nid]?.position.z ?? 0;
      b.minZ = Math.min(b.minZ, z);
      b.maxZ = Math.max(b.maxZ, z);
    }
    if (seg.stationId) b.stations.push(seg.stationId);
  }
  const signalInfo = new Map<string, SignalInfo>();
  for (const [nodeId, sigs] of g.signals) {
    const s = g.sides.get(nodeId);
    for (const sig of sigs) {
      const into: NodeSide = sig.facing === 'forward' ? 'B' : 'A';
      const intoSeg = s?.[into][0];
      const fromSeg = s?.[otherSide(into)][0];
      const info: SignalInfo = {
        signal: sig,
        entryBlock: intoSeg ? blockOf.get(intoSeg.segId)! : null,
        exitBlock: fromSeg ? blockOf.get(fromSeg.segId)! : null,
      };
      signalInfo.set(sig.id, info);
      if (info.entryBlock) blocks.get(info.entryBlock)!.entrySignals.push(sig);
      if (info.exitBlock) blocks.get(info.exitBlock)!.exitSignals.push(sig);
    }
  }
  for (const b of blocks.values()) b.isPath = b.entrySignals.length > 0 && b.entrySignals.every((s) => s.kind === 'path');
  return { blockOf, blocks, signalInfo, crossings };
}

// ---------------------------------------------------------------------------
// Erreichbarkeit
// ---------------------------------------------------------------------------

export function isBidirectional(t: Train): boolean {
  return t.consist.some((v) => v.kind === 'locomotive' && v.reversed);
}

export interface RouteQuery {
  fromStationId: string;
  toStationId: string;
  bidirectional: boolean;
  ignoreSignals?: boolean;
  /** Ziel in beliebiger Richtung erreichen (für die Fehlerdiagnose). */
  anyArrivalDirection?: boolean;
}

/**
 * Kann ein Zug, der an `from` angedockt ist, `to` in Halterichtung erreichen?
 * Liefert die Folge der Segmente (ohne Startsegment) oder null.
 */
export function findRoute(p: Project, g: RailGraph, q: RouteQuery): TrackState[] | null {
  const from = p.stations[q.fromStationId];
  const to = p.stations[q.toStationId];
  if (!from || !to) return null;
  const starts: TrackState[] = [{ segId: from.segmentId, dir: 'ab' }];
  if (q.bidirectional) starts.push({ segId: from.segmentId, dir: 'ba' });
  const prev = new Map<string, TrackState | null>();
  const queue: TrackState[] = [];
  for (const s of starts) {
    prev.set(stateKey(s), null);
    queue.push(s);
  }
  const isGoal = (s: TrackState) => s.segId === to.segmentId && (q.anyArrivalDirection || s.dir === 'ab');
  while (queue.length) {
    const cur = queue.shift()!;
    for (const nx of nextStates(g, cur, { ignoreSignals: q.ignoreSignals })) {
      const k = stateKey(nx);
      if (prev.has(k)) continue;
      prev.set(k, cur);
      if (isGoal(nx)) {
        const path: TrackState[] = [nx];
        let back = prev.get(k) ?? null;
        while (back && prev.get(stateKey(back)) !== null) {
          path.unshift(back);
          back = prev.get(stateKey(back)) ?? null;
        }
        return path;
      }
      queue.push(nx);
    }
  }
  return null;
}

/**
 * Gibt es eine Möglichkeit, die Fahrtrichtung umzukehren (Wendeschleife,
 * Gleisdreieck)? Gesucht wird ein Zustand, der seinen Gegenzustand erreicht.
 * Eine Umkehr ist nur über eine Weiche möglich; deshalb starten die Suchen
 * nur auf Segmenten, die an eine Weiche grenzen.
 */
export function canReverseDirection(g: RailGraph): boolean {
  const switchNodes = new Set<string>();
  for (const [nodeId, s] of g.sides) if (s.A.length > 1 || s.B.length > 1) switchNodes.add(nodeId);
  if (switchNodes.size === 0) return false;
  for (const seg of g.segments.values()) {
    if (!switchNodes.has(seg.a.nodeId) && !switchNodes.has(seg.b.nodeId)) continue;
    for (const dir of ['ab', 'ba'] as const) {
      const start: TrackState = { segId: seg.id, dir };
      const goal = stateKey({ segId: seg.id, dir: dir === 'ab' ? 'ba' : 'ab' });
      const seen = new Set([stateKey(start)]);
      const queue = [start];
      while (queue.length) {
        const cur = queue.pop()!;
        for (const nx of nextStates(g, cur, { ignoreSignals: true })) {
          const k = stateKey(nx);
          if (k === goal) return true;
          if (!seen.has(k)) {
            seen.add(k);
            queue.push(nx);
          }
        }
      }
    }
  }
  return false;
}

/** Zuglänge in Metern (Wagen und Loks je 16 m laut Wiki). */
export function trainLengthM(t: Train, vehicleLengthM = 16): number {
  return t.consist.length * vehicleLengthM;
}

// ---------------------------------------------------------------------------
// Kürzeste Wege (Dijkstra) – für Simulation und Fahrzeitschätzung
// ---------------------------------------------------------------------------

export interface WeightedRoute {
  /** Fahrzustände ab dem ersten Segment nach dem Start (ohne Startsegment). */
  states: TrackState[];
  /** Fahrstrecke in Metern vom Startbahnhof (vorn) bis zum Zielbahnhof (vorn). */
  lengthM: number;
  /** Abfahrt rückwärts (nur Zweirichtungszüge). */
  reversedStart: boolean;
}

class MinHeap<T> {
  private a: { k: number; v: T }[] = [];
  get size() {
    return this.a.length;
  }
  push(k: number, v: T) {
    const a = this.a;
    a.push({ k, v });
    let i = a.length - 1;
    while (i > 0) {
      const p = (i - 1) >> 1;
      if (a[p]!.k <= a[i]!.k) break;
      [a[p], a[i]] = [a[i]!, a[p]!];
      i = p;
    }
  }
  pop(): { k: number; v: T } | undefined {
    const a = this.a;
    const top = a[0];
    const last = a.pop();
    if (a.length && last) {
      a[0] = last;
      let i = 0;
      for (;;) {
        const l = 2 * i + 1;
        const r = l + 1;
        let m = i;
        if (l < a.length && a[l]!.k < a[m]!.k) m = l;
        if (r < a.length && a[r]!.k < a[m]!.k) m = r;
        if (m === i) break;
        [a[m], a[i]] = [a[i]!, a[m]!];
        i = m;
      }
    }
    return top;
  }
}

/**
 * Kürzester Weg von einem oder mehreren Startzuständen bis zum Zielbahnhof
 * (Einfahrt in Halterichtung). Die Länge des Startsegments zählt nicht mit.
 */
export function routeFromStates(
  g: RailGraph,
  starts: TrackState[],
  goal: Station,
  passThroughPenaltyM = 100,
): { states: TrackState[]; lengthM: number; start: TrackState } | null {
  const stationSegs = new Set(g.stations.map((s) => s.segmentId));
  const dist = new Map<string, number>();
  const prev = new Map<string, TrackState | null>();
  const heap = new MinHeap<TrackState>();
  for (const s of starts) {
    dist.set(stateKey(s), 0);
    prev.set(stateKey(s), null);
    heap.push(0, s);
  }
  while (heap.size) {
    const { k, v: cur } = heap.pop()!;
    if (k > (dist.get(stateKey(cur)) ?? Infinity)) continue;
    if (cur.segId === goal.segmentId && cur.dir === 'ab' && prev.get(stateKey(cur)) !== null) {
      const states: TrackState[] = [];
      let c: TrackState | null = cur;
      while (c && prev.get(stateKey(c)) !== null) {
        states.unshift(c);
        c = prev.get(stateKey(c)) ?? null;
      }
      return { states, lengthM: k, start: c! };
    }
    for (const nx of nextStates(g, cur)) {
      const len = g.lengths.get(nx.segId) ?? 0;
      const extra = stationSegs.has(nx.segId) && nx.segId !== goal.segmentId ? passThroughPenaltyM : 0;
      const nd = k + len + extra;
      const key = stateKey(nx);
      if (nd < (dist.get(key) ?? Infinity)) {
        dist.set(key, nd);
        prev.set(key, cur);
        heap.push(nd, nx);
      }
    }
  }
  return null;
}

/**
 * Kürzester Weg zwischen zwei Bahnhöfen nach Länge. Durchfahrene Bahnhöfe
 * kosten wie im Spiel einen Aufschlag (Wiki: 100 m). Signale werden wie in
 * {@link findRoute} beachtet. Zweirichtungszüge fahren nur dann rückwärts ab,
 * wenn vorwärts kein Weg existiert (Wiki „Train Station“).
 */
export function shortestRoute(
  p: Project,
  g: RailGraph,
  q: { fromStationId: string; toStationId: string; bidirectional: boolean; passThroughPenaltyM?: number },
): WeightedRoute | null {
  const from = p.stations[q.fromStationId];
  const to = p.stations[q.toStationId];
  if (!from || !to) return null;
  const fwd = routeFromStates(g, [{ segId: from.segmentId, dir: 'ab' }], to, q.passThroughPenaltyM);
  if (fwd) return { states: fwd.states, lengthM: fwd.lengthM, reversedStart: false };
  if (!q.bidirectional) return null;
  const rev = routeFromStates(g, [{ segId: from.segmentId, dir: 'ba' }], to, q.passThroughPenaltyM);
  return rev ? { states: rev.states, lengthM: rev.lengthM, reversedStart: true } : null;
}
