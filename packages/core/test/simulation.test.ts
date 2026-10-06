import { describe, expect, it } from 'vitest';
import * as rail from '../src/project/ops/rail.ts';
import { TrainSimulation, simSettingsFrom } from '../src/rail/simulation.ts';
import { buildGraph, shortestRoute } from '../src/rail/topology.ts';
import type { Project } from '../src/model/schema.ts';
import { gameData, newProject } from './helpers.ts';

const gd = gameData();
const pt = (x: number, y: number, z = 0) => ({ kind: 'point' as const, position: { x, y, z } });
const node = (nodeId: string) => ({ kind: 'node' as const, nodeId });

/** Rundkurs im Uhrzeigersinn mit zwei Bahnhöfen (wie in rail.test.ts), Bogenradius 60 m. */
function loop() {
  const p = newProject();
  const net = rail.addNetwork(p, 'Netz');
  const pf = [{ type: 'freight' as const, mode: 'load' as const, flipped: false }];
  const s1 = rail.addStation(p, { networkId: net, name: 'S1', position: { x: 0, y: 0, z: 0 }, headingDeg: 0, platforms: pf });
  const S1 = p.stations[s1]!;
  const x = rail.addTrack(p, net, node(S1.frontNodeId), pt(92, 60));
  const y = rail.addTrack(p, net, node(x.toNodeId), pt(32, 120)).toNodeId;
  const s2 = rail.addStation(p, { networkId: net, name: 'S2', position: { x: 0, y: 0, z: 0 }, headingDeg: 0, backNodeId: y, platforms: pf });
  const S2 = p.stations[s2]!;
  const w = rail.addTrack(p, net, node(S2.frontNodeId), pt(-60, 60));
  const back = rail.addTrack(p, net, node(w.toNodeId), node(S1.backNodeId));
  return { p, net, s1, s2, x: x.toNodeId, w: w.toNodeId, xSeg: x.segmentId, wSeg: w.segmentId, backSeg: back.segmentId };
}

/** Signal an `nodeId` für Züge, die über `segId` ankommen. */
function signalAfter(p: Project, segId: string, nodeId: string, kind: 'block' | 'path' = 'block') {
  const seg = p.railSegments[segId]!;
  const end = seg.a.nodeId === nodeId ? seg.a : seg.b;
  return rail.addSignal(p, nodeId, kind, end.side === 'A' ? 'forward' : 'backward');
}

function train(p: Project, net: string, stops: string[], name: string) {
  const tt = rail.addTimetable(p, net, `FP ${name}`, stops);
  const t = rail.addTrain(p, net, name, [
    { kind: 'locomotive', reversed: false },
    { kind: 'wagon', cargo: 'solid' },
  ]);
  rail.updateTrain(p, t, { timetableId: tt });
  return t;
}

describe('Zugsimulation', () => {
  it('ein Zug pendelt zwischen zwei Bahnhöfen; Umlaufzeit = Fahrzeit + 2 × Umschlag', () => {
    const { p, net, s1, s2 } = loop();
    train(p, net, [s1, s2], 'Z1');
    const settings = simSettingsFrom(p, gd);
    const sim = new TrainSimulation(p, net, settings);
    sim.run(1200, 0.25);
    const g = buildGraph(p, net);
    const there = shortestRoute(p, g, { fromStationId: s1, toStationId: s2, bidirectional: false })!;
    const back = shortestRoute(p, g, { fromStationId: s2, toStationId: s1, bidirectional: false })!;
    const speed = (settings.speedKmh * 1000) / 3600;
    const expected = (there.lengthM + back.lengthM) / speed + 2 * settings.dockingS;
    const sum = sim.summary()[0]!;
    expect(sum.arrivals).toBeGreaterThanOrEqual(4);
    expect(sum.cycleS!).toBeCloseTo(expected, -0.5);
    expect(sim.events.some((e) => e.kind === 'collision' || e.kind === 'deadlock')).toBe(false);
  });

  it('zwei Züge ohne Signale: Kollision wird gemeldet', () => {
    const { p, net, s1, s2 } = loop();
    train(p, net, [s1, s2], 'Z1');
    const z2 = train(p, net, [s2, s1], 'Z2');
    // Z2 wartet lange in S1, Z1 fährt auf (gleiche Geschwindigkeit, sonst würden sie sich nie einholen)
    const tt = p.timetables[p.trains[z2]!.timetableId!]!;
    rail.updateTimetable(p, tt.id, { stops: tt.stops.map((st) => ({ ...st, waitS: st.stationId === s1 ? 300 : 0 })) });
    const sim = new TrainSimulation(p, net, simSettingsFrom(p, gd));
    sim.run(600, 0.25);
    expect(sim.events.some((e) => e.kind === 'collision')).toBe(true);
  });

  it('zwei Züge in einem Rundkurs mit nur zwei Blöcken: Deadlock wird erkannt', () => {
    const { p, net, s1, s2, xSeg, wSeg } = loop();
    const S1 = p.stations[s1]!;
    const S2 = p.stations[s2]!;
    signalAfter(p, S1.segmentId, S1.frontNodeId);
    signalAfter(p, S2.segmentId, S2.frontNodeId);
    void xSeg;
    void wSeg;
    train(p, net, [s1, s2], 'Z1');
    train(p, net, [s2, s1], 'Z2');
    const sim = new TrainSimulation(p, net, simSettingsFrom(p, gd));
    sim.run(600, 0.25);
    expect(sim.deadlock).not.toBeNull();
    expect(sim.events.find((e) => e.kind === 'deadlock')!.trainIds).toHaveLength(2);
    expect(sim.events.some((e) => e.kind === 'collision')).toBe(false);
  });

  it('vier Blöcke: beide Züge fahren ohne Deadlock und ohne Kollision', () => {
    const { p, net, s1, s2, x, w, xSeg, wSeg } = loop();
    const S1 = p.stations[s1]!;
    const S2 = p.stations[s2]!;
    signalAfter(p, S1.segmentId, S1.frontNodeId);
    signalAfter(p, S2.segmentId, S2.frontNodeId);
    signalAfter(p, xSeg, x);
    signalAfter(p, wSeg, w);
    train(p, net, [s1, s2], 'Z1');
    train(p, net, [s2, s1], 'Z2');
    const sim = new TrainSimulation(p, net, simSettingsFrom(p, gd));
    sim.run(1800, 0.25);
    expect(sim.deadlock).toBeNull();
    expect(sim.events.some((e) => e.kind === 'collision')).toBe(false);
    for (const s of sim.summary()) expect(s.arrivals).toBeGreaterThanOrEqual(3);
    // Zug liegt immer auf dem Gleis: Umriss vorhanden
    expect(sim.trainPolyline(sim.trains[0]!).length).toBeGreaterThan(2);
  });

  it('nicht erreichbares Ziel: Zug bleibt mit Ereignis „kein Weg“ stehen', () => {
    const { p, net, s1, s2, x } = loop();
    // Einzelnes Signal gegen die Fahrtrichtung sperrt den Weg
    const seg = Object.values(p.railSegments).find((s) => s.a.nodeId === x || s.b.nodeId === x)!;
    const end = seg.a.nodeId === x ? seg.a : seg.b;
    rail.addSignal(p, x, 'block', end.side === 'A' ? 'backward' : 'forward');
    train(p, net, [s1, s2], 'Z1');
    const sim = new TrainSimulation(p, net, simSettingsFrom(p, gd));
    sim.run(120, 0.5);
    expect(sim.trains[0]!.status).toBe('no-route');
    expect(sim.events.some((e) => e.kind === 'no-route')).toBe(true);
  });
});

describe('Signal auf freiem Gleis', () => {
  it('teilt das Segment und setzt das Signal an den neuen Knoten', () => {
    const p = newProject();
    const net = rail.addNetwork(p, 'N');
    const t = rail.addTrack(p, net, pt(0, 0), pt(80, 0));
    const { signalId, nodeId } = rail.addSignalOnSegment(p, t.segmentId, 0.5, 'path', 'forward');
    expect(p.railNodes[nodeId]!.position.x).toBeCloseTo(40);
    expect(p.railSignals[signalId]).toMatchObject({ nodeId, kind: 'path', facing: 'forward' });
    expect(Object.keys(p.railSegments)).toHaveLength(2);
  });
});
