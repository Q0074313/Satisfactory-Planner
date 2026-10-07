/**
 * Anschlüsse von Gebäuden.
 *
 * Die **Anzahl** der Anschlüsse stammt aus den Spieldaten (Wiki-Infobox bzw.
 * aus Rezepten abgeleitet). Die **Lage** der Anschlüsse ist in den Docs nicht
 * enthalten. Sie wird hier schematisch erzeugt (Eingänge an der Rückseite,
 * Ausgänge an der Vorderseite) und ist ausdrücklich nicht verifiziert.
 */
import { add, rotate, type Vec2 } from '../geometry/index.ts';
import { tr } from '../i18n/index.ts';
import type { GdBuilding, GdPortCounts } from '../gamedata/types.ts';
import type { Building, Floor, Placement, PortRef } from '../model/schema.ts';
import { canBeVertical, placedBounds, toWorld } from './geometry.ts';

export type PortDirection = 'in' | 'out' | 'any';

export interface PortDef {
  id: string;
  kind: 'belt' | 'pipe';
  direction: PortDirection;
  /** Lage relativ zum Gebäudeursprung (m). */
  local: Vec2;
  /** Richtung nach außen (Einheitsvektor, lokal). */
  normal: Vec2;
  /** Höhe über Gebäudeboden (m) – schematisch. */
  z: number;
  /** Immer false: Lage nicht aus Spieldaten belegt. */
  positionVerified: false;
  /** Besondere Aufgabe des Anschlusses (z. B. Treibstoff an LKW-Stationen). */
  role?: 'fuel';
  /** Senkrechter Anschluss (senkrechte Pumpe): Austritt nach oben (1) bzw. unten (−1). */
  vertical?: 1 | -1;
}

const cache = new WeakMap<GdBuilding, PortDef[]>();

export function portId(kind: 'belt' | 'pipe', dir: PortDirection, index: number): string {
  return `${kind}-${dir}-${index}`;
}

function spread(count: number, min: number, max: number): number[] {
  const out: number[] = [];
  for (let i = 0; i < count; i++) out.push(min + ((i + 1) * (max - min)) / (count + 1));
  return out;
}

export function portDefs(gd: GdBuilding): PortDef[] {
  const cached = cache.get(gd);
  if (cached) return cached;
  const ports = computePortDefs(gd.ports, gd);
  cache.set(gd, ports);
  return ports;
}

function computePortDefs(counts: GdPortCounts | null, gd: GdBuilding): PortDef[] {
  if (!counts) return [];
  const b = gd.bounds ?? { minX: -1, maxX: 1, minY: -1, maxY: 1, minZ: 0, maxZ: 2 };
  const cx = (b.minX + b.maxX) / 2;
  const cy = (b.minY + b.maxY) / 2;
  const z = Math.min(1, (b.maxZ - b.minZ) / 2);
  const ports: PortDef[] = [];
  const push = (kind: 'belt' | 'pipe', direction: PortDirection, index: number, local: Vec2, normal: Vec2) =>
    ports.push({ id: portId(kind, direction, index), kind, direction, local, normal, z, positionVerified: false });

  const back = { x: 0, y: -1 };
  const front = { x: 0, y: 1 };
  const left = { x: -1, y: 0 };
  const right = { x: 1, y: 0 };

  // Splitter (1 → 3) und Zusammenführungen (3 → 1): Seiten wie im Spiel üblich.
  if (counts.beltIn === 1 && counts.beltOut === 3 && counts.pipeIn + counts.pipeOut + counts.pipeAny === 0) {
    push('belt', 'in', 0, { x: cx, y: b.minY }, back);
    push('belt', 'out', 0, { x: b.minX, y: cy }, left);
    push('belt', 'out', 1, { x: cx, y: b.maxY }, front);
    push('belt', 'out', 2, { x: b.maxX, y: cy }, right);
    return ports;
  }
  if (counts.beltIn === 3 && counts.beltOut === 1 && counts.pipeIn + counts.pipeOut + counts.pipeAny === 0) {
    push('belt', 'in', 0, { x: b.minX, y: cy }, left);
    push('belt', 'in', 1, { x: cx, y: b.minY }, back);
    push('belt', 'in', 2, { x: b.maxX, y: cy }, right);
    push('belt', 'out', 0, { x: cx, y: b.maxY }, front);
    return ports;
  }
  if (counts.pipeAny > 0) {
    const sides: [Vec2, Vec2][] = [
      [{ x: cx, y: b.minY }, back],
      [{ x: b.maxX, y: cy }, right],
      [{ x: cx, y: b.maxY }, front],
      [{ x: b.minX, y: cy }, left],
    ];
    for (let i = 0; i < counts.pipeAny; i++) {
      const [pos, n] = sides[i % 4]!;
      push('pipe', 'any', i, pos, n);
    }
    return ports;
  }

  // Weltraumlift: sechs Bandeingänge, je drei auf gegenüberliegenden Seiten
  if (gd.nativeClass === 'FGBuildableSpaceElevator' && counts.beltIn === 6 && counts.beltOut + counts.pipeIn + counts.pipeOut === 0) {
    const xs = spread(3, b.minX, b.maxX);
    xs.forEach((x, i) => push('belt', 'in', i, { x, y: b.minY }, back));
    xs.forEach((x, i) => push('belt', 'in', i + 3, { x, y: b.maxY }, front));
    return ports;
  }

  // Allgemein: Eingänge hinten (−y), Ausgänge vorn (+y), Bänder vor Rohren.
  const inKinds: ('belt' | 'pipe')[] = [...Array(counts.beltIn).fill('belt'), ...Array(counts.pipeIn).fill('pipe')];
  const outKinds: ('belt' | 'pipe')[] = [...Array(counts.beltOut).fill('belt'), ...Array(counts.pipeOut).fill('pipe')];
  const inX = spread(inKinds.length, b.minX, b.maxX);
  const outX = spread(outKinds.length, b.minX, b.maxX);
  const idx = { belt: 0, pipe: 0 };
  inKinds.forEach((k, i) => push(k, 'in', idx[k]++, { x: inX[i]!, y: b.minY }, back));
  idx.belt = 0;
  idx.pipe = 0;
  outKinds.forEach((k, i) => push(k, 'out', idx[k]++, { x: outX[i]!, y: b.maxY }, front));
  // LKW- und Tanklaster-Station: Der äußerste Bandeingang füllt nur den
  // Treibstoffplatz (Wiki „Truck Station“). Er liegt hier als erster Eingang außen.
  if (gd.nativeClass === 'FGBuildableDockingStation' && counts.beltIn > 0) {
    const fuel = ports.find((p) => p.id === portId('belt', 'in', 0));
    if (fuel) fuel.role = 'fuel';
  }
  return ports;
}

const verticalCache = new WeakMap<GdBuilding, Record<'up' | 'down', PortDef[]>>();

/**
 * Anschlüsse einer senkrecht eingebauten Pumpe: Eingang unten, Ausgang oben
 * (Förderrichtung „up“) bzw. umgekehrt. Im Grundriss liegen beide leicht
 * versetzt, damit sie einzeln anklickbar sind.
 */
function verticalPortDefs(gd: GdBuilding, dir: 'up' | 'down'): PortDef[] {
  let c = verticalCache.get(gd);
  if (!c) {
    const b = placedBounds(gd, { vertical: 'up' })!;
    const top = b.maxZ;
    const make = (direction: 'in' | 'out', atTop: boolean, y: number): PortDef => ({
      id: portId('pipe', direction, 0),
      kind: 'pipe',
      direction,
      local: { x: 0, y },
      normal: { x: 0, y: 0 },
      z: atTop ? top : 0,
      positionVerified: false,
      vertical: atTop ? 1 : -1,
    });
    const off = Math.min(0.3, (b.maxY - b.minY) / 4);
    c = {
      up: [make('in', false, -off), make('out', true, off)],
      down: [make('in', true, -off), make('out', false, off)],
    };
    verticalCache.set(gd, c);
  }
  return c[dir];
}

/** Anschlüsse eines Gebäudes in seiner Einbaulage. */
export function placedPortDefs(gd: GdBuilding, placement: Pick<Placement, 'vertical'> | null | undefined): PortDef[] {
  return placement?.vertical && canBeVertical(gd) ? verticalPortDefs(gd, placement.vertical) : portDefs(gd);
}

export interface WorldPort extends PortDef {
  buildingId: string;
  world: { x: number; y: number; z: number };
  worldNormal: Vec2;
}

export function worldPorts(building: Building, gd: GdBuilding, floor: Floor | undefined): WorldPort[] {
  if (!building.placement) return [];
  const p = building.placement;
  const baseZ = (floor?.elevationM ?? 0) + p.zOffsetM;
  return placedPortDefs(gd, p).map((d) => {
    const w = toWorld(d.local, p);
    return {
      ...d,
      buildingId: building.id,
      world: { x: w.x, y: w.y, z: baseZ + d.z },
      worldNormal: rotate(d.normal, p.rotationDeg),
    };
  });
}

export function findPort(gd: GdBuilding, ref: PortRef): PortDef | undefined {
  return portDefs(gd).find((p) => p.id === ref.portId);
}

/** Punkt kurz vor dem Anschluss (für Leitungsführung). */
export function portStub(port: WorldPort, distance = 1): Vec2 {
  return add({ x: port.world.x, y: port.world.y }, { x: port.worldNormal.x * distance, y: port.worldNormal.y * distance });
}

/** Höhe des ersten Leitungspunkts vor dem Anschluss (senkrechte Anschlüsse: darüber bzw. darunter). */
export function portStubZ(port: Pick<WorldPort, 'world' | 'vertical'>, distance = 1): number {
  return port.world.z + (port.vertical ?? 0) * distance;
}

/** Können zwei Anschlüsse verbunden werden? Liefert Fehlertext oder null. */
export function portCompatibility(from: PortDef, to: PortDef): string | null {
  if (from.kind !== to.kind) return tr('Förderband und Rohrleitung können nicht verbunden werden.');
  if (from.direction === 'in') return tr('Der Startanschluss ist ein Eingang.');
  if (to.direction === 'out') return tr('Der Zielanschluss ist ein Ausgang.');
  return null;
}

/**
 * Bringt zwei in beliebiger Reihenfolge angeklickte Anschlüsse in
 * Flussrichtung (Ausgang → Eingang). `reversed` = Reihenfolge wurde getauscht.
 * Liefert einen Fehlertext, wenn keine Richtung passt.
 */
export function orientPorts<T extends PortDef>(a: T, b: T): { from: T; to: T; reversed: boolean } | { error: string } {
  if (a.kind !== b.kind) return { error: tr('Förderband und Rohrleitung können nicht verbunden werden.') };
  if (a.direction === 'in' && b.direction === 'in') return { error: tr('Zwei Eingänge können nicht verbunden werden.') };
  if (a.direction === 'out' && b.direction === 'out') return { error: tr('Zwei Ausgänge können nicht verbunden werden.') };
  if (a.direction === 'in' || b.direction === 'out') return { from: b, to: a, reversed: true };
  return { from: a, to: b, reversed: false };
}
