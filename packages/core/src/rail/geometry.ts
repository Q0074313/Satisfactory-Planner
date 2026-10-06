/**
 * Gleisgeometrie: Segmente sind kubische Bezierkurven zwischen zwei Knoten,
 * tangential zu den Knotenachsen.
 */
import {
  add,
  bezierMinRadius,
  bezierPoint,
  bezierPolyline,
  dirFromDeg,
  dist,
  dot,
  normalize,
  polylineLength,
  scale,
  segmentIntersection,
  sub,
  type Bezier3,
  type Vec2,
} from '../geometry/index.ts';
import type { NodeSide, Project, RailNode, RailSegment, Vec3 } from '../model/schema.ts';

export const otherSide = (s: NodeSide): NodeSide => (s === 'A' ? 'B' : 'A');

/** Richtung, in die ein an Seite `side` angeschlossenes Segment den Knoten verlässt. */
export function outward(node: RailNode, side: NodeSide): Vec2 {
  const d = dirFromDeg(node.headingDeg);
  return side === 'B' ? d : { x: -d.x, y: -d.y };
}

/**
 * Länge der Kontrollarme für einen möglichst kreisförmigen Bogen zwischen
 * zwei Punkten mit gegebenen Austrittsrichtungen.
 */
export function autoHandle(p0: Vec2, d0: Vec2, p3: Vec2, d3: Vec2): number {
  const chord = dist(p0, p3);
  if (chord < 1e-9) return 0;
  const cosT = Math.max(-1, Math.min(1, dot(d0, { x: -d3.x, y: -d3.y })));
  const theta = Math.acos(cosT);
  if (theta < 1e-3) return chord / 3;
  const r = chord / (2 * Math.sin(theta / 2));
  const k = (4 / 3) * Math.tan(theta / 4) * r;
  return Math.min(k, chord * 1.5);
}

export interface SegmentShape {
  curve: Bezier3;
  z0: number;
  z1: number;
}

export function segmentShape(p: Project, seg: RailSegment): SegmentShape | null {
  const na = p.railNodes[seg.a.nodeId];
  const nb = p.railNodes[seg.b.nodeId];
  if (!na || !nb) return null;
  const p0 = { x: na.position.x, y: na.position.y };
  const p3 = { x: nb.position.x, y: nb.position.y };
  const d0 = outward(na, seg.a.side);
  const d3 = outward(nb, seg.b.side);
  const ha = seg.handleA ?? autoHandle(p0, d0, p3, d3);
  const hb = seg.handleB ?? autoHandle(p3, d3, p0, d0);
  return {
    curve: { p0, p1: add(p0, scale(d0, ha)), p2: add(p3, scale(d3, hb)), p3 },
    z0: na.position.z,
    z1: nb.position.z,
  };
}

/** Polylinie mit Höhe (linear interpoliert). */
export function segmentPolyline(shape: SegmentShape, n = 24): Vec3[] {
  return bezierPolyline(shape.curve, n).map((pt, i) => ({ ...pt, z: shape.z0 + ((shape.z1 - shape.z0) * i) / n }));
}

export function segmentLength(shape: SegmentShape): number {
  const h = polylineLength(bezierPolyline(shape.curve, 32));
  return Math.hypot(h, shape.z1 - shape.z0);
}

export function segmentMinRadius(shape: SegmentShape): number {
  return bezierMinRadius(shape.curve);
}

export function pointOnSegment(shape: SegmentShape, t: number): Vec3 {
  const p = bezierPoint(shape.curve, t);
  return { ...p, z: shape.z0 + (shape.z1 - shape.z0) * t };
}

/** Nächster Parameter t auf der Kurve zu einem Punkt (Abtastung + Verfeinerung). */
export function closestT(shape: SegmentShape, pt: Vec2): { t: number; d: number } {
  let best = { t: 0, d: Infinity };
  const n = 48;
  for (let i = 0; i <= n; i++) {
    const t = i / n;
    const d = dist(bezierPoint(shape.curve, t), pt);
    if (d < best.d) best = { t, d };
  }
  let step = 1 / n;
  for (let k = 0; k < 12; k++) {
    step /= 2;
    for (const t of [best.t - step, best.t + step]) {
      if (t < 0 || t > 1) continue;
      const d = dist(bezierPoint(shape.curve, t), pt);
      if (d < best.d) best = { t, d };
    }
  }
  return best;
}

/** Zerlegt eine Bezierkurve bei t (de Casteljau). */
export function splitBezier(c: Bezier3, t: number): [Bezier3, Bezier3] {
  const lerp = (a: Vec2, b: Vec2) => ({ x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t });
  const a1 = lerp(c.p0, c.p1);
  const a2 = lerp(c.p1, c.p2);
  const a3 = lerp(c.p2, c.p3);
  const b1 = lerp(a1, a2);
  const b2 = lerp(a2, a3);
  const m = lerp(b1, b2);
  return [
    { p0: c.p0, p1: a1, p2: b1, p3: m },
    { p0: m, p1: b2, p2: a3, p3: c.p3 },
  ];
}

/**
 * Fahrtrichtung am Ende eines Kreisbogens, der in `p0` mit Richtung `t0`
 * beginnt und in `p3` endet (Spiegelung an der Sehne).
 */
export function arcEndDirection(p0: Vec2, t0: Vec2, p3: Vec2): Vec2 {
  const c = normalize(sub(p3, p0));
  const k = 2 * dot(c, t0);
  return normalize({ x: k * c.x - t0.x, y: k * c.y - t0.y });
}

export interface Crossing {
  segA: string;
  segB: string;
  point: Vec2;
  zA: number;
  zB: number;
}

/**
 * Geometrische Kreuzungen zwischen Segmenten ohne gemeinsamen Knoten.
 * Für jede Kreuzung werden beide Höhen geliefert; ob sie sich im Spiel
 * berühren, entscheidet der Aufrufer (Höhenschwelle).
 */
export function findCrossings(p: Project, segments: RailSegment[]): Crossing[] {
  const shapes = segments
    .map((s) => ({ seg: s, shape: segmentShape(p, s) }))
    .filter((x): x is { seg: RailSegment; shape: SegmentShape } => !!x.shape)
    .map((x) => {
      const pts = segmentPolyline(x.shape, 24);
      const xs = pts.map((q) => q.x);
      const ys = pts.map((q) => q.y);
      return { ...x, pts, box: { minX: Math.min(...xs), maxX: Math.max(...xs), minY: Math.min(...ys), maxY: Math.max(...ys) } };
    });
  const out: Crossing[] = [];
  for (let i = 0; i < shapes.length; i++)
    for (let j = i + 1; j < shapes.length; j++) {
      const a = shapes[i]!;
      const b = shapes[j]!;
      if (a.box.maxX < b.box.minX || b.box.maxX < a.box.minX || a.box.maxY < b.box.minY || b.box.maxY < a.box.minY) continue;
      const nodesA = [a.seg.a.nodeId, a.seg.b.nodeId];
      if (nodesA.includes(b.seg.a.nodeId) || nodesA.includes(b.seg.b.nodeId)) continue;
      let found = false;
      for (let u = 1; u < a.pts.length && !found; u++)
        for (let v = 1; v < b.pts.length && !found; v++) {
          const hit = segmentIntersection(a.pts[u - 1]!, a.pts[u]!, b.pts[v - 1]!, b.pts[v]!, true);
          if (!hit) continue;
          const za = a.pts[u - 1]!.z + (a.pts[u]!.z - a.pts[u - 1]!.z) * hit.ta;
          const zb = b.pts[v - 1]!.z + (b.pts[v]!.z - b.pts[v - 1]!.z) * hit.tb;
          out.push({ segA: a.seg.id, segB: b.seg.id, point: hit.point, zA: za, zB: zb });
          found = true;
        }
    }
  return out;
}

/**
 * Höhenabstand, unterhalb dessen sich kreuzende Gleise im Spiel berühren.
 * Annahme: Kollisionsbox eines Gleises 1 m hoch (Wiki „Railway“, Stand vor 1.2;
 * in 1.2 verkleinert, Wert unbekannt).
 */
export const CROSSING_HEIGHT_TOLERANCE_M = 1;
