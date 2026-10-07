/**
 * Zugkraft und Zuglänge: Wie viele Wagen eine Lok bei der Steigung des
 * Fahrwegs ziehen kann und wie lang der Zug höchstens sein darf.
 *
 * Quellen (Wiki): Lok 300 t, Wagen leer 30 t, voll 100 t; höchste Zugmasse
 * je Lok auf 1-, 2- und 4-m-Rampen (12,5 / 25 / 50 % Steigung): 1644 / 800 /
 * 580 t. Annahme: Mit mehreren Loks wächst die zulässige Masse linear (laut
 * Wiki helfen Loks an jeder Stelle des Zuges mit).
 */
import type { GameDataIndex } from '../gamedata/index.ts';
import type { Project, Train } from '../model/schema.ts';
import { buildGraph, isBidirectional, shortestRoute, trainLengthM, type RailGraph } from './topology.ts';

/** Steigungsklassen der Wiki-Tabelle (Höhe je 8 m Fundament). */
export const RAMP_CLASSES = [
  { key: 'ramp1m', grade: 1 / 8 },
  { key: 'ramp2m', grade: 2 / 8 },
  { key: 'ramp4m', grade: 4 / 8 },
] as const;

/** Unterhalb dieser Steigung gilt eine Strecke als eben (keine Tabellenwerte). */
export const FLAT_GRADE = 0.005;

export interface TrainTraction {
  locomotives: number;
  wagons: number;
  massEmptyT: number;
  massFullT: number;
  /** Größte Steigung bergauf in Fahrtrichtung (0,125 = 12,5 %). */
  maxGrade: number;
  /** Steigung aus den Fahrwegen des Fahrplans (sonst: ganzes Netz). */
  gradeFrom: 'route' | 'network';
  /** Tabellenklasse für die Steigung; null = eben. */
  rampClass: (typeof RAMP_CLASSES)[number]['key'] | null;
  /** Höchste Zugmasse je Lok für diese Steigung (inkl. Lok). */
  maxMassPerLocoT: number | null;
  /** Voll beladene Wagen, die eine Lok bei dieser Steigung zieht. */
  wagonsPerLoco: number | null;
  /** Loks, die der voll beladene Zug bei dieser Steigung braucht. */
  locosNeeded: number | null;
  /** Zug schafft die Steigung voll beladen. */
  ok: boolean;
  lengthM: number;
  /** Kürzester Bahnhof des Fahrplans: Fahrzeuge, die dort Platz haben (Gebäude + Bahnsteige). */
  maxVehicles: number | null;
  shortestStationId: string | null;
}

/** Größte Steigung bergauf über die Fahrwege eines Zuges bzw. das ganze Netz. */
export function maxUphillGrade(p: Project, g: RailGraph, t: Train): { grade: number; from: 'route' | 'network' } {
  const gradeOf = (segId: string, dir: 'ab' | 'ba'): number => {
    const seg = g.segments.get(segId);
    const len = g.lengths.get(segId) ?? 0;
    const za = seg ? (p.railNodes[seg.a.nodeId]?.position.z ?? 0) : 0;
    const zb = seg ? (p.railNodes[seg.b.nodeId]?.position.z ?? 0) : 0;
    const dz = dir === 'ab' ? zb - za : za - zb;
    const horiz = Math.sqrt(Math.max(len * len - dz * dz, 1e-9));
    return dz / horiz;
  };
  const tt = t.timetableId ? p.timetables[t.timetableId] : undefined;
  if (tt && tt.stops.length >= 2) {
    const scheduled = new Set(tt.stops.map((s) => s.stationId));
    let grade = 0;
    let any = false;
    tt.stops.forEach((s, i) => {
      const next = tt.stops[(i + 1) % tt.stops.length]!;
      if (s.stationId === next.stationId) return;
      const r = shortestRoute(p, g, { fromStationId: s.stationId, toStationId: next.stationId, bidirectional: isBidirectional(t), scheduledStationIds: scheduled });
      if (!r) return;
      any = true;
      for (const st of r.states) grade = Math.max(grade, gradeOf(st.segId, st.dir));
    });
    if (any) return { grade, from: 'route' };
  }
  let grade = 0;
  for (const id of g.segments.keys()) grade = Math.max(grade, gradeOf(id, 'ab'), gradeOf(id, 'ba'));
  return { grade, from: 'network' };
}

export function trainTraction(p: Project, gd: GameDataIndex, trainId: string, graph?: RailGraph): TrainTraction | null {
  const t = p.trains[trainId];
  if (!t) return null;
  const g = graph ?? buildGraph(p, t.networkId);
  const locoT = gd.fact('rail.locomotive.massT') ?? 300;
  const emptyT = gd.fact('rail.freightCar.emptyMassT') ?? 30;
  const fullT = gd.fact('rail.freightCar.fullMassT') ?? 100;
  const vehicleLen = gd.fact('rail.freightCar.lengthM') ?? 16;
  const locomotives = t.consist.filter((v) => v.kind === 'locomotive').length;
  const wagons = t.consist.length - locomotives;
  const { grade, from } = maxUphillGrade(p, g, t);
  const cls = grade < FLAT_GRADE ? null : (RAMP_CLASSES.find((c) => grade <= c.grade + 1e-9) ?? RAMP_CLASSES.at(-1)!);
  const maxMass = cls ? (gd.fact(`rail.locomotive.maxTrainMassT.${cls.key}`) ?? null) : null;
  const pull = maxMass !== null ? maxMass - locoT : null;
  const massFullT = locomotives * locoT + wagons * fullT;
  const locosNeeded = pull !== null && pull > 0 ? Math.max(1, Math.ceil((wagons * fullT) / pull)) : null;
  // Kürzester Bahnhof des Fahrplans
  let maxVehicles: number | null = null;
  let shortestStationId: string | null = null;
  const tt = t.timetableId ? p.timetables[t.timetableId] : undefined;
  for (const stop of tt?.stops ?? []) {
    const st = p.stations[stop.stationId];
    if (!st) continue;
    const n = 1 + st.platforms.length;
    if (maxVehicles === null || n < maxVehicles) {
      maxVehicles = n;
      shortestStationId = st.id;
    }
  }
  return {
    locomotives,
    wagons,
    massEmptyT: locomotives * locoT + wagons * emptyT,
    massFullT,
    maxGrade: grade,
    gradeFrom: from,
    rampClass: cls?.key ?? null,
    maxMassPerLocoT: maxMass,
    wagonsPerLoco: pull !== null ? Math.floor(pull / fullT) : null,
    locosNeeded,
    ok: maxMass === null || locomotives === 0 || massFullT <= locomotives * maxMass + 1e-9,
    lengthM: trainLengthM(t, vehicleLen),
    maxVehicles,
    shortestStationId,
  };
}
