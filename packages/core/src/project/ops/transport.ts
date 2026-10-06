/**
 * Transportaufträge zwischen Fabriken.
 */
import type { GameDataIndex } from '../../gamedata/index.ts';
import { tr } from '../../i18n/index.ts';
import { newId } from '../../model/ids.ts';
import type { Project, TransportOrder } from '../../model/schema.ts';
import { OpError } from '../errors.ts';

export type OrderInit = Omit<TransportOrder, 'id'> & { id?: string };
export type OrderPatch = Partial<Omit<TransportOrder, 'id'>>;

function validate(p: Project, gd: GameDataIndex, o: Omit<TransportOrder, 'id'>): void {
  if (!gd.item(o.itemId)) throw new OpError(tr('Gegenstand {id} unbekannt.', { id: o.itemId }));
  if (!(o.ratePerMin >= 0)) throw new OpError(tr('Die Menge darf nicht negativ sein.'));
  if (!p.factories[o.fromFactoryId] || !p.factories[o.toFactoryId]) throw new OpError(tr('{what} nicht gefunden.', { what: tr('Fabrik') }));
  if (o.fromFactoryId === o.toFactoryId) throw new OpError(tr('Absender und Empfänger müssen verschiedene Fabriken sein.'));
  for (const sid of [o.fromStationId, o.toStationId]) if (sid && !p.stations[sid]) throw new OpError(tr('{what} nicht gefunden.', { what: tr('Bahnhof') }));
  if (o.fromStationId && o.fromStationId === o.toStationId) throw new OpError(tr('Lade- und Entladebahnhof müssen verschieden sein.'));
  for (const tid of o.trainIds) if (!p.trains[tid]) throw new OpError(tr('{what} nicht gefunden.', { what: tr('Zug') }));
  if (o.roundTripEstimateS !== null && !(o.roundTripEstimateS > 0)) throw new OpError(tr('Die Umlaufzeit muss größer als 0 sein.'));
}

export function addOrder(p: Project, gd: GameDataIndex, init: OrderInit): string {
  const { id: _ignored, ...rest } = init;
  validate(p, gd, rest);
  const id = newId('transportOrder');
  p.transportOrders[id] = { ...rest, id, trainIds: [...rest.trainIds] };
  return id;
}

export function updateOrder(p: Project, gd: GameDataIndex, id: string, patch: OrderPatch): void {
  const o = p.transportOrders[id];
  if (!o) throw new OpError(tr('{what} nicht gefunden.', { what: tr('Transportauftrag') }));
  const next = { ...o, ...patch };
  validate(p, gd, next);
  Object.assign(o, patch);
}

export function removeOrders(p: Project, ids: string[]): void {
  for (const id of ids) {
    if (!p.transportOrders[id]) throw new OpError(tr('{what} nicht gefunden.', { what: tr('Transportauftrag') }));
    delete p.transportOrders[id];
  }
}
