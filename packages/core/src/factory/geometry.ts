/**
 * Grundrissgeometrie von Gebäuden auf Basis der Kollisionsboxen
 * (`mClearanceData`) aus den Spieldaten.
 */
import { add, rotate, type Vec2 } from '../geometry/index.ts';
import type { GdBuilding, GdClearanceBox, GdVec3 as Vec3 } from '../gamedata/types.ts';
import type { Building, Floor, Placement } from '../model/schema.ts';

export interface FootprintPart {
  /** Konvexes Polygon in Weltkoordinaten. */
  polygon: Vec2[];
  /** Absolute Höhe (Weltkoordinate z). */
  zMin: number;
  zMax: number;
  soft: boolean;
}

function quatRotate(p: Vec3, q: [number, number, number, number]): Vec3 {
  const [x, y, z, w] = q;
  const ix = w * p.x + y * p.z - z * p.y;
  const iy = w * p.y + z * p.x - x * p.z;
  const iz = w * p.z + x * p.y - y * p.x;
  const iw = -x * p.x - y * p.y - z * p.z;
  return {
    x: ix * w + iw * -x + iy * -z - iz * -y,
    y: iy * w + iw * -y + iz * -x - ix * -z,
    z: iz * w + iw * -z + ix * -y - iy * -x,
  };
}

/** Konvexe Hülle (Andrew's Monotone Chain). */
export function convexHull(points: Vec2[]): Vec2[] {
  const pts = [...points].sort((a, b) => a.x - b.x || a.y - b.y);
  if (pts.length < 3) return pts;
  const crossO = (o: Vec2, a: Vec2, b: Vec2) => (a.x - o.x) * (b.y - o.y) - (a.y - o.y) * (b.x - o.x);
  const lower: Vec2[] = [];
  for (const p of pts) {
    while (lower.length >= 2 && crossO(lower[lower.length - 2]!, lower[lower.length - 1]!, p) <= 1e-9) lower.pop();
    lower.push(p);
  }
  const upper: Vec2[] = [];
  for (let i = pts.length - 1; i >= 0; i--) {
    const p = pts[i]!;
    while (upper.length >= 2 && crossO(upper[upper.length - 2]!, upper[upper.length - 1]!, p) <= 1e-9) upper.pop();
    upper.push(p);
  }
  return [...lower.slice(0, -1), ...upper.slice(0, -1)];
}

/** Lokale (unplatzierte) Projektion einer Box: konvexes Polygon + z-Bereich. */
export function boxLocalShape(box: GdClearanceBox): { polygon: Vec2[]; zMin: number; zMax: number } {
  const corners: Vec3[] = [];
  for (const x of [box.min.x, box.max.x])
    for (const y of [box.min.y, box.max.y])
      for (const z of [box.min.z, box.max.z]) {
        let p: Vec3 = { x, y, z };
        if (box.rotation) p = quatRotate(p, box.rotation);
        corners.push({ x: p.x + box.translation.x, y: p.y + box.translation.y, z: p.z + box.translation.z });
      }
  return {
    polygon: convexHull(corners.map((c) => ({ x: c.x, y: c.y }))),
    zMin: Math.min(...corners.map((c) => c.z)),
    zMax: Math.max(...corners.map((c) => c.z)),
  };
}

export function toWorld(local: Vec2, placement: Pick<Placement, 'x' | 'y' | 'rotationDeg'>): Vec2 {
  return add(rotate(local, placement.rotationDeg), { x: placement.x, y: placement.y });
}

/** Ersatzgrundriss für Gebäude ohne Kollisionsdaten (z. B. Signale): 1 × 1 m. */
const FALLBACK: GdClearanceBox = {
  min: { x: -0.5, y: -0.5, z: 0 },
  max: { x: 0.5, y: 0.5, z: 1 },
  translation: { x: 0, y: 0, z: 0 },
  soft: true,
};

/**
 * Übergabe zwischen Fabrik und Transportauftrag: Frachtplattformen (Zug) und
 * LKW-/Tanklaster-Stationen (Fahrzeug). `null` = keine Übergabe.
 */
export function transferInterface(gd: GdBuilding | undefined): 'train' | 'vehicle' | null {
  if (!gd) return null;
  if (gd.freightPlatform) return 'train';
  if (gd.nativeClass === 'FGBuildableDockingStation') return 'vehicle';
  return null;
}

/** Ladegut einer Übergabe: Feststoffe oder Flüssigkeiten. */
export function transferCargo(gd: GdBuilding): 'solid' | 'liquid' {
  if (gd.freightPlatform) return gd.freightPlatform.cargo;
  return (gd.ports?.pipeIn ?? 0) + (gd.ports?.pipeOut ?? 0) > 0 ? 'liquid' : 'solid';
}

/** Kann das Gebäude senkrecht eingebaut werden? (Pipeline-Pumpen) */
export function canBeVertical(gd: GdBuilding): boolean {
  return !!gd.pump && !!gd.bounds;
}

type Bounds = NonNullable<GdBuilding['bounds']>;

/**
 * Hülle eines Gebäudes in seiner Einbaulage. Senkrechte Pumpen stehen auf
 * ihrer Längsachse (lokal x): Der Querschnitt (z × y) wird zum Grundriss, die
 * Länge zur Höhe ab Unterkante.
 */
export function placedBounds(gd: GdBuilding, placement?: Pick<Placement, 'vertical'> | null): Bounds | null {
  const b = gd.bounds;
  if (!b) return null;
  if (!placement?.vertical || !canBeVertical(gd)) return b;
  return { minX: b.minZ, maxX: b.maxZ, minY: b.minY, maxY: b.maxY, minZ: 0, maxZ: b.maxX - b.minX };
}

/**
 * Grundrissteile eines platzierten Gebäudes. Feste und weiche Boxen werden
 * getrennt geliefert; ohne Kollisionsdaten wird ein markierter Ersatz genutzt.
 */
export function buildingFootprint(gd: GdBuilding, placement: Placement, floor: Floor | undefined): FootprintPart[] {
  const baseZ = (floor?.elevationM ?? 0) + placement.zOffsetM;
  if (placement.vertical && canBeVertical(gd)) {
    const b = placedBounds(gd, placement)!;
    const local = [
      { x: b.minX, y: b.minY },
      { x: b.maxX, y: b.minY },
      { x: b.maxX, y: b.maxY },
      { x: b.minX, y: b.maxY },
    ];
    return [{ polygon: local.map((p) => toWorld(p, placement)), zMin: baseZ + b.minZ, zMax: baseZ + b.maxZ, soft: false }];
  }
  const boxes = gd.clearance.length > 0 ? gd.clearance : [FALLBACK];
  return boxes.map((box) => {
    const s = boxLocalShape(box);
    return {
      polygon: s.polygon.map((p) => toWorld(p, placement)),
      zMin: baseZ + s.zMin,
      zMax: baseZ + s.zMax,
      soft: box.soft,
    };
  });
}

/** Umriss der Gesamthülle (Bounds) als Rechteck in Weltkoordinaten. */
export function buildingOutline(gd: GdBuilding, placement: Pick<Placement, 'x' | 'y' | 'rotationDeg' | 'vertical'>): Vec2[] {
  const b = placedBounds(gd, placement) ?? { minX: -0.5, maxX: 0.5, minY: -0.5, maxY: 0.5, minZ: 0, maxZ: 1 };
  return [
    { x: b.minX, y: b.minY },
    { x: b.maxX, y: b.minY },
    { x: b.maxX, y: b.maxY },
    { x: b.minX, y: b.maxY },
  ].map((p) => toWorld(p, placement));
}

export function buildingHeight(gd: GdBuilding, placement?: Pick<Placement, 'vertical'> | null): number {
  const b = placedBounds(gd, placement);
  return b ? b.maxZ - b.minZ : 0;
}

export function isPlaced(b: Building): b is Building & { placement: Placement } {
  return b.placement !== null;
}
