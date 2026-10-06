/**
 * Aufbereitung eines Schienennetzes für Darstellung und Trefferprüfung.
 */
import {
  analyzeNetwork,
  CROSSING_HEIGHT_TOLERANCE_M,
  geo,
  segmentPolyline,
  segmentShape,
  type NetworkAnalysis,
  type Project,
  type RailSignal,
  type Station,
  type Vec3,
} from '@satis/core';

const { add, scale, rotate, sub, normalize, dist, distToSegment, pointInPolygon, cross, dirFromDeg } = geo;

export interface RailSceneSegment {
  id: string;
  networkId: string;
  points: Vec3[];
  isStation: boolean;
}

export interface RailSceneSignal {
  signal: RailSignal;
  /** Darstellungsposition (rechts neben dem Gleis vor dem Knoten). */
  at: geo.Vec2;
  /** Fahrtrichtung, für die das Signal gilt. */
  dir: geo.Vec2;
  /** Gleisknoten, an dem das Signal steht (Haltelinie). */
  node: geo.Vec2;
}

export interface RailSceneStation {
  station: Station;
  /** Umriss Gebäude + Bahnsteige (Polygon), Gebäudeteil, Bahnsteigteile. */
  outline: geo.Vec2[];
  building: geo.Vec2[];
  platforms: geo.Vec2[][];
  dir: geo.Vec2;
  front: geo.Vec2;
}

export interface RailScene {
  networkId: string;
  segments: RailSceneSegment[];
  others: RailSceneSegment[];
  signals: RailSceneSignal[];
  stations: RailSceneStation[];
  analysis: NetworkAnalysis;
  /** Knoten des aktiven Netzes mit Seitenbelegung. */
  nodes: { id: string; pos: Vec3; headingDeg: number; a: number; b: number }[];
}

export const STATION_WIDTH_M = 34;
const UNIT = 16;

export function stationGeometry(p: Project, st: Station): RailSceneStation | null {
  const back = p.railNodes[st.backNodeId];
  const front = p.railNodes[st.frontNodeId];
  if (!back || !front) return null;
  const u = normalize(sub(front.position, back.position));
  const n = rotate(u, 90);
  const half = STATION_WIDTH_M / 2;
  const F = { x: front.position.x, y: front.position.y };
  const rect = (from: number, to: number): geo.Vec2[] => {
    const a = add(F, scale(u, -from));
    const b = add(F, scale(u, -to));
    return [add(a, scale(n, -half)), add(a, scale(n, half)), add(b, scale(n, half)), add(b, scale(n, -half))];
  };
  const total = UNIT * (1 + st.platforms.length);
  return {
    station: st,
    outline: rect(0, total),
    building: rect(0, UNIT),
    platforms: st.platforms.map((_, i) => rect(UNIT * (i + 1), UNIT * (i + 2))),
    dir: u,
    front: F,
  };
}

export function buildRailScene(p: Project, networkId: string): RailScene {
  const segments: RailSceneSegment[] = [];
  const others: RailSceneSegment[] = [];
  for (const s of Object.values(p.railSegments)) {
    const shape = segmentShape(p, s);
    if (!shape) continue;
    const c = shape.curve;
    const chord = sub(c.p3, c.p0);
    const curved = Math.abs(cross(sub(c.p1, c.p0), chord)) + Math.abs(cross(sub(c.p2, c.p0), chord)) > 1e-6;
    const entry = { id: s.id, networkId: s.networkId, points: segmentPolyline(shape, curved ? 24 : 1), isStation: !!s.stationId };
    if (s.networkId === networkId) segments.push(entry);
    else others.push(entry);
  }
  const signals: RailSceneSignal[] = [];
  for (const sig of Object.values(p.railSignals)) {
    if (sig.networkId !== networkId) continue;
    const n = p.railNodes[sig.nodeId];
    if (!n) continue;
    const d = dirFromDeg(n.headingDeg);
    const dir = sig.facing === 'forward' ? d : scale(d, -1);
    // Rechtsverkehr: Signal rechts der Fahrtrichtung, kurz vor dem Knoten
    const right = rotate(dir, 90);
    signals.push({ signal: sig, dir, node: { x: n.position.x, y: n.position.y }, at: add(add(n.position, scale(right, 5)), scale(dir, -3)) });
  }
  const stations = Object.values(p.stations)
    .filter((s) => s.networkId === networkId)
    .map((s) => stationGeometry(p, s))
    .filter((x): x is RailSceneStation => !!x);
  const analysis = analyzeNetwork(p, networkId);
  const nodes = [...analysis.graph.sides.entries()].map(([id, s]) => {
    const n = p.railNodes[id]!;
    return { id, pos: n.position, headingDeg: n.headingDeg, a: s.A.length, b: s.B.length };
  });
  return { networkId, segments, others, signals, stations, analysis, nodes };
}

export type RailHit =
  | { kind: 'signal'; id: string }
  | { kind: 'node'; id: string }
  | { kind: 'segment'; id: string }
  | { kind: 'station'; id: string }
  | { kind: 'measurement'; id: string }
  | null;

export function railHitTest(scene: RailScene, p: Project, pt: geo.Vec2, tolM: number, opts: { nodes: boolean; segments: boolean; stations: boolean }): RailHit {
  let best: { d: number; hit: RailHit } | null = null;
  for (const s of scene.signals) {
    const d = dist(pt, s.at);
    if (d <= Math.max(tolM * 1.2, 2) && (!best || d < best.d)) best = { d, hit: { kind: 'signal', id: s.signal.id } };
  }
  if (best) return best.hit;
  if (opts.nodes) {
    for (const n of scene.nodes) {
      const d = dist(pt, n.pos);
      if (d <= Math.max(tolM * 1.3, 1.5) && (!best || d < best.d)) best = { d, hit: { kind: 'node', id: n.id } };
    }
    if (best) return best.hit;
  }
  if (opts.segments) {
    for (const s of scene.segments) {
      for (let i = 1; i < s.points.length; i++) {
        const d = distToSegment(pt, s.points[i - 1]!, s.points[i]!);
        if (d <= Math.max(tolM, 1.5) && (!best || d < best.d)) best = { d, hit: { kind: 'segment', id: s.id } };
      }
    }
    if (best) return best.hit;
  }
  if (opts.stations) {
    for (const st of scene.stations) if (pointInPolygon(pt, st.outline)) return { kind: 'station', id: st.station.id };
  }
  for (const m of Object.values(p.measurements)) {
    if (m.factoryId !== null || m.floorId !== null) continue;
    if (distToSegment(pt, m.from, m.to) <= tolM) return { kind: 'measurement', id: m.id };
  }
  return null;
}

/** Kreuzungen des aktiven Netzes mit Höhenangabe. */
export function sceneCrossings(scene: RailScene) {
  return scene.analysis.blocks.crossings.map((c) => ({ ...c, sameLevel: Math.abs(c.zA - c.zB) < CROSSING_HEIGHT_TOLERANCE_M }));
}
