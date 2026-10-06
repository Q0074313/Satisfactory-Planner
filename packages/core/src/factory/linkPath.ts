/**
 * Verlauf von Förderbändern und Rohren.
 *
 * Gespeichert werden nur Anschlüsse und Zwischenpunkte. Daraus entsteht der
 * Verlauf je nach Verlegemodus:
 * - `direct`: gerade Abschnitte zwischen den Punkten
 * - `straight`: rechtwinklig; jeder Abschnitt wird in achsparallele Teile zerlegt
 * - `curved`: weiche Kurve (zentripetale Catmull-Rom-Spline) durch die Punkte
 *
 * Aufeinanderfolgende Punkte mit gleicher Lage und unterschiedlicher Höhe
 * bilden einen senkrechten Abschnitt (Förderlift bzw. senkrechtes Rohr). Er
 * bleibt in allen Modi senkrecht.
 */
import type { GameDataIndex } from '../gamedata/index.ts';
import type { LinkRouting, LogisticsLink, Project, Vec3 } from '../model/schema.ts';
import { worldPorts, type WorldPort } from './ports.ts';

/** Abstand des ersten bzw. letzten Steuerpunkts vor dem Anschluss (m). */
export const PORT_STUB_M = 1;
const EPS = 1e-6;

export interface LinkEnds {
  from: WorldPort;
  to: WorldPort;
}

export function linkEnds(p: Project, gd: GameDataIndex, link: Pick<LogisticsLink, 'from' | 'to'>): LinkEnds | null {
  const a = p.buildings[link.from.buildingId];
  const b = p.buildings[link.to.buildingId];
  if (!a?.placement || !b?.placement) return null;
  const da = gd.building(a.type);
  const db = gd.building(b.type);
  if (!da || !db) return null;
  const from = worldPorts(a, da, p.floors[a.placement.floorId]).find((x) => x.id === link.from.portId);
  const to = worldPorts(b, db, p.floors[b.placement.floorId]).find((x) => x.id === link.to.portId);
  return from && to ? { from, to } : null;
}

export function portStubPoint(port: WorldPort, distance = PORT_STUB_M): Vec3 {
  return { x: port.world.x + port.worldNormal.x * distance, y: port.world.y + port.worldNormal.y * distance, z: port.world.z };
}

/** Steuerpunkte: Anschluss, Austritt, Zwischenpunkte, Eintritt, Anschluss. */
export function controlPoints(from: WorldPort, to: WorldPort, waypoints: Vec3[]): Vec3[] {
  return [{ ...from.world }, portStubPoint(from), ...waypoints.map((w) => ({ ...w })), portStubPoint(to), { ...to.world }];
}

const isVertical = (a: Vec3, b: Vec3) => Math.abs(a.x - b.x) < EPS && Math.abs(a.y - b.y) < EPS && Math.abs(a.z - b.z) > EPS;
const same = (a: Vec3, b: Vec3) => Math.abs(a.x - b.x) < EPS && Math.abs(a.y - b.y) < EPS && Math.abs(a.z - b.z) < EPS;

/** Zerlegt die Punktfolge an senkrechten Abschnitten in waagrechte Läufe. */
function splitRuns(points: Vec3[]): Vec3[][] {
  const runs: Vec3[][] = [];
  let run: Vec3[] = [];
  for (const pt of points) {
    const last = run.at(-1);
    if (last && isVertical(last, pt)) {
      runs.push(run);
      run = [pt];
    } else if (!last || !same(last, pt)) run.push(pt);
  }
  if (run.length) runs.push(run);
  return runs;
}

function orthogonalRun(run: Vec3[], startDir: { x: number; y: number } | null, endDir: { x: number; y: number } | null): Vec3[] {
  if (run.length < 2) return run;
  const out: Vec3[] = [run[0]!];
  let prev = startDir ?? { x: run[1]!.x - run[0]!.x, y: run[1]!.y - run[0]!.y };
  for (let i = 1; i < run.length; i++) {
    const cur = out.at(-1)!;
    const q = run[i]!;
    const dx = q.x - cur.x;
    const dy = q.y - cur.y;
    if (Math.abs(dx) < EPS || Math.abs(dy) < EPS) {
      out.push(q);
    } else {
      // Letzter Abschnitt vor dem Ziel: in Eintrittsrichtung ankommen; sonst die bisherige Richtung fortsetzen.
      const isLast = i === run.length - 1 && endDir !== null;
      const horizontalFirst = isLast ? Math.abs(endDir!.x) < Math.abs(endDir!.y) : Math.abs(prev.x) >= Math.abs(prev.y);
      const corner = horizontalFirst ? { x: q.x, y: cur.y } : { x: cur.x, y: q.y };
      const l1 = Math.hypot(corner.x - cur.x, corner.y - cur.y);
      const l2 = Math.hypot(q.x - corner.x, q.y - corner.y);
      const z = cur.z + ((q.z - cur.z) * l1) / (l1 + l2 || 1);
      out.push({ ...corner, z }, q);
    }
    const a = out.at(-2)!;
    const b = out.at(-1)!;
    if (Math.hypot(b.x - a.x, b.y - a.y) > EPS) prev = { x: b.x - a.x, y: b.y - a.y };
  }
  return out;
}

/** Zentripetale Catmull-Rom-Spline durch die Punkte eines Laufs. */
function curvedRun(run: Vec3[], samplesPerSpan = 10): Vec3[] {
  if (run.length < 3) return run;
  const pts = [run[0]!, ...run, run.at(-1)!];
  // Randpunkte gespiegelt verlängern, damit die Kurve tangential zu den Anschlüssen beginnt
  pts[0] = { x: 2 * run[0]!.x - run[1]!.x, y: 2 * run[0]!.y - run[1]!.y, z: run[0]!.z };
  const n = run.length;
  pts[n + 1] = { x: 2 * run[n - 1]!.x - run[n - 2]!.x, y: 2 * run[n - 1]!.y - run[n - 2]!.y, z: run[n - 1]!.z };
  const out: Vec3[] = [run[0]!];
  const tj = (a: Vec3, b: Vec3) => Math.sqrt(Math.max(Math.hypot(b.x - a.x, b.y - a.y), 1e-4));
  for (let i = 1; i < pts.length - 2; i++) {
    const p0 = pts[i - 1]!;
    const p1 = pts[i]!;
    const p2 = pts[i + 1]!;
    const p3 = pts[i + 2]!;
    const t0 = 0;
    const t1 = t0 + tj(p0, p1);
    const t2 = t1 + tj(p1, p2);
    const t3 = t2 + tj(p2, p3);
    for (let s = 1; s <= samplesPerSpan; s++) {
      const t = t1 + ((t2 - t1) * s) / samplesPerSpan;
      const lerp = (a: Vec3, b: Vec3, ta: number, tb: number): Vec3 => {
        const w = (t - ta) / (tb - ta);
        return { x: a.x + (b.x - a.x) * w, y: a.y + (b.y - a.y) * w, z: a.z + (b.z - a.z) * w };
      };
      const a1 = lerp(p0, p1, t0, t1);
      const a2 = lerp(p1, p2, t1, t2);
      const a3 = lerp(p2, p3, t2, t3);
      const b1 = lerp(a1, a2, t0, t2);
      const b2 = lerp(a2, a3, t1, t3);
      out.push(lerp(b1, b2, t1, t2));
    }
  }
  return out;
}

/**
 * Verlauf als Polylinie (Weltkoordinaten mit Höhe). `ctrl` sind die
 * Steuerpunkte aus {@link controlPoints}.
 */
export function routePath(ctrl: Vec3[], routing: LinkRouting): Vec3[] {
  const runs = splitRuns(ctrl);
  const out: Vec3[] = [];
  runs.forEach((run, idx) => {
    let pts: Vec3[];
    if (routing === 'straight') {
      // Erster Lauf beginnt in Austrittsrichtung des Anschlusses, letzter endet in Eintrittsrichtung.
      const startDir = idx === 0 && run.length >= 2 ? { x: run[1]!.x - run[0]!.x, y: run[1]!.y - run[0]!.y } : null;
      const last = run.length >= 2 && idx === runs.length - 1 ? { x: run.at(-1)!.x - run.at(-2)!.x, y: run.at(-1)!.y - run.at(-2)!.y } : null;
      // Der Eintritt ist der letzte Abschnitt (Eintrittspunkt → Anschluss); die Ecke liegt davor.
      if (last && run.length >= 3) {
        const head = orthogonalRun(run.slice(0, -1), startDir, last);
        pts = [...head, run.at(-1)!];
      } else pts = orthogonalRun(run, startDir, last);
    } else if (routing === 'curved') {
      pts = curvedRun(run);
    } else pts = run;
    for (const pt of pts) {
      const prev = out.at(-1);
      if (!prev || !same(prev, pt)) out.push(pt);
    }
  });
  return out;
}

export function pathLength(path: Vec3[]): { total: number; horizontal: number; vertical: number } {
  let total = 0;
  let horizontal = 0;
  let vertical = 0;
  for (let i = 1; i < path.length; i++) {
    const a = path[i - 1]!;
    const b = path[i]!;
    const h = Math.hypot(b.x - a.x, b.y - a.y);
    const v = Math.abs(b.z - a.z);
    total += Math.hypot(h, v);
    if (h < EPS) vertical += v;
    else horizontal += Math.hypot(h, v);
  }
  return { total, horizontal, vertical };
}

/** Vollständiger Verlauf einer gespeicherten Verbindung oder null, wenn ein Ende fehlt. */
export function linkPath(p: Project, gd: GameDataIndex, link: LogisticsLink): Vec3[] | null {
  const ends = linkEnds(p, gd, link);
  if (!ends) return null;
  return routePath(controlPoints(ends.from, ends.to, link.waypoints), link.routing);
}

/** Senkrechte Abschnitte (Lifte) eines Verlaufs. */
export function verticalSections(path: Vec3[]): { at: { x: number; y: number }; z0: number; z1: number }[] {
  const out: { at: { x: number; y: number }; z0: number; z1: number }[] = [];
  for (let i = 1; i < path.length; i++) {
    const a = path[i - 1]!;
    const b = path[i]!;
    if (isVertical(a, b)) out.push({ at: { x: a.x, y: a.y }, z0: a.z, z1: b.z });
  }
  return out;
}
