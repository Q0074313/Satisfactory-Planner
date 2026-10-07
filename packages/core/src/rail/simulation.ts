/**
 * Vereinfachte Zugsimulation eines Schienennetzes.
 *
 * Modell:
 * - Züge fahren mit konstanter Durchschnittsgeschwindigkeit (Annahme, inkl.
 *   Anfahren und Bremsen); Beschleunigung, Steigungen und Bremswege fehlen.
 * - Blocksignal: Einfahrt nur, wenn der folgende Block frei und nicht
 *   reserviert ist.
 * - Pfadsignal: Der Zug reserviert seinen Weg durch die folgenden Pfadblöcke
 *   bis zum nächsten gewöhnlichen Block. Einfahrt nur, wenn der Weg keine
 *   Reservierung oder Belegung anderer Züge berührt (gleiche Segmente oder
 *   Kreuzungen auf gleicher Höhe) und der Block dahinter frei ist
 *   („path in, block out“).
 * - Halte: Umschlagzeit (Wiki 27,08 s) plus Wartezeit des Fahrplans. Lade-
 *   bedingungen („vollständig beladen“) werden nicht simuliert.
 * - Wegwahl: kürzester Weg nach Länge mit 100 m Aufschlag je durchfahrenem
 *   Bahnhof in Fahrtrichtung, der nicht im Fahrplan steht; bei Gleichstand
 *   weniger Gleisteile, dann links vor Mitte vor rechts; keine Umleitung bei
 *   Belegung. Zweirichtungszüge fahren nur rückwärts ab, wenn vorwärts kein
 *   Weg existiert.
 * - Wegwahl: wie im Spiel (Wiki „Electric Locomotive – Pathfinding“), siehe
 *   `routeFromStates`.
 * - Start: Jeder Zug steht zu Beginn an seinem ersten Halt (oder dem nächsten
 *   freien Halt seines Fahrplans). Sind alle Halte belegt (mehr Züge als
 *   Bahnhöfe), beginnt er an einer zufälligen freien Stelle im Netz, von der
 *   aus er seinen ersten Halt erreicht. Der Zufall ist je Zug fest
 *   (reproduzierbare Läufe).
 *
 * Erkannte Ereignisse: Ankunft, Abfahrt, Warten am Signal, kein Weg,
 * Deadlock (zyklisches Warten) und Kollision (nur ohne Signale möglich).
 * Ein Durchlauf ohne Deadlock ist **kein Nachweis**, dass keiner auftreten kann.
 */
import type { GameDataIndex } from '../gamedata/index.ts';
import { tr } from '../i18n/index.ts';
import type { Project, RailSignal, Station, TimetableStop, Train } from '../model/schema.ts';
import type { Vec2 } from '../geometry/index.ts';
import { segmentPolyline, segmentShape } from './geometry.ts';
import { analyzeNetwork } from './checks.ts';
import { arrival, isBidirectional, nextStates, routeFromStates, type BlockAnalysis, type RailGraph, type RouteOptions, type TrackState } from './topology.ts';
import { CROSSING_HEIGHT_TOLERANCE_M } from './geometry.ts';

export interface SimSettings {
  speedKmh: number;
  dockingS: number;
  vehicleLengthM: number;
  passThroughPenaltyM: number;
}

export function simSettingsFrom(p: Project, gd: GameDataIndex): SimSettings {
  return {
    speedKmh: p.settings.simulation.trainAverageSpeedKmh,
    dockingS: p.settings.simulation.dockingS,
    vehicleLengthM: gd.fact('rail.freightCar.lengthM') ?? 16,
    passThroughPenaltyM: gd.fact('rail.station.passThroughPenaltyM') ?? 100,
  };
}

export function simAssumptions(s: SimSettings): string[] {
  return [
    tr('Konstante Durchschnittsgeschwindigkeit {v} km/h (inkl. Anfahren und Bremsen); keine Beschleunigung, Steigung oder Bremswege.', { v: s.speedKmh }),
    tr('Umschlag je Halt {s} s plus Wartezeit laut Fahrplan; Ladebedingungen („vollständig beladen/entladen“) werden nicht simuliert.', { s: s.dockingS }),
    tr('Wegwahl wie im Spiel: kürzester Weg mit {m} m Aufschlag je durchfahrenem Bahnhof in Fahrtrichtung (außer Halten des Fahrplans), bei Gleichstand weniger Gleisteile, dann links vor rechts; keine Umleitung bei Belegung.', { m: s.passThroughPenaltyM }),
    tr('Pfadsignale reservieren den Weg bis zum nächsten gewöhnlichen Block; dieser muss frei sein („path in, block out“).'),
    tr('Jeder Zug beginnt an seinem ersten freien Halt; sind alle belegt, an einer zufälligen freien Stelle (je Zug fest). Zuglänge {l} m je Fahrzeug.', { l: s.vehicleLengthM }),
    tr('Ein Durchlauf ohne Deadlock beweist nicht, dass keiner auftreten kann.'),
  ];
}

export type SimTrainStatus = 'docked' | 'driving' | 'waiting' | 'no-route' | 'no-timetable' | 'no-start';

export interface SimEvent {
  t: number;
  kind: 'arrive' | 'depart' | 'wait' | 'no-route' | 'deadlock' | 'collision' | 'no-start' | 'random-start';
  trainIds: string[];
  message: string;
  stationId?: string;
  signalId?: string;
}

interface Reservation {
  entered: boolean;
}

export interface SimTrain {
  id: string;
  name: string;
  color: string;
  lengthM: number;
  bidirectional: boolean;
  stops: TimetableStop[];
  /** Bahnhöfe des Fahrplans (Durchfahrt ohne Wegaufschlag). */
  scheduled: Set<string>;
  /** Index des aktuellen bzw. angefahrenen Halts. */
  stopIdx: number;
  status: SimTrainStatus;
  /** Zurückgelegte und geplante Fahrzustände; Kopf bei (pathIdx, offset). */
  path: TrackState[];
  pathIdx: number;
  offset: number;
  /** Index des Zielsegments im Pfad (Bahnhof des nächsten Halts). */
  goalIdx: number;
  dockRemaining: number;
  waitingSince: number | null;
  waitingSignal: string | null;
  /** Züge, auf die gewartet wird (für die Deadlock-Erkennung). */
  waitingFor: Set<string>;
  blocks: Map<string, Reservation>;
  segs: Map<string, Reservation>;
  /** Statistik */
  arrivals: { t: number; stopIdx: number }[];
  waitTotalS: number;
  distanceM: number;
}

interface SegGeom {
  pts: Vec2[];
  cum: number[];
  len: number;
}

export class TrainSimulation {
  readonly g: RailGraph;
  readonly blocks: BlockAnalysis;
  readonly settings: SimSettings;
  readonly trains: SimTrain[] = [];
  readonly events: SimEvent[] = [];
  time = 0;
  deadlock: string[] | null = null;
  private readonly p: Project;
  private readonly geom = new Map<string, SegGeom>();
  private readonly crossingPairs = new Set<string>();
  private readonly collided = new Set<string>();
  private readonly speed: number;

  constructor(p: Project, networkId: string, settings: SimSettings) {
    this.p = p;
    this.settings = settings;
    this.speed = (settings.speedKmh * 1000) / 3600;
    const a = analyzeNetwork(p, networkId);
    this.g = a.graph;
    this.blocks = a.blocks;
    for (const c of a.blocks.crossings) {
      if (Math.abs(c.zA - c.zB) >= CROSSING_HEIGHT_TOLERANCE_M) continue;
      this.crossingPairs.add(`${c.segA}|${c.segB}`);
      this.crossingPairs.add(`${c.segB}|${c.segA}`);
    }
    for (const [id, seg] of this.g.segments) {
      const shape = segmentShape(p, seg);
      if (!shape) continue;
      const pts = segmentPolyline(shape, 24).map((q) => ({ x: q.x, y: q.y }));
      const cum = [0];
      for (let i = 1; i < pts.length; i++) cum.push(cum[i - 1]! + Math.hypot(pts[i]!.x - pts[i - 1]!.x, pts[i]!.y - pts[i - 1]!.y));
      // Fahrlänge (inkl. Höhe) für die Bewegung, Grundrisslänge für die Darstellung
      this.geom.set(id, { pts, cum, len: this.g.lengths.get(id) ?? cum.at(-1)! });
    }
    for (const t of this.g.trains) this.addTrain(t);
  }

  private segLen(segId: string): number {
    return this.geom.get(segId)?.len ?? this.g.lengths.get(segId) ?? 0;
  }

  private addTrain(t: Train): void {
    const tt = t.timetableId ? this.p.timetables[t.timetableId] : undefined;
    const st: SimTrain = {
      id: t.id,
      name: t.name,
      color: t.color,
      lengthM: t.consist.length * this.settings.vehicleLengthM,
      bidirectional: isBidirectional(t),
      stops: tt?.stops.filter((s) => this.p.stations[s.stationId]?.networkId === t.networkId) ?? [],
      scheduled: new Set(tt?.stops.map((s) => s.stationId) ?? []),
      stopIdx: 0,
      status: 'no-timetable',
      path: [],
      pathIdx: 0,
      offset: 0,
      goalIdx: 0,
      dockRemaining: 0,
      waitingSince: null,
      waitingSignal: null,
      waitingFor: new Set(),
      blocks: new Map(),
      segs: new Map(),
      arrivals: [],
      waitTotalS: 0,
      distanceM: 0,
    };
    this.trains.push(st);
    if (st.stops.length === 0) return;
    // Erster freier Halt
    for (let i = 0; i < st.stops.length; i++) {
      const station = this.p.stations[st.stops[i]!.stationId]!;
      const occupied = this.trains.some((o) => o !== st && o.path[o.pathIdx]?.segId === station.segmentId);
      if (occupied) continue;
      st.stopIdx = i;
      st.path = [{ segId: station.segmentId, dir: 'ab' }];
      st.pathIdx = 0;
      st.offset = this.segLen(station.segmentId);
      st.goalIdx = 0;
      st.status = 'docked';
      st.dockRemaining = this.settings.dockingS + st.stops[i]!.waitS;
      st.blocks.set(this.blockOf(station.segmentId), { entered: true });
      return;
    }
    if (this.placeRandomly(st)) return;
    st.status = 'no-start';
    this.events.push({ t: 0, kind: 'no-start', trainIds: [st.id], message: tr('{train}: alle Halte des Fahrplans sind beim Start belegt und es gibt keine freie Stelle im Netz.', { train: st.name }) });
  }

  private routeOptions(t: SimTrain): RouteOptions {
    return { passThroughPenaltyM: this.settings.passThroughPenaltyM, scheduledStationIds: t.scheduled };
  }

  /** Blöcke, die andere Züge belegen oder reserviert haben. */
  private takenBlocks(self: SimTrain): Set<string> {
    const out = new Set<string>();
    for (const o of this.trains) {
      if (o === self || !o.path.length) continue;
      for (const b of o.blocks.keys()) out.add(b);
      for (const b of this.bodyBlocks(o)) out.add(b);
    }
    return out;
  }

  /**
   * Startplatz für einen Zug, der an keinem Halt Platz findet: zufällige
   * Stelle auf freiem Gleis (kein Bahnhof, Blöcke frei), Zug passt dahinter
   * auf das Gleis und erreicht von dort seinen ersten Halt.
   */
  private placeRandomly(st: SimTrain): boolean {
    const goal = this.p.stations[st.stops[0]!.stationId];
    if (!goal) return false;
    const stationSegs = new Set(this.g.stations.map((s) => s.segmentId));
    const taken = this.takenBlocks(st);
    const occupied = new Set<string>();
    for (const o of this.trains) if (o !== st) for (const s of this.bodySegIds(o)) occupied.add(s);
    // Bevorzugt freie Blöcke; ohne Signale ist das ganze Netz ein Block, dann genügt freies Gleis
    const strict = (segId: string) => !stationSegs.has(segId) && !taken.has(this.blockOf(segId));
    const loose = (segId: string) => !stationSegs.has(segId) && !occupied.has(segId);
    const rnd = seededRandom(hashString(`${st.id}|${this.g.network.id}`));
    for (const usable of [strict, loose]) {
      const placed = this.tryPlace(st, goal, usable, rnd);
      if (placed) return placed;
    }
    return false;
  }

  private tryPlace(st: SimTrain, goal: Station, usable: (segId: string) => boolean, rnd: () => number): boolean {
    const candidates: TrackState[] = [];
    for (const segId of [...this.g.segments.keys()].sort()) {
      if (!usable(segId)) continue;
      candidates.push({ segId, dir: 'ab' }, { segId, dir: 'ba' });
    }
    for (let i = candidates.length - 1; i > 0; i--) {
      const j = Math.floor(rnd() * (i + 1));
      [candidates[i], candidates[j]] = [candidates[j]!, candidates[i]!];
    }
    for (const head of candidates) {
      const body = this.bodyBehind(head, st.lengthM, usable);
      if (!body) continue;
      if (!routeFromStates(this.g, [head], goal, this.routeOptions(st))) continue;
      st.path = body;
      st.pathIdx = body.length - 1;
      st.offset = this.segLen(head.segId);
      for (const b of this.bodyBlocks(st)) st.blocks.set(b, { entered: true });
      st.stopIdx = st.stops.length - 1;
      st.status = 'driving';
      this.events.push({ t: 0, kind: 'random-start', trainIds: [st.id], message: tr('{train}: alle Halte belegt – Start an einer zufälligen freien Stelle.', { train: st.name }) });
      this.planNextLeg(st);
      return st.status === 'driving';
    }
    return false;
  }

  /** Fahrzustände unter einem Zug, dessen Kopf am Ende von `head` steht (vom Ende zum Kopf). */
  private bodyBehind(head: TrackState, lengthM: number, usable: (segId: string) => boolean): TrackState[] | null {
    const out: TrackState[] = [head];
    const flip = (s: TrackState): TrackState => ({ segId: s.segId, dir: s.dir === 'ab' ? 'ba' : 'ab' });
    let covered = this.segLen(head.segId);
    let cur = head;
    while (covered < lengthM) {
      // Vorgänger: Zustände, von denen aus der Zug regulär (Signale beachtet) nach `cur` fährt
      const prev = nextStates(this.g, flip(cur), { ignoreSignals: true })
        .map(flip)
        .find((q) => usable(q.segId) && !out.some((o) => o.segId === q.segId) && nextStates(this.g, q).some((x) => x.segId === cur.segId && x.dir === cur.dir));
      if (!prev) return null;
      out.unshift(prev);
      covered += this.segLen(prev.segId);
      cur = prev;
    }
    return out;
  }

  private blockOf(segId: string): string {
    return this.blocks.blockOf.get(segId) ?? segId;
  }

  /** Segmente unter dem Zug (vom Kopf rückwärts), je mit Abschnitt in Fahrtrichtung. */
  bodySegments(t: SimTrain): { idx: number; from: number; to: number }[] {
    const out: { idx: number; from: number; to: number }[] = [];
    if (!t.path.length) return out;
    let remaining = t.lengthM;
    let idx = t.pathIdx;
    let headOff = t.offset;
    while (idx >= 0 && remaining > 1e-9) {
      const from = Math.max(0, headOff - remaining);
      out.push({ idx, from, to: headOff });
      remaining -= headOff - from;
      idx--;
      if (idx >= 0) headOff = this.segLen(t.path[idx]!.segId);
    }
    return out;
  }

  private bodySegIds(t: SimTrain): Set<string> {
    return new Set(this.bodySegments(t).map((b) => t.path[b.idx]!.segId));
  }

  private bodyBlocks(t: SimTrain): Set<string> {
    return new Set([...this.bodySegIds(t)].map((s) => this.blockOf(s)));
  }

  /** Signal am Knoten, das für diese Fahrt gilt. */
  private signalAt(state: TrackState): RailSignal | null {
    const arr = arrival(this.g, state);
    if (!arr) return null;
    const moving = arr.side === 'A' ? 'forward' : 'backward';
    return this.g.signals.get(arr.nodeId)?.find((s) => s.facing === moving) ?? null;
  }

  private blockHolders(blockId: string, self: SimTrain): Set<string> {
    const out = new Set<string>();
    for (const o of this.trains) {
      if (o === self || !o.path.length) continue;
      if (o.blocks.has(blockId) || this.bodyBlocks(o).has(blockId)) out.add(o.id);
    }
    return out;
  }

  /** Versucht die Einfahrt über ein Signal; liefert die blockierenden Züge (leer = frei). */
  private requestEntry(t: SimTrain, sig: RailSignal, nextIdx: number): Set<string> {
    const next = t.path[nextIdx];
    if (!next) return new Set();
    if (sig.kind === 'block') {
      const b = this.blockOf(next.segId);
      const holders = this.blockHolders(b, t);
      if (holders.size === 0) t.blocks.set(b, { entered: false });
      return holders;
    }
    // Pfadsignal: Weg durch die Pfadblöcke + Block dahinter
    const segs: string[] = [];
    let exitBlock: string | null = null;
    for (let i = nextIdx; i < t.path.length; i++) {
      const sid = t.path[i]!.segId;
      const b = this.blocks.blocks.get(this.blockOf(sid));
      if (b?.isPath) segs.push(sid);
      else {
        exitBlock = this.blockOf(sid);
        break;
      }
      if (i === t.goalIdx) break;
    }
    const holders = new Set<string>();
    for (const o of this.trains) {
      if (o === t || !o.path.length) continue;
      const theirs = new Set([...o.segs.keys(), ...this.bodySegIds(o)]);
      for (const s of segs) {
        if (theirs.has(s) || [...theirs].some((x) => this.crossingPairs.has(`${s}|${x}`))) {
          holders.add(o.id);
          break;
        }
      }
    }
    if (exitBlock) for (const h of this.blockHolders(exitBlock, t)) holders.add(h);
    if (holders.size === 0) {
      for (const s of segs) t.segs.set(s, { entered: false });
      if (exitBlock) t.blocks.set(exitBlock, { entered: false });
    }
    return holders;
  }

  private releaseReservations(t: SimTrain): void {
    const bodySegs = this.bodySegIds(t);
    const bodyBlocks = new Set([...bodySegs].map((s) => this.blockOf(s)));
    for (const [b, r] of t.blocks) {
      if (bodyBlocks.has(b)) r.entered = true;
      else if (r.entered) t.blocks.delete(b);
    }
    for (const [s, r] of t.segs) {
      if (bodySegs.has(s)) r.entered = true;
      else if (r.entered) t.segs.delete(s);
    }
  }

  private planNextLeg(t: SimTrain): void {
    const nextStop = (t.stopIdx + 1) % t.stops.length;
    const goal = this.p.stations[t.stops[nextStop]!.stationId];
    if (!goal) return;
    const head = t.path[t.pathIdx]!;
    let route = routeFromStates(this.g, [head], goal, this.routeOptions(t));
    let reversed = false;
    if (!route && t.bidirectional) {
      // Rückwärts: Kopf wechselt an das Zugende
      const body = this.bodySegments(t);
      const tail = body.at(-1)!;
      const flipped: TrackState[] = body.map((b) => ({ segId: t.path[b.idx]!.segId, dir: t.path[b.idx]!.dir === 'ab' ? 'ba' : 'ab' }) as TrackState);
      const newHead = flipped.at(-1)!;
      route = routeFromStates(this.g, [newHead], goal, this.routeOptions(t));
      if (route) {
        reversed = true;
        t.path = flipped;
        t.pathIdx = flipped.length - 1;
        t.offset = this.segLen(newHead.segId) - tail.from;
      }
    }
    if (!route) {
      t.status = 'no-route';
      this.events.push({
        t: this.time,
        kind: 'no-route',
        trainIds: [t.id],
        stationId: goal.id,
        message: tr('{train}: kein Weg zu „{station}“.', { train: t.name, station: goal.name }),
      });
      return;
    }
    // Pfad kürzen: nur die Segmente unter dem Zug behalten
    const keepFrom = Math.max(0, t.pathIdx - this.bodySegments(t).length + 1);
    t.path = [...t.path.slice(keepFrom, t.pathIdx + 1), ...route.states];
    t.pathIdx -= keepFrom;
    t.goalIdx = t.path.length - 1;
    t.stopIdx = nextStop;
    t.status = 'driving';
    this.events.push({
      t: this.time,
      kind: 'depart',
      trainIds: [t.id],
      stationId: goal.id,
      message: reversed ? tr('{train} fährt rückwärts ab nach „{station}“.', { train: t.name, station: goal.name }) : tr('{train} fährt ab nach „{station}“.', { train: t.name, station: goal.name }),
    });
  }

  private move(t: SimTrain, dt: number): void {
    let advance = this.speed * dt;
    while (advance > 1e-9) {
      const cur = t.path[t.pathIdx]!;
      const len = this.segLen(cur.segId);
      const remain = len - t.offset;
      if (advance < remain) {
        t.offset += advance;
        t.distanceM += advance;
        advance = 0;
        break;
      }
      t.offset = len;
      t.distanceM += remain;
      advance -= remain;
      if (t.pathIdx >= t.goalIdx) {
        this.arrive(t);
        return;
      }
      const sig = this.signalAt(cur);
      if (sig) {
        const holders = this.requestEntry(t, sig, t.pathIdx + 1);
        if (holders.size) {
          if (t.status !== 'waiting') {
            t.status = 'waiting';
            t.waitingSince = this.time;
            t.waitingSignal = sig.id;
            this.events.push({ t: this.time, kind: 'wait', trainIds: [t.id, ...holders], signalId: sig.id, message: tr('{train} wartet an einem {kind}.', { train: t.name, kind: sig.kind === 'path' ? tr('Pfadsignal') : tr('Blocksignal') }) });
          }
          t.waitingFor = holders;
          return;
        }
      }
      if (t.status === 'waiting') {
        t.waitTotalS += this.time - (t.waitingSince ?? this.time);
        t.status = 'driving';
        t.waitingSince = null;
        t.waitingSignal = null;
        t.waitingFor = new Set();
      }
      t.pathIdx++;
      t.offset = 0;
    }
  }

  private arrive(t: SimTrain): void {
    const stop = t.stops[t.stopIdx]!;
    const station = this.p.stations[stop.stationId] as Station;
    t.status = 'docked';
    t.dockRemaining = this.settings.dockingS + stop.waitS;
    t.arrivals.push({ t: this.time, stopIdx: t.stopIdx });
    this.events.push({ t: this.time, kind: 'arrive', trainIds: [t.id], stationId: station.id, message: tr('{train} hält in „{station}“.', { train: t.name, station: station.name }) });
  }

  step(dt: number): void {
    for (const t of this.trains) {
      if (t.status === 'docked') {
        t.dockRemaining -= dt;
        if (t.dockRemaining <= 0) this.planNextLeg(t);
      }
    }
    for (const t of this.trains) {
      if (t.status === 'driving' || t.status === 'waiting') this.move(t, dt);
      if (t.path.length) this.releaseReservations(t);
    }
    this.time += dt;
    this.detectCollisions();
    this.detectDeadlock();
  }

  run(durationS: number, dt = 0.5): void {
    const end = this.time + durationS;
    while (this.time < end - 1e-9) this.step(Math.min(dt, end - this.time));
  }

  private detectCollisions(): void {
    const active = this.trains.filter((t) => t.path.length);
    for (let i = 0; i < active.length; i++)
      for (let j = i + 1; j < active.length; j++) {
        const a = active[i]!;
        const b = active[j]!;
        const sa = this.bodySegIds(a);
        const sb = this.bodySegIds(b);
        const hit = [...sa].some((s) => sb.has(s) || [...sb].some((x) => this.crossingPairs.has(`${s}|${x}`)));
        const key = `${a.id}|${b.id}`;
        if (hit && !this.collided.has(key)) {
          this.collided.add(key);
          this.events.push({ t: this.time, kind: 'collision', trainIds: [a.id, b.id], message: tr('{a} und {b} belegen gleichzeitig dasselbe Gleis (Kollision im Spiel möglich).', { a: a.name, b: b.name }) });
        } else if (!hit) this.collided.delete(key);
      }
  }

  private detectDeadlock(): void {
    if (this.deadlock) return;
    const waiting = new Map(this.trains.filter((t) => t.status === 'waiting').map((t) => [t.id, t]));
    for (const start of waiting.values()) {
      const stack = [start.id];
      const seen = new Set<string>();
      const dfs = (id: string): string[] | null => {
        const t = waiting.get(id);
        if (!t) return null;
        for (const w of t.waitingFor) {
          if (w === start.id) return [...stack];
          if (seen.has(w) || !waiting.has(w)) continue;
          seen.add(w);
          stack.push(w);
          const r = dfs(w);
          if (r) return r;
          stack.pop();
        }
        return null;
      };
      const cycle = dfs(start.id);
      if (cycle) {
        this.deadlock = cycle;
        const names = cycle.map((id) => this.trains.find((t) => t.id === id)?.name ?? id);
        this.events.push({ t: this.time, kind: 'deadlock', trainIds: cycle, message: tr('Deadlock: {trains} warten gegenseitig aufeinander.', { trains: names.join(', ') }) });
        return;
      }
    }
  }

  /** Grundrisspunkt bei Abstand `offset` (in Fahrtrichtung) auf einem Fahrzustand. */
  pointAt(state: TrackState, offset: number): Vec2 | null {
    const geo = this.geom.get(state.segId);
    if (!geo) return null;
    const total = geo.cum.at(-1)!;
    const scale = geo.len > 0 ? total / geo.len : 1;
    let d = Math.min(Math.max(offset * scale, 0), total);
    if (state.dir === 'ba') d = total - d;
    let i = 1;
    while (i < geo.cum.length - 1 && geo.cum[i]! < d) i++;
    const a = geo.pts[i - 1]!;
    const b = geo.pts[i]!;
    const seg = geo.cum[i]! - geo.cum[i - 1]!;
    const w = seg > 0 ? (d - geo.cum[i - 1]!) / seg : 0;
    return { x: a.x + (b.x - a.x) * w, y: a.y + (b.y - a.y) * w };
  }

  /** Umriss des Zuges als Polylinie vom Kopf zum Ende. */
  trainPolyline(t: SimTrain): Vec2[] {
    const out: Vec2[] = [];
    for (const b of this.bodySegments(t)) {
      const st = t.path[b.idx]!;
      const geo = this.geom.get(st.segId);
      if (!geo) continue;
      const n = 8;
      for (let k = 0; k <= n; k++) {
        const pt = this.pointAt(st, b.to - ((b.to - b.from) * k) / n);
        if (pt) out.push(pt);
      }
    }
    return out;
  }

  /** Kennzahlen je Zug: Umläufe, mittlere Umlaufzeit, Wartezeit. */
  summary(): { trainId: string; name: string; status: SimTrainStatus; arrivals: number; cycleS: number | null; waitShare: number; distanceKm: number }[] {
    return this.trains.map((t) => {
      const first = t.arrivals.filter((a) => a.stopIdx === 0).map((a) => a.t);
      const cycles = first.slice(1).map((v, i) => v - first[i]!);
      const wait = t.waitTotalS + (t.status === 'waiting' && t.waitingSince !== null ? this.time - t.waitingSince : 0);
      return {
        trainId: t.id,
        name: t.name,
        status: t.status,
        arrivals: t.arrivals.length,
        cycleS: cycles.length ? cycles.reduce((s, x) => s + x, 0) / cycles.length : null,
        waitShare: this.time > 0 ? wait / this.time : 0,
        distanceKm: t.distanceM / 1000,
      };
    });
  }
}

/** Einfacher Hash für reproduzierbare Zufallszahlen. */
function hashString(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619);
  return h >>> 0;
}

/** Pseudozufall (Mulberry32) mit festem Startwert. */
function seededRandom(seed: number): () => number {
  let a = seed;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
