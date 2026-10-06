/**
 * Schätzungen für den Zugtransport zwischen Fabriken.
 *
 * - Kapazität je Umlauf: Güterwagen × 32 Stapel × Stapelgröße (Feststoffe)
 *   bzw. Flüssigkeitswagen × 2400 m³ (Wiki „Freight Car“).
 * - Umlaufzeit: Summe der kürzesten Wege zwischen den Halten des Fahrplans
 *   geteilt durch die angenommene Durchschnittsgeschwindigkeit, plus je Halt
 *   Umschlagzeit (27,08 s) und Wartezeit. Wartezeiten an Signalen fehlen.
 * - Teilen sich mehrere Aufträge einen Zug, wird seine Kapazität im
 *   Verhältnis der Auftragsmengen aufgeteilt (je Wagenart).
 *
 * Alle Werte sind Schätzungen und werden in der Oberfläche so gekennzeichnet.
 * Gemessene Umlaufzeiten aus der Simulation oder ein manueller Wert im Auftrag
 * ersetzen die Schätzung.
 */
import type { GameDataIndex } from '../gamedata/index.ts';
import { tr } from '../i18n/index.ts';
import type { Project, Train, TransportOrder } from '../model/schema.ts';
import { machineRates } from '../production/machine.ts';
import { solveProduction } from '../production/solver.ts';
import { buildGraph, isBidirectional, shortestRoute } from '../rail/topology.ts';

export type CargoKind = 'solid' | 'liquid';

export function cargoKind(gd: GameDataIndex, itemId: string): CargoKind {
  return gd.item(itemId)?.form === 'solid' ? 'solid' : 'liquid';
}

/** Kapazität eines Zuges für einen Gegenstand je Fahrt (Stück bzw. m³). */
export function trainCapacity(gd: GameDataIndex, train: Train, itemId: string): number {
  const kind = cargoKind(gd, itemId);
  const wagons = train.consist.filter((v) => v.kind === 'wagon' && v.cargo === kind).length;
  if (kind === 'liquid') return wagons * (gd.fact('rail.freightCar.fluidM3') ?? 2400);
  const slots = gd.fact('rail.freightCar.slots') ?? 32;
  return wagons * slots * (gd.item(itemId)?.stackSize ?? 0);
}

export interface CycleLeg {
  fromStationId: string;
  toStationId: string;
  lengthM: number | null;
}

export interface CycleEstimate {
  trainId: string;
  legs: CycleLeg[];
  /** Alle Abschnitte befahrbar. */
  complete: boolean;
  lengthM: number;
  travelS: number;
  stopS: number;
  /** Geschätzte Umlaufzeit oder null, wenn ein Abschnitt fehlt. */
  cycleS: number | null;
}

export function estimateTrainCycle(p: Project, gd: GameDataIndex, trainId: string): CycleEstimate {
  const t = p.trains[trainId];
  const empty: CycleEstimate = { trainId, legs: [], complete: false, lengthM: 0, travelS: 0, stopS: 0, cycleS: null };
  if (!t?.timetableId) return empty;
  const tt = p.timetables[t.timetableId];
  if (!tt || tt.stops.length < 2) return empty;
  const g = buildGraph(p, t.networkId);
  const penalty = gd.fact('rail.station.passThroughPenaltyM') ?? 100;
  const speed = (p.settings.simulation.trainAverageSpeedKmh * 1000) / 3600;
  const legs: CycleLeg[] = [];
  let lengthM = 0;
  let complete = true;
  tt.stops.forEach((s, i) => {
    const next = tt.stops[(i + 1) % tt.stops.length]!;
    if (s.stationId === next.stationId) {
      legs.push({ fromStationId: s.stationId, toStationId: next.stationId, lengthM: 0 });
      return;
    }
    // Wegwahl mit Bahnhofsaufschlag wie im Spiel, Länge ohne Aufschlag
    const r = shortestRoute(p, g, { fromStationId: s.stationId, toStationId: next.stationId, bidirectional: isBidirectional(t), passThroughPenaltyM: penalty });
    const len = r ? r.states.reduce((sum, st) => sum + (g.lengths.get(st.segId) ?? 0), 0) : null;
    legs.push({ fromStationId: s.stationId, toStationId: next.stationId, lengthM: len });
    if (len !== null) lengthM += len;
    else complete = false;
  });
  const stopS = tt.stops.reduce((sum, s) => sum + p.settings.simulation.dockingS + s.waitS, 0);
  const travelS = lengthM / speed;
  return { trainId, legs, complete, lengthM, travelS, stopS, cycleS: complete ? travelS + stopS : null };
}

export interface OrderTrainEstimate {
  trainId: string;
  servesFrom: boolean;
  servesTo: boolean;
  capacityPerCycle: number;
  /** Anteil der Zugkapazität für diesen Auftrag (0 … 1). */
  share: number;
  cycleS: number | null;
  cycleSource: 'estimate' | 'measured' | 'manual';
  perMin: number;
}

export interface OrderEstimate {
  orderId: string;
  rate: number;
  trains: OrderTrainEstimate[];
  /** Geschätzter Gesamtdurchsatz aller Züge des Auftrags (/min bzw. m³/min). */
  perMin: number;
  ok: boolean;
}

export function estimateOrder(
  p: Project,
  gd: GameDataIndex,
  order: TransportOrder,
  opts: { measuredCycleS?: Map<string, number> } = {},
): OrderEstimate {
  const kind = cargoKind(gd, order.itemId);
  const trains: OrderTrainEstimate[] = [];
  for (const trainId of order.trainIds) {
    const t = p.trains[trainId];
    if (!t) continue;
    const tt = t.timetableId ? p.timetables[t.timetableId] : undefined;
    const stops = new Set(tt?.stops.map((s) => s.stationId) ?? []);
    const servesFrom = order.fromStationId ? stops.has(order.fromStationId) : stops.size > 0;
    const servesTo = order.toStationId ? stops.has(order.toStationId) : stops.size > 0;
    const sharing = Object.values(p.transportOrders).filter((o) => o.trainIds.includes(trainId) && cargoKind(gd, o.itemId) === kind);
    const totalRate = sharing.reduce((s, o) => s + o.ratePerMin, 0);
    const share = totalRate > 0 ? order.ratePerMin / totalRate : 1 / Math.max(1, sharing.length);
    const measured = opts.measuredCycleS?.get(trainId);
    const cycle =
      order.roundTripEstimateS !== null
        ? { s: order.roundTripEstimateS, src: 'manual' as const }
        : measured !== undefined
          ? { s: measured, src: 'measured' as const }
          : { s: estimateTrainCycle(p, gd, trainId).cycleS, src: 'estimate' as const };
    const capacityPerCycle = trainCapacity(gd, t, order.itemId);
    const perMin = cycle.s && servesFrom && servesTo ? (capacityPerCycle * share * 60) / cycle.s : 0;
    trains.push({ trainId, servesFrom, servesTo, capacityPerCycle, share, cycleS: cycle.s, cycleSource: cycle.src, perMin });
  }
  const perMin = trains.reduce((s, x) => s + x.perMin, 0);
  return { orderId: order.id, rate: order.ratePerMin, trains, perMin, ok: perMin + 1e-6 >= order.ratePerMin };
}

export interface TradeRow {
  itemId: string;
  /** Erzeugung der angelegten Maschinen. */
  produced: number;
  consumed: number;
  /** Erzeugung − Verbrauch (ohne Transport). */
  net: number;
  imports: number;
  exports: number;
  /** Importbedarf laut Produktionsplänen der Fabrik. */
  planImports: number;
  /** Nicht gedeckter Importbedarf (> 0 = Lücke). */
  importGap: number;
  /** Ausfuhr über dem Überschuss (> 0 = Lücke beim Absender). */
  exportGap: number;
}

/** Bilanz einer Fabrik mit Ein- und Ausfuhren (lokal vs. extern). */
export function factoryTrade(p: Project, gd: GameDataIndex, factoryId: string): TradeRow[] {
  const rows = new Map<string, TradeRow>();
  const row = (itemId: string) => {
    let r = rows.get(itemId);
    if (!r) {
      r = { itemId, produced: 0, consumed: 0, net: 0, imports: 0, exports: 0, planImports: 0, importGap: 0, exportGap: 0 };
      rows.set(itemId, r);
    }
    return r;
  };
  for (const b of Object.values(p.buildings)) {
    if (b.factoryId !== factoryId) continue;
    const r = machineRates(gd, b);
    for (const o of r.outputs) row(o.item).produced += o.perMin;
    for (const i of r.inputs) row(i.item).consumed += i.perMin;
  }
  for (const o of Object.values(p.transportOrders)) {
    if (o.toFactoryId === factoryId) row(o.itemId).imports += o.ratePerMin;
    if (o.fromFactoryId === factoryId) row(o.itemId).exports += o.ratePerMin;
  }
  for (const plan of Object.values(p.productionPlans)) {
    if (plan.factoryId !== factoryId) continue;
    const imports = plan.supplies.filter((s) => s.origin === 'import');
    if (imports.length === 0) continue;
    const res = solveProduction(gd, plan, { existingMachines: Object.values(p.buildings).filter((b) => b.factoryId === factoryId) });
    for (const s of imports) {
      const used = res.items.find((i) => i.itemId === s.itemId)?.supplied ?? 0;
      row(s.itemId).planImports += used;
    }
  }
  for (const r of rows.values()) {
    r.net = r.produced - r.consumed;
    r.importGap = Math.max(0, r.planImports - r.imports);
    r.exportGap = Math.max(0, r.exports - Math.max(0, r.net + r.imports));
  }
  return [...rows.values()];
}

export function transportAssumptions(p: Project, gd: GameDataIndex): string[] {
  return [
    tr('Durchschnittsgeschwindigkeit {v} km/h (inkl. Anfahren und Bremsen).', { v: p.settings.simulation.trainAverageSpeedKmh }),
    tr('Umschlag {s} s je Halt plus Wartezeit laut Fahrplan (Wiki: 27,08 s).', { s: p.settings.simulation.dockingS }),
    tr('Wagen werden vollständig beladen: {slots} Stapel × Stapelgröße bzw. {m3} m³.', { slots: gd.fact('rail.freightCar.slots') ?? 32, m3: gd.fact('rail.freightCar.fluidM3') ?? 2400 }),
    tr('Keine Wartezeiten an Signalen; mehrere Aufträge teilen sich einen Zug im Verhältnis ihrer Mengen.'),
  ];
}
