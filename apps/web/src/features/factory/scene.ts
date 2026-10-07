/**
 * Aufbereitung der Fabrikdaten für Darstellung und Trefferprüfung.
 * Alle Koordinaten in Weltmetern.
 */
import {
  buildingFootprint,
  controlPoints,
  geo,
  routePath,
  worldPorts,
  type Building,
  type FootprintPart,
  type GameDataIndex,
  type LogisticsLink,
  type ObjectRef,
  type PlanArea,
  type Project,
  type Vec3,
  type WorldPort,
} from '@satis/core';

export interface SceneBuilding {
  building: Building;
  parts: FootprintPart[];
  outline: geo.Vec2[];
  rect: geo.Rect;
  ports: WorldPort[];
  onActiveFloor: boolean;
}

export interface SceneLink {
  link: LogisticsLink;
  /** Polylinie in Weltkoordinaten (inkl. z). */
  points: Vec3[];
  visibleOnFloor: boolean;
}

export interface FactoryScene {
  buildings: SceneBuilding[];
  byId: Map<string, SceneBuilding>;
  links: SceneLink[];
  areas: PlanArea[];
  connectedPorts: Set<string>;
  /** Übergabeanschlüsse direkter Bänder/Rohre zu anderen Fabriken. */
  external: { orderId: string; buildingId: string; port: WorldPort; dir: 'in' | 'out'; otherFactoryId: string }[];
}

export const portKey = (buildingId: string, portId: string) => `${buildingId}/${portId}`;

export function buildScene(p: Project, gd: GameDataIndex, factoryId: string, floorId: string): FactoryScene {
  const buildings: SceneBuilding[] = [];
  const byId = new Map<string, SceneBuilding>();
  for (const b of Object.values(p.buildings)) {
    if (b.factoryId !== factoryId || !b.placement) continue;
    const def = gd.building(b.type);
    if (!def) continue;
    const floor = p.floors[b.placement.floorId];
    const parts = buildingFootprint(def, b.placement, floor);
    const sb: SceneBuilding = {
      building: b,
      parts,
      outline: parts.flatMap((x) => x.polygon),
      rect: geo.rectOf(parts.flatMap((x) => x.polygon)),
      ports: worldPorts(b, def, floor),
      onActiveFloor: b.placement.floorId === floorId,
    };
    buildings.push(sb);
    byId.set(b.id, sb);
  }
  const connectedPorts = new Set<string>();
  const links: SceneLink[] = [];
  for (const l of Object.values(p.links)) {
    if (l.factoryId !== factoryId) continue;
    const a = byId.get(l.from.buildingId);
    const b = byId.get(l.to.buildingId);
    const pa = a?.ports.find((x) => x.id === l.from.portId);
    const pb = b?.ports.find((x) => x.id === l.to.portId);
    if (!a || !b || !pa || !pb) continue;
    connectedPorts.add(portKey(a.building.id, pa.id));
    connectedPorts.add(portKey(b.building.id, pb.id));
    links.push({
      link: l,
      points: routePath(controlPoints(pa, pb, l.waypoints), l.routing),
      visibleOnFloor: a.onActiveFloor || b.onActiveFloor,
    });
  }
  const external: FactoryScene['external'] = [];
  for (const o of Object.values(p.transportOrders)) {
    if ((o.mode !== 'belt' && o.mode !== 'pipe') || !o.direct) continue;
    for (const [end, dir, here, other] of [
      [o.direct.from, 'out', o.fromFactoryId, o.toFactoryId],
      [o.direct.to, 'in', o.toFactoryId, o.fromFactoryId],
    ] as const) {
      if (!end || here !== factoryId) continue;
      const port = byId.get(end.buildingId)?.ports.find((x) => x.id === end.portId);
      if (!port) continue;
      connectedPorts.add(portKey(end.buildingId, end.portId));
      external.push({ orderId: o.id, buildingId: end.buildingId, port, dir, otherFactoryId: other });
    }
  }
  const areas = Object.values(p.areas).filter((a) => a.factoryId === factoryId && a.floorId === floorId);
  return { buildings, byId, links, areas, connectedPorts, external };
}

export type Hit =
  | { kind: 'port'; buildingId: string; port: WorldPort }
  | { kind: 'building'; id: string }
  | { kind: 'link'; id: string }
  | { kind: 'measurement'; id: string }
  | { kind: 'area'; id: string }
  | null;

export function hitTest(
  scene: FactoryScene,
  p: Project,
  pt: geo.Vec2,
  tolM: number,
  opts: { ports: boolean; links: boolean; floorId: string; measurements: boolean; areas: boolean },
): Hit {
  if (opts.ports) {
    let best: { d: number; hit: Hit } | null = null;
    for (const sb of scene.buildings) {
      if (!sb.onActiveFloor) continue;
      for (const port of sb.ports) {
        const d = geo.dist(pt, port.world);
        if (d <= Math.max(tolM, 0.8) && (!best || d < best.d)) best = { d, hit: { kind: 'port', buildingId: sb.building.id, port } };
      }
    }
    if (best) return best.hit;
  }
  for (let i = scene.buildings.length - 1; i >= 0; i--) {
    const sb = scene.buildings[i]!;
    if (!sb.onActiveFloor || !geo.rectContains(sb.rect, pt)) continue;
    if (sb.parts.some((part) => geo.pointInPolygon(pt, part.polygon))) return { kind: 'building', id: sb.building.id };
  }
  if (opts.links) {
    for (const sl of scene.links) {
      if (!sl.visibleOnFloor) continue;
      for (let i = 1; i < sl.points.length; i++) {
        if (geo.distToSegment(pt, sl.points[i - 1]!, sl.points[i]!) <= tolM) return { kind: 'link', id: sl.link.id };
      }
    }
  }
  if (opts.measurements) {
    for (const m of Object.values(p.measurements)) {
      if (m.floorId !== opts.floorId) continue;
      if (geo.distToSegment(pt, m.from, m.to) <= tolM) return { kind: 'measurement', id: m.id };
    }
  }
  if (opts.areas) {
    for (let i = scene.areas.length - 1; i >= 0; i--) {
      const a = scene.areas[i]!;
      if (geo.pointInPolygon(pt, a.polygon)) return { kind: 'area', id: a.id };
    }
  }
  return null;
}

export function hitToRef(hit: Hit): ObjectRef | null {
  if (!hit) return null;
  switch (hit.kind) {
    case 'building':
      return { table: 'buildings', id: hit.id };
    case 'port':
      return { table: 'buildings', id: hit.buildingId };
    case 'link':
      return { table: 'links', id: hit.id };
    case 'measurement':
      return { table: 'measurements', id: hit.id };
    case 'area':
      return { table: 'areas', id: hit.id };
  }
}

/**
 * Abstände eines Rechtecks zu den nächsten Nachbarn in x- und y-Richtung
 * (für die Abstandsanzeige beim Verschieben).
 */
export function neighborGaps(rect: geo.Rect, others: geo.Rect[]): { a: geo.Vec2; b: geo.Vec2 }[] {
  const out: { a: geo.Vec2; b: geo.Vec2 }[] = [];
  const cy = (rect.minY + rect.maxY) / 2;
  const cx = (rect.minX + rect.maxX) / 2;
  let left: geo.Rect | null = null;
  let right: geo.Rect | null = null;
  let up: geo.Rect | null = null;
  let down: geo.Rect | null = null;
  for (const o of others) {
    const yOverlap = o.minY < rect.maxY && o.maxY > rect.minY;
    const xOverlap = o.minX < rect.maxX && o.maxX > rect.minX;
    if (yOverlap && o.maxX <= rect.minX + 1e-6 && (!left || o.maxX > left.maxX)) left = o;
    if (yOverlap && o.minX >= rect.maxX - 1e-6 && (!right || o.minX < right.minX)) right = o;
    if (xOverlap && o.maxY <= rect.minY + 1e-6 && (!up || o.maxY > up.maxY)) up = o;
    if (xOverlap && o.minY >= rect.maxY - 1e-6 && (!down || o.minY < down.minY)) down = o;
  }
  const limit = 64;
  if (left && rect.minX - left.maxX < limit) out.push({ a: { x: left.maxX, y: cy }, b: { x: rect.minX, y: cy } });
  if (right && right.minX - rect.maxX < limit) out.push({ a: { x: rect.maxX, y: cy }, b: { x: right.minX, y: cy } });
  if (up && rect.minY - up.maxY < limit) out.push({ a: { x: cx, y: up.maxY }, b: { x: cx, y: rect.minY } });
  if (down && down.minY - rect.maxY < limit) out.push({ a: { x: cx, y: rect.maxY }, b: { x: cx, y: down.minY } });
  return out;
}
