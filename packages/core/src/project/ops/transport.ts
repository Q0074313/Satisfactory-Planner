/**
 * Transportaufträge zwischen Fabriken.
 */
import type { GameDataIndex } from '../../gamedata/index.ts';
import { tr } from '../../i18n/index.ts';
import { newId } from '../../model/ids.ts';
import { placedPortDefs } from '../../factory/ports.ts';
import type { PortRef, Project, TransportMode, TransportOrder } from '../../model/schema.ts';
import { OpError } from '../errors.ts';

export type OrderInit = Omit<TransportOrder, 'id' | 'mode' | 'vehicle' | 'direct'> &
  Partial<Pick<TransportOrder, 'mode' | 'vehicle' | 'direct'>> & { id?: string };
export type OrderPatch = Partial<Omit<TransportOrder, 'id'>>;

/** Prüft einen Übergabeanschluss einer direkten Leitung. */
function checkEndpoint(p: Project, gd: GameDataIndex, ref: PortRef, factoryId: string, kind: 'belt' | 'pipe', role: 'from' | 'to'): void {
  const b = p.buildings[ref.buildingId];
  if (!b || b.factoryId !== factoryId || !b.placement) throw new OpError(tr('Der Übergabeanschluss muss an einem aufgestellten Gebäude der jeweiligen Fabrik liegen.'));
  const def = gd.building(b.type);
  const port = def ? placedPortDefs(def, b.placement).find((x) => x.id === ref.portId) : undefined;
  if (!port) throw new OpError(tr('{what} nicht gefunden.', { what: tr('Anschluss') }));
  if (port.kind !== kind) throw new OpError(tr('Förderband und Rohrleitung können nicht verbunden werden.'));
  if (role === 'from' && port.direction === 'in') throw new OpError(tr('Der Startanschluss ist ein Eingang.'));
  if (role === 'to' && port.direction === 'out') throw new OpError(tr('Der Zielanschluss ist ein Ausgang.'));
}

/** Standardangaben je Transportmittel (beim Wechsel des Transportmittels). */
export function defaultsFor(gd: GameDataIndex, mode: TransportMode, itemId: string): Pick<TransportOrder, 'vehicle' | 'direct'> {
  const solid = gd.item(itemId)?.form === 'solid';
  if (mode === 'vehicle') {
    const v = gd.vehicles.filter((x) => (x.cargo.kind === 'solid') === solid).at(-1) ?? gd.vehicles[0];
    return { vehicle: { type: v?.id ?? '', count: 1, distanceM: 1000, speedKmh: null }, direct: null };
  }
  if (mode === 'belt' || mode === 'pipe') {
    const tiers = mode === 'belt' ? gd.beltTiers : gd.pipeTiers;
    return { vehicle: null, direct: { tier: tiers[0]?.id ?? '', lines: 1, lengthM: 0, from: null, to: null } };
  }
  return { vehicle: null, direct: null };
}

function validate(p: Project, gd: GameDataIndex, o: Omit<TransportOrder, 'id'>): void {
  if (!gd.item(o.itemId)) throw new OpError(tr('Gegenstand {id} unbekannt.', { id: o.itemId }));
  if (!(o.ratePerMin >= 0)) throw new OpError(tr('Die Menge darf nicht negativ sein.'));
  if (!p.factories[o.fromFactoryId] || !p.factories[o.toFactoryId]) throw new OpError(tr('{what} nicht gefunden.', { what: tr('Fabrik') }));
  if (o.fromFactoryId === o.toFactoryId) throw new OpError(tr('Absender und Empfänger müssen verschiedene Fabriken sein.'));
  for (const sid of [o.fromStationId, o.toStationId]) if (sid && !p.stations[sid]) throw new OpError(tr('{what} nicht gefunden.', { what: tr('Bahnhof') }));
  if (o.fromStationId && o.fromStationId === o.toStationId) throw new OpError(tr('Lade- und Entladebahnhof müssen verschieden sein.'));
  for (const tid of o.trainIds) if (!p.trains[tid]) throw new OpError(tr('{what} nicht gefunden.', { what: tr('Zug') }));
  if (o.roundTripEstimateS !== null && !(o.roundTripEstimateS > 0)) throw new OpError(tr('Die Umlaufzeit muss größer als 0 sein.'));
  if (o.mode === 'vehicle') {
    if (!o.vehicle) throw new OpError(tr('Fahrzeugangaben fehlen.'));
    if (!gd.vehicle(o.vehicle.type)) throw new OpError(tr('{what} nicht gefunden.', { what: tr('Fahrzeug') }));
    if (!(o.vehicle.count >= 0) || !Number.isInteger(o.vehicle.count)) throw new OpError(tr('Die Anzahl muss eine ganze Zahl ab 0 sein.'));
    if (!(o.vehicle.distanceM >= 0)) throw new OpError(tr('Die Strecke darf nicht negativ sein.'));
  }
  if (o.mode === 'belt' || o.mode === 'pipe') {
    const d = o.direct;
    if (!d) throw new OpError(tr('Leitungsangaben fehlen.'));
    const tier = gd.building(d.tier);
    if (!tier || (o.mode === 'belt' ? !tier.conveyor : !tier.pipe)) throw new OpError(tr('Die gewählte Stufe passt nicht zur Verbindungsart.'));
    if (!(d.lines >= 1) || !Number.isInteger(d.lines)) throw new OpError(tr('Mindestens eine Leitung.'));
    if (d.from) checkEndpoint(p, gd, d.from, o.fromFactoryId, o.mode, 'from');
    if (d.to) checkEndpoint(p, gd, d.to, o.toFactoryId, o.mode, 'to');
  }
}

export function addOrder(p: Project, gd: GameDataIndex, init: OrderInit): string {
  const { id: _ignored, ...given } = init;
  const mode = given.mode ?? 'train';
  const rest = { ...defaultsFor(gd, mode, given.itemId), ...given, mode };
  validate(p, gd, rest);
  const id = newId('transportOrder');
  p.transportOrders[id] = { ...rest, id, trainIds: [...rest.trainIds] };
  return id;
}

export function updateOrder(p: Project, gd: GameDataIndex, id: string, patch: OrderPatch): void {
  const o = p.transportOrders[id];
  if (!o) throw new OpError(tr('{what} nicht gefunden.', { what: tr('Transportauftrag') }));
  const next = { ...o, ...patch };
  // Fabrikwechsel: Übergabeanschluss der alten Fabrik gilt nicht mehr
  if (next.direct && patch.direct === undefined) {
    const d = { ...next.direct };
    if (patch.fromFactoryId && patch.fromFactoryId !== o.fromFactoryId) d.from = null;
    if (patch.toFactoryId && patch.toFactoryId !== o.toFactoryId) d.to = null;
    next.direct = d;
  }
  validate(p, gd, next);
  Object.assign(o, patch, { direct: next.direct });
}

/** Entfernt Übergabeanschlüsse direkter Leitungen an Gebäuden, die gelöscht oder abgebaut werden. */
export function releaseEndpoints(p: Project, buildingIds: string[]): void {
  const set = new Set(buildingIds);
  for (const o of Object.values(p.transportOrders)) {
    if (!o.direct) continue;
    if (o.direct.from && set.has(o.direct.from.buildingId)) o.direct.from = null;
    if (o.direct.to && set.has(o.direct.to.buildingId)) o.direct.to = null;
  }
}

export function removeOrders(p: Project, ids: string[]): void {
  for (const id of ids) {
    if (!p.transportOrders[id]) throw new OpError(tr('{what} nicht gefunden.', { what: tr('Transportauftrag') }));
    delete p.transportOrders[id];
  }
}
