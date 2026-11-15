/**
 * Gebäude und Flächen einer anderen (oder neuen) Fabrik zuweisen, ohne ihre
 * Lage in der Welt zu ändern – z. B. wenn der Spielstand-Import zwei
 * Fabriken zusammengelegt hat.
 *
 * - Lage: Weltlage bleibt (Umrechnung über die Kartenstandorte; ohne Standort
 *   gilt der Ursprung). Eine neue Fabrik übernimmt den Standort der Quelle.
 * - Stockwerke: In der Zielfabrik wird das Stockwerk gleicher Bodenhöhe genutzt
 *   bzw. mit Art, Name und Höhe angelegt.
 * - Leitungen: zwischen verschobenen Gebäuden wandern sie mit; über die neue
 *   Fabrikgrenze werden sie zu direkten Transportaufträgen (Band bzw. Rohr) mit
 *   Gegenstand und Menge aus dem Durchsatzmodell. Ohne Fluss entfällt die Leitung.
 * - Bahnhofsteile bleiben, wo sie sind (sie folgen ihrem Bahnhof).
 */
import type { GameDataIndex } from '../../gamedata/index.ts';
import { normalizeDeg, type Vec2 } from '../../geometry/index.ts';
import { tr } from '../../i18n/index.ts';
import { toLocalOf, toWorldOf } from '../../map/index.ts';
import { newId } from '../../model/ids.ts';
import type { FactoryMapPlacement, Project, Vec3 } from '../../model/schema.ts';
import { computeFactoryFlow } from '../../factory/flow.ts';
import { linkPath, pathLength } from '../../factory/linkPath.ts';
import { makeFactory } from '../create.ts';
import { OpError } from '../errors.ts';
import { addOrder } from './transport.ts';

export interface ReassignResult {
  factoryId: string;
  buildings: number;
  areas: number;
  /** Leitungen über die neue Grenze, die zu Transportaufträgen wurden bzw. entfielen. */
  orders: number;
  removedLinks: number;
  notes: string[];
}

const ORIGIN: FactoryMapPlacement = { x: 0, y: 0, rotationDeg: 0 };
const r3 = (v: number) => Math.round(v * 1000) / 1000;

export function reassignToFactory(
  p: Project,
  gd: GameDataIndex,
  sel: { buildingIds: string[]; areaIds?: string[] },
  target: { factoryId: string } | { newName: string },
): ReassignResult {
  const notes: string[] = [];
  const all = sel.buildingIds.map((id) => p.buildings[id]).filter((b) => !!b && b.placement);
  const parts = all.filter((b) => b!.stationPart);
  if (parts.length) notes.push(tr('{n} Bahnhofsteile bleiben bei ihrem Bahnhof.', { n: parts.length }));
  const buildings = all.filter((b) => !b!.stationPart) as NonNullable<(typeof all)[number]>[];
  const areas = (sel.areaIds ?? []).map((id) => p.areas[id]).filter((a) => !!a) as NonNullable<Project['areas'][string]>[];
  const sources = new Set([...buildings.map((b) => b.factoryId), ...areas.map((a) => a.factoryId)]);
  if (!buildings.length && !areas.length) throw new OpError(tr('Nichts ausgewählt, das verschoben werden kann.'));
  if (sources.size !== 1) throw new OpError(tr('Bitte nur Objekte einer Fabrik auswählen.'));
  const sourceId = [...sources][0]!;
  const source = p.factories[sourceId]!;
  const srcMap = source.map ?? ORIGIN;

  // Zielfabrik
  let targetId: string;
  if ('newName' in target) {
    // Ohne das Erdgeschoss der Vorlage: Stockwerke entstehen nach Bodenhöhe
    const { factory } = makeFactory(p, target.newName.trim() || tr('Fabrik'));
    factory.map = source.map ? { ...source.map } : null;
    factory.floorIds = [];
    p.factories[factory.id] = factory;
    targetId = factory.id;
  } else {
    if (!p.factories[target.factoryId]) throw new OpError(tr('{what} nicht gefunden.', { what: tr('Fabrik') }));
    if (target.factoryId === sourceId) throw new OpError(tr('Die Objekte gehören bereits zu dieser Fabrik.'));
    targetId = target.factoryId;
  }
  const dest = p.factories[targetId]!;
  const dstMap = dest.map ?? ORIGIN;
  const toDest = (q: Vec2): Vec2 => {
    const w = toLocalOf(dstMap, toWorldOf(srcMap, q));
    return { x: r3(w.x), y: r3(w.y) };
  };
  const dRot = srcMap.rotationDeg - dstMap.rotationDeg;

  // Stockwerk gleicher Bodenhöhe in der Zielfabrik (oder neu)
  const floorMap = new Map<string, string>();
  const destFloor = (floorId: string): string => {
    const hit = floorMap.get(floorId);
    if (hit) return hit;
    const fl = p.floors[floorId]!;
    let match = dest.floorIds.map((id) => p.floors[id]!).find((x) => Math.abs(x.elevationM - fl.elevationM) < 0.01);
    if (!match) {
      match = { ...fl, id: newId('floor'), factoryId: targetId };
      p.floors[match.id] = match;
      dest.floorIds.push(match.id);
      dest.floorIds.sort((a, b) => p.floors[a]!.elevationM - p.floors[b]!.elevationM);
    }
    floorMap.set(floorId, match.id);
    return match.id;
  };

  // Fluss vorher (für Gegenstand und Menge der Leitungen über die neue Grenze)
  const moved = new Set(buildings.map((b) => b.id));
  const crossing = Object.values(p.links).filter((l) => l.factoryId === sourceId && moved.has(l.from.buildingId) !== moved.has(l.to.buildingId));
  const flow = crossing.length ? computeFactoryFlow(p, gd, sourceId) : null;
  const crossInfo = crossing.map((l) => {
    const res = flow?.links.get(l.id);
    const top = [...(res?.items ?? [])].sort((a, b) => b.perMin - a.perMin)[0];
    const path = linkPath(p, gd, l);
    return { l, top, total: res?.total ?? 0, lengthM: path ? Math.round(pathLength(path).total) : 0 };
  });

  for (const b of buildings) {
    const pl = b.placement!;
    const q = toDest(pl);
    b.placement = { ...pl, x: q.x, y: q.y, floorId: destFloor(pl.floorId), rotationDeg: r3(normalizeDeg(pl.rotationDeg + dRot)) };
    b.factoryId = targetId;
    b.groupInstance = null;
  }
  for (const a of areas) {
    a.polygon = a.polygon.map(toDest);
    a.floorId = destFloor(a.floorId);
    a.factoryId = targetId;
  }
  // Leitungen zwischen verschobenen Gebäuden wandern mit
  const moveWaypoint = (w: Vec3): Vec3 => ({ ...toDest(w), z: w.z });
  for (const l of Object.values(p.links)) {
    if (l.factoryId === sourceId && moved.has(l.from.buildingId) && moved.has(l.to.buildingId)) {
      l.factoryId = targetId;
      l.waypoints = l.waypoints.map(moveWaypoint);
    }
  }
  // Leitungen über die neue Grenze → Transportaufträge
  let orders = 0;
  let removed = 0;
  for (const { l, top, total, lengthM } of crossInfo) {
    delete p.links[l.id];
    const fromF = p.buildings[l.from.buildingId]!.factoryId;
    const toF = p.buildings[l.to.buildingId]!.factoryId;
    if (!top || total <= 1e-6) {
      removed++;
      continue;
    }
    try {
      addOrder(p, gd, {
        name: tr('{kind}: {item}', { kind: l.kind === 'belt' ? tr('Band') : tr('Rohr'), item: gd.name(top.itemId) }),
        itemId: top.itemId,
        ratePerMin: Math.round(total * 1000) / 1000,
        fromFactoryId: fromF,
        toFactoryId: toF,
        mode: l.kind,
        fromStationId: null,
        toStationId: null,
        trainIds: [],
        roundTripEstimateS: null,
        direct: { tier: l.tier, lines: 1, lengthM, from: { ...l.from }, to: { ...l.to } },
      });
      orders++;
    } catch {
      removed++;
    }
  }
  if (orders) notes.push(tr('{n} Leitungen über die neue Fabrikgrenze als Transportaufträge angelegt.', { n: orders }));
  if (removed) notes.push(tr('{n} Leitungen ohne Fluss über die neue Fabrikgrenze entfernt.', { n: removed }));
  return { factoryId: targetId, buildings: buildings.length, areas: areas.length, orders, removedLinks: removed, notes };
}
