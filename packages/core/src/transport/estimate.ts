/**
 * Schätzungen für den Transport zwischen Fabriken (Zug, Fahrzeug, direkte
 * Leitung).
 *
 * Fahrzeuge (Traktor, LKW, Tanklaster, Explorer): Laderaum aus den Docs
 * (Stapel × Stapelgröße bzw. 3200 m³ laut Wiki) × Anzahl je Umlauf; Umlauf =
 * 2 × Strecke / Geschwindigkeit + 2 × Andockzeit (Wiki „Truck Station“: 8 s).
 * Ohne eigene Angabe gilt die Höchstgeschwindigkeit laut Wiki (optimistisch).
 *
 * Drohnen: Laderaum 9 Stapel (Docs); Umlauf = 2 × (Entfernung / Geschwindigkeit
 * + 2 × 51 s Start bzw. Landung) (Wiki „Drone“, Geschwindigkeit je Brennstoff);
 * Brennstoff je Umlauf = (24 000 MJ + 6 MJ/m × Entfernung) / Energiewert
 * (Docs mTripPowerCost, mTripPowerPerMeterCost). Ob die Entfernung einfach
 * oder doppelt zählt, ist nicht belegt; angenommen: einfach (Wiki: 4 Batterien
 * + 1 Batterie je km).
 *
 * Direkte Leitung: Kapazität = Stufe × Anzahl paralleler Leitungen (exakt).
 *
 * Zug:
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
import type { Project, TimetableStop, Train, TransportMode, TransportOrder } from '../model/schema.ts';
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
  const scheduled = new Set(tt.stops.map((s) => s.stationId));
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
    const r = shortestRoute(p, g, { fromStationId: s.stationId, toStationId: next.stationId, bidirectional: isBidirectional(t), passThroughPenaltyM: penalty, scheduledStationIds: scheduled });
    const len = r ? r.states.reduce((sum, st) => sum + (g.lengths.get(st.segId) ?? 0), 0) : null;
    legs.push({ fromStationId: s.stationId, toStationId: next.stationId, lengthM: len });
    if (len !== null) lengthM += len;
    else complete = false;
  });
  const stopS = tt.stops.reduce((sum, s) => sum + p.settings.simulation.dockingS + s.waitS, 0);
  const travelS = lengthM / speed;
  return { trainId, legs, complete, lengthM, travelS, stopS, cycleS: complete ? travelS + stopS : null };
}

/** Wird der Gegenstand an diesem Halt umgeschlagen? */
export function stopTransfersItem(stop: Pick<TimetableStop, 'transfer' | 'itemIds'>, itemId: string): boolean {
  return stop.transfer === 'all' || (stop.transfer === 'items' && stop.itemIds.includes(itemId));
}

export interface OrderTrainEstimate {
  trainId: string;
  /** Zug hält am Lade- bzw. Entladebahnhof und schlägt den Gegenstand dort um. */
  servesFrom: boolean;
  servesTo: boolean;
  /** Zug hält dort, der Halt schließt den Gegenstand aber vom Umschlag aus. */
  excludedFrom: boolean;
  excludedTo: boolean;
  capacityPerCycle: number;
  /** Anteil der Zugkapazität für diesen Auftrag (0 … 1). */
  share: number;
  cycleS: number | null;
  cycleSource: 'estimate' | 'measured' | 'manual';
  perMin: number;
}

export interface OrderVehicleEstimate {
  vehicleId: string;
  count: number;
  /** Ladegut des Fahrzeugs passt zum Gegenstand. */
  kindOk: boolean;
  capacityPerTrip: number;
  speedKmh: number;
  dockingS: number;
  cycleS: number | null;
  cycleSource: 'estimate' | 'manual';
  perMin: number;
}

export interface OrderDroneEstimate {
  count: number;
  /** Nur Feststoffe. */
  kindOk: boolean;
  capacityPerTrip: number;
  speedMps: number;
  fuelId: string;
  /** Brennstoff je Umlauf und Drohne (Stück). */
  fuelPerTrip: number;
  /** Brennstoff aller Drohnen pro Minute. */
  fuelPerMin: number;
  cycleS: number | null;
  cycleSource: 'estimate' | 'manual';
  perMin: number;
}

export interface OrderDirectEstimate {
  tier: string;
  lines: number;
  /** Band für Feststoffe bzw. Rohr für Flüssigkeiten. */
  kindOk: boolean;
  /** Kapazität aller Leitungen (/min bzw. m³/min). */
  capacity: number;
}

export interface OrderEstimate {
  orderId: string;
  rate: number;
  mode: TransportMode;
  trains: OrderTrainEstimate[];
  vehicle: OrderVehicleEstimate | null;
  drone: OrderDroneEstimate | null;
  direct: OrderDirectEstimate | null;
  /** Geschätzter Gesamtdurchsatz (/min bzw. m³/min). */
  perMin: number;
  ok: boolean;
}

/** Fahrzeugtransport: Laderaum je Fahrt, Umlaufzeit und Durchsatz. */
export function estimateVehicleOrder(gd: GameDataIndex, order: TransportOrder): OrderVehicleEstimate | null {
  const v = order.vehicle;
  const def = v ? gd.vehicle(v.type) : undefined;
  if (!v || !def) return null;
  const kind = cargoKind(gd, order.itemId);
  const kindOk = def.cargo.kind === kind;
  const capacityPerTrip = !kindOk ? 0 : def.cargo.kind === 'liquid' ? def.cargo.m3 : def.cargo.slots * (gd.item(order.itemId)?.stackSize ?? 0);
  const speedKmh = v.speedKmh ?? def.maxSpeedKmh;
  const dockingS = gd.fact('vehicle.docking.durationS') ?? 8;
  const estimate = speedKmh > 0 ? (2 * v.distanceM) / ((speedKmh * 1000) / 3600) + 2 * dockingS : null;
  const cycleS = order.roundTripEstimateS ?? estimate;
  const perMin = cycleS && cycleS > 0 ? (v.count * capacityPerTrip * 60) / cycleS : 0;
  return { vehicleId: def.id, count: v.count, kindOk, capacityPerTrip, speedKmh, dockingS, cycleS, cycleSource: order.roundTripEstimateS !== null ? 'manual' : 'estimate', perMin };
}

/** Drohnentransport: Laderaum, Umlaufzeit, Brennstoff und Durchsatz. */
export function estimateDroneOrder(gd: GameDataIndex, order: TransportOrder): OrderDroneEstimate | null {
  const d = order.drone;
  if (!d || order.mode !== 'drone') return null;
  const kindOk = cargoKind(gd, order.itemId) === 'solid';
  const capacityPerTrip = kindOk ? (gd.fact('drone.slots') ?? 9) * (gd.item(order.itemId)?.stackSize ?? 0) : 0;
  const speedMps = gd.fact(`drone.speedMps.${d.fuelId}`) ?? 0;
  const animS = gd.fact('drone.takeoffLandingS') ?? 51;
  const estimate = speedMps > 0 ? 2 * (d.distanceM / speedMps + 2 * animS) : null;
  const cycleS = order.roundTripEstimateS ?? estimate;
  const energy = gd.item(d.fuelId)?.energyMJ ?? 0;
  const fuelPerTrip = energy > 0 ? ((gd.fact('drone.tripEnergyMJ') ?? 24000) + (gd.fact('drone.energyPerMeterMJ') ?? 6) * d.distanceM) / energy : 0;
  const perMinFactor = cycleS && cycleS > 0 ? (d.count * 60) / cycleS : 0;
  return {
    count: d.count,
    kindOk,
    capacityPerTrip,
    speedMps,
    fuelId: d.fuelId,
    fuelPerTrip,
    fuelPerMin: fuelPerTrip * perMinFactor,
    cycleS,
    cycleSource: order.roundTripEstimateS !== null ? 'manual' : 'estimate',
    perMin: capacityPerTrip * perMinFactor,
  };
}

/** Direkte Leitung: Kapazität aller parallelen Leitungen. */
export function estimateDirectOrder(gd: GameDataIndex, order: TransportOrder): OrderDirectEstimate | null {
  const d = order.direct;
  if (!d || (order.mode !== 'belt' && order.mode !== 'pipe')) return null;
  const tier = gd.building(d.tier);
  const per = order.mode === 'belt' ? (tier?.conveyor?.itemsPerMin ?? 0) : (tier?.pipe?.m3PerMin ?? 0);
  const kindOk = (cargoKind(gd, order.itemId) === 'solid') === (order.mode === 'belt');
  return { tier: d.tier, lines: d.lines, kindOk, capacity: kindOk ? per * d.lines : 0 };
}

export function estimateOrder(
  p: Project,
  gd: GameDataIndex,
  order: TransportOrder,
  opts: { measuredCycleS?: Map<string, number> } = {},
): OrderEstimate {
  const kind = cargoKind(gd, order.itemId);
  if (order.mode === 'vehicle') {
    const vehicle = estimateVehicleOrder(gd, order);
    const perMin = vehicle?.perMin ?? 0;
    return { orderId: order.id, rate: order.ratePerMin, mode: order.mode, trains: [], vehicle, drone: null, direct: null, perMin, ok: perMin + 1e-6 >= order.ratePerMin };
  }
  if (order.mode === 'drone') {
    const drone = estimateDroneOrder(gd, order);
    const perMin = drone?.perMin ?? 0;
    return { orderId: order.id, rate: order.ratePerMin, mode: order.mode, trains: [], vehicle: null, drone, direct: null, perMin, ok: perMin + 1e-6 >= order.ratePerMin };
  }
  if (order.mode === 'belt' || order.mode === 'pipe') {
    const direct = estimateDirectOrder(gd, order);
    const perMin = Math.min(order.ratePerMin, direct?.capacity ?? 0);
    return { orderId: order.id, rate: order.ratePerMin, mode: order.mode, trains: [], vehicle: null, drone: null, direct, perMin, ok: (direct?.capacity ?? 0) + 1e-6 >= order.ratePerMin };
  }
  const trains: OrderTrainEstimate[] = [];
  for (const trainId of order.trainIds) {
    const t = p.trains[trainId];
    if (!t) continue;
    const tt = t.timetableId ? p.timetables[t.timetableId] : undefined;
    const stops = new Set(tt?.stops.map((s) => s.stationId) ?? []);
    // Halte, an denen der Gegenstand umgeschlagen wird (Umschlag „alles“ oder Gegenstand ausgewählt)
    const transfers = new Set(tt?.stops.filter((s) => stopTransfersItem(s, order.itemId)).map((s) => s.stationId) ?? []);
    const servesFrom = order.fromStationId ? transfers.has(order.fromStationId) : transfers.size > 0;
    const servesTo = order.toStationId ? transfers.has(order.toStationId) : transfers.size > 0;
    const excludedFrom = !servesFrom && !!order.fromStationId && stops.has(order.fromStationId);
    const excludedTo = !servesTo && !!order.toStationId && stops.has(order.toStationId);
    const sharing = Object.values(p.transportOrders).filter((o) => o.mode === 'train' && o.trainIds.includes(trainId) && cargoKind(gd, o.itemId) === kind);
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
    trains.push({ trainId, servesFrom, servesTo, excludedFrom, excludedTo, capacityPerCycle, share, cycleS: cycle.s, cycleSource: cycle.src, perMin });
  }
  const perMin = trains.reduce((s, x) => s + x.perMin, 0);
  return { orderId: order.id, rate: order.ratePerMin, mode: 'train', trains, vehicle: null, drone: null, direct: null, perMin, ok: perMin + 1e-6 >= order.ratePerMin };
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
  /** Brennstoffbedarf von Drohnen mit Heimathafen in dieser Fabrik. */
  transportFuel: number;
  /** Nicht gedeckter Brennstoffbedarf der Drohnen. */
  fuelGap: number;
}

/** Bilanz einer Fabrik mit Ein- und Ausfuhren (lokal vs. extern). */
export function factoryTrade(p: Project, gd: GameDataIndex, factoryId: string): TradeRow[] {
  const rows = new Map<string, TradeRow>();
  const row = (itemId: string) => {
    let r = rows.get(itemId);
    if (!r) {
      r = { itemId, produced: 0, consumed: 0, net: 0, imports: 0, exports: 0, planImports: 0, importGap: 0, exportGap: 0, transportFuel: 0, fuelGap: 0 };
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
    // Drohnen tanken am Heimathafen beim Absender
    const drone = o.fromFactoryId === factoryId ? estimateDroneOrder(gd, o) : null;
    if (drone && drone.fuelPerMin > 0) row(drone.fuelId).transportFuel += drone.fuelPerMin;
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
    r.fuelGap = Math.max(0, r.transportFuel - Math.max(0, r.net + r.imports - r.exports));
  }
  return [...rows.values()];
}

export function transportAssumptions(p: Project, gd: GameDataIndex): string[] {
  return [
    tr('Durchschnittsgeschwindigkeit {v} km/h (inkl. Anfahren und Bremsen).', { v: p.settings.simulation.trainAverageSpeedKmh }),
    tr('Umschlag {s} s je Halt plus Wartezeit laut Fahrplan (Wiki: 27,08 s).', { s: p.settings.simulation.dockingS }),
    tr('Wagen werden vollständig beladen: {slots} Stapel × Stapelgröße bzw. {m3} m³.', { slots: gd.fact('rail.freightCar.slots') ?? 32, m3: gd.fact('rail.freightCar.fluidM3') ?? 2400 }),
    tr('Keine Wartezeiten an Signalen; mehrere Aufträge teilen sich einen Zug im Verhältnis ihrer Mengen.'),
    tr('Fahrzeuge: Laderaum aus den Docs, Umlauf = 2 × Strecke / Geschwindigkeit + 2 × {s} s Andocken (Wiki „Truck Station“); ohne eigene Angabe mit Höchstgeschwindigkeit laut Wiki, also optimistisch. Treibstoffverbrauch wird nicht geschätzt.', { s: gd.fact('vehicle.docking.durationS') ?? 8 }),
    tr('Drohnen: {slots} Stapel je Flug, Umlauf = 2 × (Entfernung / Geschwindigkeit + 2 × {s} s Start bzw. Landung); Geschwindigkeit je Brennstoff laut Wiki (ungefähr). Brennstoff je Umlauf = ({e} MJ + {m} MJ/m × Entfernung) / Energiewert (Docs), Entfernung einfach gezählt (Annahme). Drohnen tanken am Hafen des Absenders.', {
      slots: gd.fact('drone.slots') ?? 9,
      s: gd.fact('drone.takeoffLandingS') ?? 51,
      e: gd.fact('drone.tripEnergyMJ') ?? 24000,
      m: gd.fact('drone.energyPerMeterMJ') ?? 6,
    }),
    tr('Direkte Bänder und Rohre: Kapazität = Stufe × Anzahl paralleler Leitungen; Förderhöhe zwischen Fabriken wird nicht geprüft.'),
  ];
}
