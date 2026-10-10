/** Geometrische Grundfunktionen in der Draufsicht (x rechts, y unten). */
import type { Vec2 } from '../model/schema.ts';

export type { Vec2 };

export const DEG = Math.PI / 180;

export const add = (a: Vec2, b: Vec2): Vec2 => ({ x: a.x + b.x, y: a.y + b.y });
export const sub = (a: Vec2, b: Vec2): Vec2 => ({ x: a.x - b.x, y: a.y - b.y });
export const scale = (a: Vec2, s: number): Vec2 => ({ x: a.x * s, y: a.y * s });
export const dot = (a: Vec2, b: Vec2): number => a.x * b.x + a.y * b.y;
export const cross = (a: Vec2, b: Vec2): number => a.x * b.y - a.y * b.x;
export const length = (a: Vec2): number => Math.hypot(a.x, a.y);
export const dist = (a: Vec2, b: Vec2): number => Math.hypot(a.x - b.x, a.y - b.y);
export const normalize = (a: Vec2): Vec2 => {
  const l = length(a);
  return l === 0 ? { x: 0, y: 0 } : { x: a.x / l, y: a.y / l };
};

/** Drehung im Uhrzeigersinn der Draufsicht (y nach unten) um `deg` Grad. */
export function rotate(p: Vec2, deg: number): Vec2 {
  const r = deg * DEG;
  const c = Math.cos(r);
  const s = Math.sin(r);
  return { x: p.x * c - p.y * s, y: p.x * s + p.y * c };
}

/** Einheitsvektor einer Richtung in Grad (0° = +x, 90° = +y). */
export const dirFromDeg = (deg: number): Vec2 => ({ x: Math.cos(deg * DEG), y: Math.sin(deg * DEG) });

export const normalizeDeg = (deg: number): number => ((deg % 360) + 360) % 360;

export const snap = (v: number, step: number): number => (step > 0 ? Math.round(v / step) * step : v);

export interface Rect {
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
}

export const rectOf = (pts: Vec2[]): Rect => {
  const r = { minX: Infinity, minY: Infinity, maxX: -Infinity, maxY: -Infinity };
  for (const p of pts) {
    r.minX = Math.min(r.minX, p.x);
    r.minY = Math.min(r.minY, p.y);
    r.maxX = Math.max(r.maxX, p.x);
    r.maxY = Math.max(r.maxY, p.y);
  }
  return r;
};

export const rectsOverlap = (a: Rect, b: Rect): boolean =>
  a.minX < b.maxX && b.minX < a.maxX && a.minY < b.maxY && b.minY < a.maxY;

export const rectContains = (r: Rect, p: Vec2): boolean => p.x >= r.minX && p.x <= r.maxX && p.y >= r.minY && p.y <= r.maxY;

/** Fläche eines einfachen Polygons (Gaußsche Trapezformel), immer positiv. */
export function polygonArea(poly: Vec2[]): number {
  let a = 0;
  for (let i = 0; i < poly.length; i++) {
    const p = poly[i]!;
    const q = poly[(i + 1) % poly.length]!;
    a += p.x * q.y - q.x * p.y;
  }
  return Math.abs(a) / 2;
}

export function pointInPolygon(p: Vec2, poly: Vec2[]): boolean {
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const a = poly[i]!;
    const b = poly[j]!;
    if (a.y > p.y !== b.y > p.y && p.x < ((b.x - a.x) * (p.y - a.y)) / (b.y - a.y) + a.x) inside = !inside;
  }
  return inside;
}

/**
 * Überlappung zweier konvexer Polygone nach dem Trennachsensatz.
 * Berührung an Kanten (Abstand ≤ eps) gilt nicht als Überlappung.
 */
export function convexOverlap(a: Vec2[], b: Vec2[], eps = 1e-6): boolean {
  for (const poly of [a, b]) {
    for (let i = 0; i < poly.length; i++) {
      const p = poly[i]!;
      const q = poly[(i + 1) % poly.length]!;
      const axis = { x: -(q.y - p.y), y: q.x - p.x };
      let minA = Infinity;
      let maxA = -Infinity;
      let minB = Infinity;
      let maxB = -Infinity;
      for (const v of a) {
        const d = dot(v, axis);
        minA = Math.min(minA, d);
        maxA = Math.max(maxA, d);
      }
      for (const v of b) {
        const d = dot(v, axis);
        minB = Math.min(minB, d);
        maxB = Math.max(maxB, d);
      }
      const len = length(axis) || 1;
      if (maxA - minB <= eps * len || maxB - minA <= eps * len) return false;
    }
  }
  return true;
}

/** Kürzester Abstand eines Punkts zu einer Strecke. */
export function distToSegment(p: Vec2, a: Vec2, b: Vec2): number {
  const ab = sub(b, a);
  const l2 = dot(ab, ab);
  const t = l2 === 0 ? 0 : Math.max(0, Math.min(1, dot(sub(p, a), ab) / l2));
  return dist(p, add(a, scale(ab, t)));
}

/**
 * Schnittpunkt zweier Strecken, sonst null. Ohne `inclusive` zählen
 * Berührungen an den Endpunkten nicht.
 */
export function segmentIntersection(
  a1: Vec2,
  a2: Vec2,
  b1: Vec2,
  b2: Vec2,
  inclusive = false,
): { point: Vec2; ta: number; tb: number } | null {
  const r = sub(a2, a1);
  const s = sub(b2, b1);
  const denom = cross(r, s);
  if (Math.abs(denom) < 1e-12) return null;
  const qp = sub(b1, a1);
  const ta = cross(qp, s) / denom;
  const tb = cross(qp, r) / denom;
  const e = inclusive ? -1e-9 : 1e-9;
  if (ta <= e || ta >= 1 - e || tb <= e || tb >= 1 - e) return null;
  return { point: add(a1, scale(r, ta)), ta, tb };
}

// ---------------------------------------------------------------------------
// Kubische Bezierkurven (Gleise)
// ---------------------------------------------------------------------------

export interface Bezier3 {
  p0: Vec2;
  p1: Vec2;
  p2: Vec2;
  p3: Vec2;
}

export function bezierPoint(c: Bezier3, t: number): Vec2 {
  const u = 1 - t;
  const a = u * u * u;
  const b = 3 * u * u * t;
  const d = 3 * u * t * t;
  const e = t * t * t;
  return { x: a * c.p0.x + b * c.p1.x + d * c.p2.x + e * c.p3.x, y: a * c.p0.y + b * c.p1.y + d * c.p2.y + e * c.p3.y };
}

export function bezierDerivative(c: Bezier3, t: number): Vec2 {
  const u = 1 - t;
  return {
    x: 3 * u * u * (c.p1.x - c.p0.x) + 6 * u * t * (c.p2.x - c.p1.x) + 3 * t * t * (c.p3.x - c.p2.x),
    y: 3 * u * u * (c.p1.y - c.p0.y) + 6 * u * t * (c.p2.y - c.p1.y) + 3 * t * t * (c.p3.y - c.p2.y),
  };
}

export function bezierSecondDerivative(c: Bezier3, t: number): Vec2 {
  const u = 1 - t;
  return {
    x: 6 * u * (c.p2.x - 2 * c.p1.x + c.p0.x) + 6 * t * (c.p3.x - 2 * c.p2.x + c.p1.x),
    y: 6 * u * (c.p2.y - 2 * c.p1.y + c.p0.y) + 6 * t * (c.p3.y - 2 * c.p2.y + c.p1.y),
  };
}

/** Polylinien-Näherung mit `n` Abschnitten. */
export function bezierPolyline(c: Bezier3, n = 24): Vec2[] {
  const pts: Vec2[] = [];
  for (let i = 0; i <= n; i++) pts.push(bezierPoint(c, i / n));
  return pts;
}

export function polylineLength(pts: Vec2[]): number {
  let l = 0;
  for (let i = 1; i < pts.length; i++) l += dist(pts[i - 1]!, pts[i]!);
  return l;
}

/** Kleinster Krümmungsradius entlang der Kurve (Abtastung). Gerade: Infinity. */
export function bezierMinRadius(c: Bezier3, samples = 48): number {
  let min = Infinity;
  for (let i = 0; i <= samples; i++) {
    const t = i / samples;
    const d1 = bezierDerivative(c, t);
    const d2 = bezierSecondDerivative(c, t);
    const k = Math.abs(cross(d1, d2)) / Math.pow(length(d1), 3);
    if (k > 1e-9) min = Math.min(min, 1 / k);
  }
  return min;
}

/**
 * Fängt einen Punkt im Raster der Schrittweite `step`:
 * - `corner`: Rasterecken (Vielfache von `step`)
 * - `center`: Feldmitten (um eine halbe Schrittweite versetzt)
 * - `edge`: Kantenmitten (eine Achse auf der Rasterlinie, die andere in der Feldmitte),
 *   z. B. Gleise mittig über einer Fundamentreihe
 */
export function snapToGrid(p: Vec2, step: number, anchor: 'corner' | 'edge' | 'center'): Vec2 {
  if (step <= 0) return p;
  // „+ 0“ macht aus −0 eine 0
  const line = (v: number) => Math.round(v / step) * step + 0;
  const mid = (v: number) => Math.round((v - step / 2) / step) * step + step / 2 + 0;
  if (anchor === 'corner') return { x: line(p.x), y: line(p.y) };
  if (anchor === 'center') return { x: mid(p.x), y: mid(p.y) };
  const a = { x: line(p.x), y: mid(p.y) };
  const b = { x: mid(p.x), y: line(p.y) };
  return Math.hypot(a.x - p.x, a.y - p.y) <= Math.hypot(b.x - p.x, b.y - p.y) ? a : b;
}
