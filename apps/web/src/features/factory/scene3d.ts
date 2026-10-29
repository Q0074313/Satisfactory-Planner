/**
 * Körper der 3D-Ansicht (three.js-Geometrien) aus dem Projekt: Gebäude,
 * Förderbänder als flache Bahnen, Rohre, Richtungspfeile, Flächen bzw.
 * Fundamentkacheln, Namensschilder und Infotext beim Überfahren.
 *
 * Koordinaten: Planer (x, y, z) → three.js (x, z, y).
 */
import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { buildingFootprint, cachedFactoryFlow, controlPoints, geo, routePath, worldPorts, type GameDataIndex, type ObjectRef, type Project, type Vec3 } from '@satis/core';
import { CATEGORY_COLORS } from '../../canvas/draw';
import { formatNumber, t } from '../../i18n';
import { linkTierStyle } from './render';
import { floorAtZ } from './scene';

/** Planerpunkt → three.js-Vektor. */
export const v3 = (x: number, y: number, z: number) => new THREE.Vector3(x, z, y);

/** Förderband: Breite und Dicke der Bahn (Planungsmaß), Rohrradius je Stufe. */
const BELT_W = 1;
const BELT_T = 0.25;
const PIPE_R = [0.4, 0.5];
/** Abstand der Richtungspfeile auf Leitungen. */
const ARROW_STEP = 8;
/** Fundamentraster (Weltraster der Fundamente). */
const GRID_M = 8;

/**
 * Senkrechter Körper über einem Polygon. Die Form liegt mit (x, −y) in der
 * xy-Ebene; die Drehung um −90° um x legt die Extrusion nach oben und y nach z.
 */
function prism(polygon: { x: number; y: number }[], zMin: number, zMax: number): THREE.BufferGeometry {
  const shape = new THREE.Shape(polygon.map((p) => new THREE.Vector2(p.x, -p.y)));
  const g = new THREE.ExtrudeGeometry(shape, { depth: Math.max(0.05, zMax - zMin), bevelEnabled: false });
  g.rotateX(-Math.PI / 2);
  g.translate(0, zMin, 0);
  return g;
}

/** Geometrie entlang der Strecke a → b ausrichten (lokale Achse `axis` zeigt nach b). */
function orient(g: THREE.BufferGeometry, a: THREE.Vector3, b: THREE.Vector3, axis: THREE.Vector3): THREE.BufferGeometry {
  const dir = b.clone().sub(a).normalize();
  g.applyQuaternion(new THREE.Quaternion().setFromUnitVectors(axis, dir));
  g.translate((a.x + b.x) / 2, (a.y + b.y) / 2, (a.z + b.z) / 2);
  return g;
}

const Z_AXIS = new THREE.Vector3(0, 0, 1);

const Y_AXIS = new THREE.Vector3(0, 1, 0);

/** Punkte eines Verlaufs in three.js, ohne doppelte Punkte. */
function cleanPoints(points: Vec3[]): THREE.Vector3[] {
  return points.map((p) => v3(p.x, p.y, p.z)).filter((p, i, a) => i === 0 || p.distanceTo(a[i - 1]!) > 1e-3);
}

/**
 * Förderband als flache Bahn: je Abschnitt ein Quader (Oberkante auf
 * Leitungshöhe), an den Enden um die halbe Breite verlängert, damit Ecken
 * geschlossen sind; senkrechte Abschnitte (Lifte) als quadratische Säule.
 */
function beltGeometry(pts: THREE.Vector3[]): THREE.BufferGeometry | null {
  const parts: THREE.BufferGeometry[] = [];
  for (let i = 1; i < pts.length; i++) {
    const a = pts[i - 1]!.clone();
    const b = pts[i]!.clone();
    const len = a.distanceTo(b);
    const vertical = Math.abs(b.y - a.y) > 0.9 * len;
    if (!vertical) {
      a.y -= BELT_T / 2;
      b.y -= BELT_T / 2;
    }
    parts.push(orient(new THREE.BoxGeometry(BELT_W, vertical ? BELT_W : BELT_T, len + (vertical ? 0 : BELT_W)), a, b, Z_AXIS));
  }
  return parts.length ? mergeGeometries(parts) : null;
}

/** Rohr: Zylinder je Abschnitt, Kugeln an den Knicken. */
function pipeGeometry(pts: THREE.Vector3[], r: number): THREE.BufferGeometry | null {
  const parts: THREE.BufferGeometry[] = [];
  for (let i = 1; i < pts.length; i++) parts.push(orient(new THREE.CylinderGeometry(r, r, pts[i - 1]!.distanceTo(pts[i]!), 12, 1, true), pts[i - 1]!, pts[i]!, Y_AXIS));
  for (let i = 1; i < pts.length - 1; i++) parts.push(new THREE.SphereGeometry(r, 12, 8).translate(pts[i]!.x, pts[i]!.y, pts[i]!.z));
  return parts.length ? mergeGeometries(parts) : null;
}

/** Abschnitt mit Richtungspfeilen (waagrecht, auf dem Band bzw. über dem Rohr). */
export interface ArrowRun {
  a: THREE.Vector3;
  dir: THREE.Vector3;
  len: number;
  /** Anzahl Pfeile (Abstand len / n). */
  n: number;
}

/** Waagrechte Abschnitte eines Verlaufs, auf denen Pfeile in Flussrichtung sitzen. */
function arrowRuns(pts: THREE.Vector3[], lift: number): ArrowRun[] {
  const runs: ArrowRun[] = [];
  for (let i = 1; i < pts.length; i++) {
    const a = pts[i - 1]!;
    const b = pts[i]!;
    const len = a.distanceTo(b);
    if (len < 3 || Math.abs(b.y - a.y) > 0.3 * len) continue;
    const start = a.clone();
    start.y += lift;
    runs.push({ a: start, dir: b.clone().sub(a).normalize(), len, n: Math.max(1, Math.floor(len / ARROW_STEP)) });
  }
  return runs;
}

/** Form eines Pfeils: flaches Dreieck, liegt waagrecht und zeigt nach +z. */
export function arrowShape(): THREE.BufferGeometry {
  const tri = new THREE.ShapeGeometry(new THREE.Shape([new THREE.Vector2(-0.4, -0.45), new THREE.Vector2(0.4, -0.45), new THREE.Vector2(0, 0.45)]));
  tri.rotateX(Math.PI / 2);
  return tri;
}

/** Anzahl Pfeile einer Leitung. */
export const arrowCount = (runs: ArrowRun[]) => runs.reduce((s, r) => s + r.n, 0);

const ARROW_Q = new THREE.Quaternion();
/**
 * Lage der Pfeile für eine Verschiebung `shift` (m) entlang des Flusses:
 * schreibt die Matrizen in `set(i, matrix)`. Bei `shift = 0` stehen die
 * Pfeile in der Mitte ihrer Teilstücke.
 */
export function placeArrows(runs: ArrowRun[], shift: number, set: (i: number, m: THREE.Matrix4) => void): void {
  const m = new THREE.Matrix4();
  const pos = new THREE.Vector3();
  const one = new THREE.Vector3(1, 1, 1);
  let i = 0;
  for (const r of runs) {
    const step = r.len / r.n;
    ARROW_Q.setFromUnitVectors(Z_AXIS, r.dir);
    for (let k = 0; k < r.n; k++) {
      const t = (((k + 0.5) * step + shift) % r.len + r.len) % r.len;
      pos.copy(r.a).addScaledVector(r.dir, t);
      set(i++, m.compose(pos, ARROW_Q, one));
    }
  }
}

/**
 * Fundamentraster: Linien im 8-m-Raster ab der linken oberen Ecke der
 * Fläche (wie die Fundamente im Weltraster liegen), knapp über der Oberkante;
 * nur Kanten an Feldern innerhalb der Fläche.
 */
function gridGeometry(polygon: { x: number; y: number }[], z: number): THREE.BufferGeometry | null {
  const minX = Math.min(...polygon.map((p) => p.x));
  const minY = Math.min(...polygon.map((p) => p.y));
  const maxX = Math.max(...polygon.map((p) => p.x));
  const maxY = Math.max(...polygon.map((p) => p.y));
  const inside = (x: number, y: number) => geo.pointInPolygon({ x, y }, polygon);
  const pts: number[] = [];
  const seg = (x1: number, y1: number, x2: number, y2: number) => pts.push(x1, z, y1, x2, z, y2);
  const S = GRID_M;
  for (let x = minX; x <= maxX + 1e-6; x += S)
    for (let y = minY; y < maxY - 1e-6; y += S) if (inside(x - S / 2, y + S / 2) || inside(x + S / 2, y + S / 2)) seg(x, y, x, Math.min(y + S, maxY));
  for (let y = minY; y <= maxY + 1e-6; y += S)
    for (let x = minX; x < maxX - 1e-6; x += S) if (inside(x + S / 2, y - S / 2) || inside(x + S / 2, y + S / 2)) seg(x, y, Math.min(x + S, maxX), y);
  if (!pts.length) return null;
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pts, 3));
  return g;
}

export type Kind3D = 'building' | 'belt' | 'pipe' | 'area' | 'grid' | 'arrow';

export interface Item3D {
  ref: ObjectRef;
  floorId: string | null;
  kind: Kind3D;
  geometry: THREE.BufferGeometry;
  color: string;
  opacity: number;
  /** Pfeile (kind 'arrow'): Abschnitte und Fördergeschwindigkeit für die Animation (m/s). */
  arrows?: ArrowRun[];
  speed?: number;
}

export interface Label3D {
  floorId: string | null;
  text: string;
  at: THREE.Vector3;
}

/** Körper, Pfeile und Namen einer Fabrik. */
export function buildItems(project: Project, gd: GameDataIndex, factoryId: string, grid: boolean): { items: Item3D[]; labels: Label3D[] } {
  const items: Item3D[] = [];
  const labels: Label3D[] = [];
  for (const b of Object.values(project.buildings)) {
    if (b.factoryId !== factoryId || !b.placement) continue;
    const def = gd.building(b.type);
    if (!def) continue;
    const all = buildingFootprint(def, b.placement, project.floors[b.placement.floorId]);
    // Splitter, Zusammenführungen und Rohrkreuzungen haben nur weiche Boxen
    const hard = all.filter((p) => !p.soft);
    const parts = hard.length ? hard : all;
    for (const part of parts) {
      items.push({
        ref: { table: 'buildings', id: b.id },
        floorId: b.placement.floorId,
        kind: 'building',
        geometry: prism(part.polygon, part.zMin, part.zMax),
        color: CATEGORY_COLORS[def.category] ?? '#888888',
        opacity: 1,
      });
    }
    // Namen nur an größeren Gebäuden (nicht an Splittern, Rohrkreuzungen usw.) bzw. mit eigener Bezeichnung
    const r = geo.rectOf(parts.flatMap((p) => p.polygon));
    if (parts.length && (b.label || (r.maxX - r.minX) * (r.maxY - r.minY) > 20)) {
      const top = Math.max(...parts.map((p) => p.zMax));
      labels.push({ floorId: b.placement.floorId, text: b.label || gd.name(b.type), at: v3((r.minX + r.maxX) / 2, (r.minY + r.maxY) / 2, top + 1.2) });
    }
  }
  for (const l of Object.values(project.links)) {
    if (l.factoryId !== factoryId) continue;
    const a = project.buildings[l.from.buildingId];
    const b = project.buildings[l.to.buildingId];
    if (!a?.placement || !b?.placement) continue;
    const pa = worldPorts(a, gd.building(a.type)!, project.floors[a.placement.floorId]).find((x) => x.id === l.from.portId);
    const pb = worldPorts(b, gd.building(b.type)!, project.floors[b.placement.floorId]).find((x) => x.id === l.to.portId);
    if (!pa || !pb) continue;
    const pts = routePath(controlPoints(pa, pb, l.waypoints), l.routing);
    const style = linkTierStyle(gd, l);
    const r = PIPE_R[Math.min(style.index, PIPE_R.length - 1)]!;
    // Je Stockwerk ein Stück (Stockwerk des Anfangspunkts eines Abschnitts)
    const runs: { floorId: string | null; pts: Vec3[] }[] = [];
    for (let i = 0; i < pts.length; i++) {
      const f = floorAtZ(project, factoryId, pts[i]!.z);
      const cur = runs.at(-1);
      if (!cur) runs.push({ floorId: f, pts: [pts[i]!] });
      else {
        cur.pts.push(pts[i]!);
        if (f !== cur.floorId && i < pts.length - 1) runs.push({ floorId: f, pts: [pts[i]!] });
      }
    }
    for (const run of runs) {
      const clean = cleanPoints(run.pts);
      if (clean.length < 2) continue;
      const g = l.kind === 'belt' ? beltGeometry(clean) : pipeGeometry(clean, r);
      if (g) items.push({ ref: { table: 'links', id: l.id }, floorId: run.floorId, kind: l.kind, geometry: g, color: style.color, opacity: 1 });
      const arrows = arrowRuns(clean, l.kind === 'belt' ? 0.05 : r + 0.25);
      // Sichtbare Geschwindigkeit steigt mit der Stufe (Planungsdarstellung, nicht die Spielgeschwindigkeit)
      if (arrows.length) items.push({ ref: { table: 'links', id: l.id }, floorId: run.floorId, kind: 'arrow', geometry: arrowShape(), color: '#f4f4f4', opacity: 1, arrows, speed: 2 + style.index });
    }
  }
  for (const ar of Object.values(project.areas)) {
    if (ar.factoryId !== factoryId || ar.kind === 'clearance') continue;
    const elev = project.floors[ar.floorId]?.elevationM ?? 0;
    const foundation = ar.kind === 'foundation';
    const f = ar.foundationType ? gd.building(ar.foundationType)?.foundation : undefined;
    const zMin = foundation ? elev - (f?.heightM ?? 1) : elev - 0.05;
    items.push({
      ref: { table: 'areas', id: ar.id },
      floorId: ar.floorId,
      kind: 'area',
      geometry: prism(ar.polygon, zMin, elev - 0.01),
      color: foundation ? '#9aa0a8' : '#4fc3ff',
      opacity: foundation ? 0.55 : 0.18,
    });
    const lines = foundation && grid ? gridGeometry(ar.polygon, elev + 0.02) : null;
    if (lines) items.push({ ref: { table: 'areas', id: ar.id }, floorId: ar.floorId, kind: 'grid', geometry: lines, color: '#2b2f36', opacity: 0.8 });
  }
  return { items, labels };
}

/** Text für das Schild beim Überfahren. */
export function hoverInfo(project: Project, gd: GameDataIndex, factoryId: string, ref: ObjectRef): string[] {
  const flow = cachedFactoryFlow(project, gd, factoryId);
  const unit = (item: string) => (gd.item(item)?.form === 'solid' ? '/min' : ' m³/min');
  if (ref.table === 'buildings') {
    const b = project.buildings[ref.id];
    if (!b) return [];
    const lines = [b.label || gd.name(b.type)];
    if (b.label) lines.push(gd.name(b.type));
    if (b.recipeId) lines.push(`${t('Rezept')}: ${gd.name(b.recipeId)} · ${t('Takt')} ${formatNumber(b.clock * 100, 1)} %`);
    const m = flow.machines.get(b.id);
    if (m && b.recipeId) lines.push(`${t('Auslastung')}: ${formatNumber(m.utilization * 100, 0)} %`);
    return lines;
  }
  if (ref.table === 'links') {
    const l = project.links[ref.id];
    if (!l) return [];
    const lines = [gd.name(l.tier)];
    const fr = flow.links.get(l.id);
    if (fr) {
      for (const it of fr.items) lines.push(`${gd.name(it.itemId)}: ${formatNumber(it.perMin, 2)}${unit(it.itemId)}`);
      lines.push(`${t('Durchsatz')}: ${formatNumber(fr.total, 1)} / ${formatNumber(fr.capacity, 0)}`);
    }
    return lines;
  }
  return [];
}
