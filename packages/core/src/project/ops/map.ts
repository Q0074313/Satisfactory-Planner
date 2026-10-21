/**
 * Operationen der Weltkarte: Fabrikstandorte und Verknüpfung von
 * Gewinnungsgebäuden mit Vorkommen.
 */
import type { GameDataIndex } from '../../gamedata/index.ts';
import { normalizeDeg } from '../../geometry/index.ts';
import { tr } from '../../i18n/index.ts';
import { canUseNode, factoryFootprint, nodeUsage, toLocalOf } from '../../map/index.ts';
import type { FactoryMapPlacement, Project } from '../../model/schema.ts';
import { OpError } from '../errors.ts';
import { addBuilding } from './factory.ts';

/** Setzt oder entfernt (`null`) den Standort einer Fabrik auf der Karte. */
export function setFactoryMap(p: Project, factoryId: string, placement: FactoryMapPlacement | null): void {
  const f = p.factories[factoryId];
  if (!f) throw new OpError(tr('{what} nicht gefunden.', { what: tr('Fabrik') }));
  if (placement && ![placement.x, placement.y, placement.rotationDeg].every(Number.isFinite)) throw new OpError(tr('Ungültiger Standort.'));
  f.map = placement ? { x: placement.x, y: placement.y, rotationDeg: normalizeDeg(placement.rotationDeg) } : null;
}

export function moveFactoryOnMap(p: Project, factoryId: string, dx: number, dy: number, dRotDeg = 0): void {
  const m = p.factories[factoryId]?.map;
  if (!m) throw new OpError(tr('Die Fabrik ist nicht auf der Karte platziert.'));
  setFactoryMap(p, factoryId, { x: m.x + dx, y: m.y + dy, rotationDeg: m.rotationDeg + dRotDeg });
}

/**
 * Verknüpft ein Gewinnungsgebäude mit einem Vorkommen (Rohstoff und Reinheit
 * werden übernommen) oder löst die Verknüpfung (`null`, Rohstoff bleibt).
 * Ein Vorkommen trägt nur ein Gebäude.
 */
export function assignNode(p: Project, gd: GameDataIndex, buildingId: string, nodeId: string | null): void {
  const b = p.buildings[buildingId];
  if (!b) throw new OpError(tr('{what} nicht gefunden.', { what: tr('Gebäude') }));
  if (nodeId === null) {
    if (b.extraction) b.extraction.nodeId = null;
    return;
  }
  const node = gd.mapNode(nodeId);
  if (!node) throw new OpError(tr('Vorkommen {id} ist in den Kartendaten nicht vorhanden.', { id: nodeId }));
  if (!canUseNode(gd, b.type, node)) throw new OpError(tr('{building} kann auf diesem Vorkommen nicht stehen.', { building: gd.name(b.type) }));
  const other = (nodeUsage(p).get(nodeId) ?? []).find((id) => id !== buildingId);
  if (other) {
    const ob = p.buildings[other]!;
    throw new OpError(tr('Das Vorkommen ist bereits mit {building} in {factory} belegt.', { building: ob.label || gd.name(ob.type), factory: p.factories[ob.factoryId]?.name ?? '' }));
  }
  b.extraction = { itemId: node.itemId!, purity: node.purity!, nodeId };
}

/** Bis zu diesem Abstand außerhalb des Grundrisses stellt „Belegen“ das Gebäude im Grundriss auf (m). */
export const OCCUPY_PLACE_REACH_M = 150;

/**
 * Belegt ein Vorkommen von der Karte aus: legt in der Fabrik ein passendes
 * Gewinnungsgebäude an und verknüpft es. Steht die Fabrik auf der Karte und
 * liegt das Vorkommen höchstens 150 m außerhalb ihres Grundrisses, wird das
 * Gebäude im untersten Stockwerk über dem Vorkommen aufgestellt, sonst bleibt
 * es geplant (nicht platziert). Liefert die Gebäude-ID.
 */
export function occupyNode(p: Project, gd: GameDataIndex, nodeId: string, factoryId: string, type: string): string {
  const f = p.factories[factoryId];
  if (!f) throw new OpError(tr('{what} nicht gefunden.', { what: tr('Fabrik') }));
  const node = gd.mapNode(nodeId);
  if (!node) throw new OpError(tr('Vorkommen {id} ist in den Kartendaten nicht vorhanden.', { id: nodeId }));
  if (!canUseNode(gd, type, node)) throw new OpError(tr('{building} kann auf diesem Vorkommen nicht stehen.', { building: gd.name(type) }));
  if ((nodeUsage(p).get(nodeId) ?? []).length) throw new OpError(tr('Das Vorkommen ist bereits belegt.'));
  const floorId = f.floorIds[0]!;
  let l = f.map ? toLocalOf(f.map, node) : null;
  if (l) {
    const r = factoryFootprint(p, gd, factoryId).rect;
    const out = Math.max(r.minX - l.x, l.x - r.maxX, r.minY - l.y, l.y - r.maxY, 0);
    if (out > OCCUPY_PLACE_REACH_M) l = null;
  }
  const id = addBuilding(p, gd, {
    factoryId,
    type,
    placement: l ? { floorId, x: Math.round(l.x * 1e4) / 1e4, y: Math.round(l.y * 1e4) / 1e4, zOffsetM: 0, rotationDeg: 0 } : null,
  });
  assignNode(p, gd, id, nodeId);
  return id;
}
