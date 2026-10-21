/**
 * Abgleich zwischen Bahnhöfen im Schienennetz und ihren Gebäuden im
 * Fabrikgrundriss (Bahnhofsgebäude und Bahnsteige), in beide Richtungen.
 *
 * Voraussetzung: Der Bahnhof ist einer Fabrik zugeordnet, die auf der Karte
 * steht (Schienennetze liegen in Weltkoordinaten, der Grundriss in lokalen).
 * Nach jeder Änderung vergleicht `syncStations` den Stand vorher und nachher:
 * - Bahnhof im Netz geändert (Lage, Bahnsteige, Zuordnung) → Gebäude folgen.
 * - Bahnhofsteil im Grundriss verschoben, gedreht, umgestellt (Be-/Entladen)
 *   oder gelöscht → Bahnhof im Netz folgt. Ein Bahnsteig, der an Ort und Stelle
 *   um 180° gedreht wird, wechselt die Seite seiner Anschlüsse.
 * - Fabrik auf der Karte verschoben → der Bahnhof wandert mit.
 *
 * Lage im Grundriss (wie in der Schienenansicht): Bahnhofsgebäude vorn
 * (16 m), dahinter die Bahnsteige (je 16 m); Gleisachse = lokale x-Achse der
 * Gebäude (Docs: 16 × 34 m), Höhe = Höhe des vorderen Bahnhofsknotens.
 */
import type { GameDataIndex } from '../../gamedata/index.ts';
import { add, normalize, normalizeDeg, rotate, scale, sub, type Vec2 } from '../../geometry/index.ts';
import { toLocalOf, toWorldOf } from '../../map/index.ts';
import type { Building, Factory, FactoryMapPlacement, Placement, Platform, Project, Station } from '../../model/schema.ts';
import { addBuilding, removeBuildings } from './factory.ts';
import { PLATFORM_LENGTH_M, removeStation, setPlatforms } from './rail.ts';

export const STATION_BUILDING = 'Build_TrainStation_C';
export const PLATFORM_BUILDING: Record<Platform['type'], string> = {
  freight: 'Build_TrainDockingStation_C',
  fluid: 'Build_TrainDockingStationLiquid_C',
  empty: 'Build_TrainPlatformEmpty_C',
};

interface ExpectedPart {
  platformId: string | null;
  type: string;
  placement: Placement;
  mode: 'load' | 'unload' | null;
  flipped: boolean;
}

const EPS = 1e-3;
const near = (a: number, b: number) => Math.abs(a - b) < EPS;
const r4 = (v: number) => Math.round(v * 1e4) / 1e4;
const deg = (v: Vec2) => (Math.atan2(v.y, v.x) * 180) / Math.PI;
const angleDiff = (a: number, b: number) => ((((a - b) % 360) + 540) % 360) - 180;

function samePlacement(a: Placement | null | undefined, b: Placement | null | undefined): boolean {
  if (!a || !b) return a === b;
  return a.floorId === b.floorId && near(a.x, b.x) && near(a.y, b.y) && near(a.zOffsetM, b.zOffsetM) && Math.abs(angleDiff(a.rotationDeg, b.rotationDeg)) < EPS;
}

const sameMap = (a: FactoryMapPlacement | null | undefined, b: FactoryMapPlacement | null | undefined) =>
  !!a && !!b && near(a.x, b.x) && near(a.y, b.y) && near(a.rotationDeg, b.rotationDeg);

/** Lage und Ausstattung eines Bahnhofs für den Vergleich vorher/nachher. */
function railSig(p: Project, st: Station): string {
  const b = p.railNodes[st.backNodeId];
  const f = p.railNodes[st.frontNodeId];
  return JSON.stringify([b?.position, b?.headingDeg, f?.position, st.factoryId, st.platforms]);
}

function floorFor(p: Project, f: Factory, z: number): { floorId: string; elevation: number } {
  const floors = f.floorIds.map((id) => p.floors[id]).filter((x): x is NonNullable<typeof x> => !!x);
  const below = floors.filter((fl) => fl.elevationM <= z + EPS).sort((a, b) => b.elevationM - a.elevationM)[0];
  const fl = below ?? floors.sort((a, b) => a.elevationM - b.elevationM)[0]!;
  return { floorId: fl.id, elevation: fl.elevationM };
}

/** Sollzustand der Bahnhofsteile im Grundriss der Fabrik. */
export function expectedStationParts(p: Project, gd: GameDataIndex, st: Station): ExpectedPart[] {
  const f = st.factoryId ? p.factories[st.factoryId] : undefined;
  const back = p.railNodes[st.backNodeId];
  const front = p.railNodes[st.frontNodeId];
  if (!f?.map || !back || !front) return [];
  const m = f.map;
  const u = normalize(sub(front.position, back.position));
  const heading = deg(u);
  const { floorId, elevation } = floorFor(p, f, front.position.z);
  const part = (k: number, platform: Platform | null): ExpectedPart => {
    const c = add(front.position, scale(u, -(PLATFORM_LENGTH_M / 2 + PLATFORM_LENGTH_M * k)));
    const l = toLocalOf(m, c);
    const flipped = platform?.flipped ?? false;
    return {
      platformId: platform?.id ?? null,
      type: platform ? PLATFORM_BUILDING[platform.type] : STATION_BUILDING,
      placement: { floorId, x: r4(l.x), y: r4(l.y), zOffsetM: r4(front.position.z - elevation), rotationDeg: r4(normalizeDeg(heading - m.rotationDeg + (flipped ? 180 : 0))) },
      mode: platform && platform.type !== 'empty' ? platform.mode : null,
      flipped,
    };
  };
  return [part(0, null), ...st.platforms.map((pl, i) => part(i + 1, pl))].filter((x) => gd.building(x.type));
}

const partsOf = (p: Project, stationId: string) => Object.values(p.buildings).filter((b) => b.stationPart?.stationId === stationId);

/** Weltlage (Mitte, Richtung, Höhe) eines Bahnhofsteils im Grundriss. */
function worldPose(p: Project, f: Factory & { map: FactoryMapPlacement }, pl: Placement, flipped: boolean) {
  const elevation = p.floors[pl.floorId]?.elevationM ?? 0;
  return { c: toWorldOf(f.map, pl), heading: pl.rotationDeg + f.map.rotationDeg - (flipped ? 180 : 0), z: elevation + pl.zOffsetM };
}

/** Bahnhofsknoten starr bewegen: Punkt → fn(Punkt), Richtung + dRot, Höhe + dz. */
function transformStation(p: Project, st: Station, fn: (q: Vec2) => Vec2, dRot: number, dz: number): void {
  for (const id of [st.backNodeId, st.frontNodeId]) {
    const n = p.railNodes[id];
    if (!n) continue;
    const q = fn(n.position);
    n.position = { x: r4(q.x), y: r4(q.y), z: r4(n.position.z + dz) };
    if (dRot) n.headingDeg = r4(normalizeDeg(n.headingDeg + dRot));
  }
}

/** Bestehende Bahnsteiggebäude mit diesem Bahnhof übernehmen, statt doppelt anzulegen. */
function adopt(p: Project, st: Station): void {
  if (partsOf(p, st.id).length) return;
  const free = Object.values(p.buildings).filter((b) => b.factoryId === st.factoryId && !b.stationPart && b.transfer?.stationId === st.id);
  for (const pl of st.platforms) {
    const i = free.findIndex((b) => b.type === PLATFORM_BUILDING[pl.type]);
    if (i < 0) continue;
    free.splice(i, 1)[0]!.stationPart = { stationId: st.id, platformId: pl.id };
  }
}

/** Gebäude im Grundriss auf den Sollzustand bringen. */
function writeParts(p: Project, gd: GameDataIndex, st: Station): void {
  const want = expectedStationParts(p, gd, st);
  const have = partsOf(p, st.id);
  const remove: string[] = [];
  for (const b of have) {
    const w = want.find((x) => x.platformId === b.stationPart!.platformId);
    if (!w || w.type !== b.type) remove.push(b.id);
  }
  if (remove.length) removeBuildings(p, remove);
  for (const w of want) {
    let b: Building | undefined = partsOf(p, st.id).find((x) => x.stationPart!.platformId === w.platformId);
    if (!b) {
      const id = addBuilding(p, gd, {
        factoryId: st.factoryId!,
        type: w.type,
        placement: w.placement,
        label: w.platformId ? '' : st.name,
        transfer: w.mode ? { mode: w.mode, stationId: st.id } : null,
      });
      b = p.buildings[id]!;
      b.stationPart = { stationId: st.id, platformId: w.platformId };
      continue;
    }
    if (!samePlacement(b.placement, w.placement)) b.placement = { ...w.placement };
    if (w.mode && (b.transfer?.mode !== w.mode || b.transfer.stationId !== st.id)) b.transfer = { mode: w.mode, stationId: st.id };
  }
}

/**
 * Gleicht Bahnhöfe und Bahnhofsteile ab. `prev` ist der Stand vor der
 * Änderung (unverändert), `p` der neue Stand, der angepasst wird.
 */
export function syncStations(prev: Project, p: Project, gd: GameDataIndex): void {
  for (const st of Object.values(p.stations)) {
    const f = st.factoryId ? p.factories[st.factoryId] : undefined;
    if (!f?.map) continue;
    const placed = f as Factory & { map: FactoryMapPlacement };
    adopt(p, st);
    const prevSt = prev.stations[st.id];
    const railChanged = !prevSt || railSig(prev, prevSt) !== railSig(p, st);
    const prevMap = prev.factories[f.id]?.map;
    if (!railChanged) {
      // Änderungen im Grundriss auf den Bahnhof übertragen
      const prevParts = Object.values(prev.buildings).filter((b) => b.stationPart?.stationId === st.id && b.factoryId === f.id);
      const now = partsOf(p, st.id);
      const deleted = prevParts.filter((b) => !p.buildings[b.id]);
      if (deleted.some((b) => b.stationPart!.platformId === null)) {
        removeStation(p, st.id);
        const rest = partsOf(p, st.id).map((b) => b.id);
        if (rest.length) removeBuildings(p, rest);
        continue;
      }
      let platforms = st.platforms;
      if (deleted.length) {
        const gone = new Set(deleted.map((b) => b.stationPart!.platformId));
        platforms = platforms.filter((pl) => !gone.has(pl.id));
      }
      // Be- bzw. Entladen im Grundriss umgestellt
      platforms = platforms.map((pl) => {
        const b = now.find((x) => x.stationPart!.platformId === pl.id);
        return b?.transfer && b.transfer.mode !== pl.mode ? { ...pl, mode: b.transfer.mode } : pl;
      });
      const moved = now.find((b) => {
        const before = prev.buildings[b.id];
        return before && !samePlacement(before.placement, b.placement) && b.placement;
      });
      if (moved && moved.placement) {
        const before = prev.buildings[moved.id]!;
        const pl = platforms.find((x) => x.id === moved.stationPart!.platformId);
        const flipped = pl?.flipped ?? false;
        const prevMapOk = prevMap && before.placement ? (prev.factories[f.id] as Factory & { map: FactoryMapPlacement }) : null;
        const a = before.placement && prevMapOk ? worldPose(prev, prevMapOk, before.placement, flipped) : null;
        const b = worldPose(p, placed, moved.placement, flipped);
        if (a) {
          const dRot = angleDiff(b.heading, a.heading);
          const inPlace = Math.hypot(a.c.x - b.c.x, a.c.y - b.c.y) < EPS && near(a.z, b.z);
          if (pl && inPlace && Math.abs(Math.abs(dRot) - 180) < EPS) {
            // Bahnsteig an Ort und Stelle umgedreht: Anschlüsse auf die andere Seite
            platforms = platforms.map((x) => (x.id === pl.id ? { ...x, flipped: !x.flipped } : x));
          } else {
            transformStation(p, st, (q) => add(b.c, rotate(sub(q, a.c), dRot)), dRot, b.z - a.z);
          }
        }
      } else if (prevMap && !sameMap(prevMap, f.map)) {
        // Fabrik auf der Karte verschoben: Bahnhof wandert mit
        const dRot = angleDiff(f.map.rotationDeg, prevMap.rotationDeg);
        transformStation(p, st, (q) => toWorldOf(placed.map, toLocalOf(prevMap, q)), dRot, 0);
      }
      if (platforms !== st.platforms) setPlatforms(p, st.id, platforms);
    }
    writeParts(p, gd, st);
  }
  // Teile ohne Bahnhof bzw. in der falschen Fabrik entfernen
  const orphans = Object.values(p.buildings).filter((b) => {
    if (!b.stationPart) return false;
    const st = p.stations[b.stationPart.stationId];
    return !st || st.factoryId !== b.factoryId;
  });
  if (orphans.length) removeBuildings(p, orphans.map((b) => b.id));
}
