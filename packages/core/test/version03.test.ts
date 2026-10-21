/**
 * Neuerungen Version 0.3: Gleisbau ohne spitze Rückläufe, Signale in
 * Meterschritten, Wegwahl wie im Spiel, zufälliger Startplatz, Zugkraft,
 * Umschlag nur bestimmter Gegenstände, Förderhöhe, Anschlüsse.
 */
import { describe, expect, it } from 'vitest';
import * as rail from '../src/project/ops/rail.ts';
import * as fac from '../src/project/ops/factory.ts';
import * as tops from '../src/project/ops/transport.ts';
import { lengthAtT, segmentPolyline, segmentShape, tAtLength } from '../src/rail/geometry.ts';
import { buildGraph, shortestRoute } from '../src/rail/topology.ts';
import { TrainSimulation, simSettingsFrom } from '../src/rail/simulation.ts';
import { trainTraction } from '../src/rail/traction.ts';
import { checkNetwork } from '../src/rail/checks.ts';
import { checkTransport } from '../src/transport/checks.ts';
import { estimateOrder } from '../src/transport/estimate.ts';
import { checkHeights } from '../src/factory/checks.ts';
import { pipeHeads } from '../src/factory/headLift.ts';
import { placedPortDefs, portDefs, worldPorts } from '../src/factory/ports.ts';
import { buildingFootprint } from '../src/factory/geometry.ts';
import { linkPath } from '../src/factory/linkPath.ts';
import type { Project } from '../src/model/schema.ts';
import { firstFactory, gameData, newProject } from './helpers.ts';

const gd = gameData();
const pt = (x: number, y: number, z = 0) => ({ kind: 'point' as const, position: { x, y, z } });
const node = (nodeId: string) => ({ kind: 'node' as const, nodeId });
const PF = [{ type: 'freight' as const, mode: 'load' as const, flipped: false }];

describe('Gleisbau', () => {
  it('vom Gleisende aus geht es auf der freien Seite weiter, auch für eine Kehre', () => {
    const p = newProject();
    const net = rail.addNetwork(p, 'N');
    const a = rail.addTrack(p, net, pt(0, 0), pt(50, 0));
    // Punkt seitlich und etwas hinter dem Gleisende: früher lief der Bogen spitz zurück
    const b = rail.addTrack(p, net, node(a.toNodeId), pt(44, 40));
    const seg = p.railSegments[b.segmentId]!;
    const endAtNode = seg.a.nodeId === a.toNodeId ? seg.a : seg.b;
    const existing = p.railSegments[a.segmentId]!;
    const existingEnd = existing.a.nodeId === a.toNodeId ? existing.a : existing.b;
    expect(endAtNode.side).not.toBe(existingEnd.side);
    // Der Bogen beginnt in Fahrtrichtung (über das Gleisende hinaus)
    const pts = segmentPolyline(segmentShape(p, seg)!, 24);
    expect(Math.max(...pts.map((q) => q.x))).toBeGreaterThan(55);
  });

  it('Zusammenführen an einem vorhandenen Gleisende bildet eine Weiche (keine Schlaufe)', () => {
    const p = newProject();
    const net = rail.addNetwork(p, 'N');
    const a = rail.addTrack(p, net, pt(0, -20), pt(60, 0));
    const b = rail.addTrack(p, net, pt(0, 20), node(a.toNodeId));
    const sa = p.railSegments[a.segmentId]!;
    const sb = p.railSegments[b.segmentId]!;
    const sideA = (sa.a.nodeId === a.toNodeId ? sa.a : sa.b).side;
    const sideB = (sb.a.nodeId === a.toNodeId ? sb.a : sb.b).side;
    expect(sideB).toBe(sideA);
  });

  it('Bogenlänge und Parameter sind zueinander invers', () => {
    const p = newProject();
    const net = rail.addNetwork(p, 'N');
    const a = rail.addTrack(p, net, pt(0, 0), pt(50, 0));
    const shape = segmentShape(p, p.railSegments[a.segmentId]!)!;
    expect(lengthAtT(shape, 1)).toBeCloseTo(50, 3);
    expect(tAtLength(shape, 10)).toBeCloseTo(0.2, 3);
    const curved = rail.addTrack(p, net, node(a.toNodeId), pt(90, 40));
    const cs = segmentShape(p, p.railSegments[curved.segmentId]!)!;
    expect(lengthAtT(cs, tAtLength(cs, 17))).toBeCloseTo(17, 1);
  });

  it('Signal auf freiem Gleis teilt das Segment an der gewünschten Meterstelle', () => {
    const p = newProject();
    const net = rail.addNetwork(p, 'N');
    const a = rail.addTrack(p, net, pt(0, 0), pt(50, 0));
    const shape = segmentShape(p, p.railSegments[a.segmentId]!)!;
    const r = rail.addSignalOnSegment(p, a.segmentId, tAtLength(shape, 23), 'block', 'forward');
    const n = p.railNodes[p.railSignals[r.signalId]!.nodeId]!;
    expect(n.position.x).toBeCloseTo(23, 3);
  });
});

/**
 * Zwei spiegelgleiche, gleich lange Wege von S1 nach S2 über eine Weiche:
 * oberer Weg (links in Fahrtrichtung +x, y nach unten) und unterer Weg.
 */
function diamond() {
  const p = newProject();
  const net = rail.addNetwork(p, 'N');
  const s1 = rail.addStation(p, { networkId: net, name: 'S1', position: { x: 0, y: 0, z: 0 }, headingDeg: 0, platforms: PF });
  const F = p.stations[s1]!.frontNodeId;
  const f = p.railNodes[F]!.position;
  const at = (dx: number, dy: number) => rail.addNode(p, net, { x: f.x + dx, y: f.y + dy, z: 0 }, 0);
  const T = at(40, -20);
  const B = at(40, 20);
  const M = at(80, 0);
  const top = [rail.addSegment(p, net, { nodeId: F, side: 'B' }, { nodeId: T, side: 'A' }), rail.addSegment(p, net, { nodeId: T, side: 'B' }, { nodeId: M, side: 'A' })];
  const bot = [rail.addSegment(p, net, { nodeId: F, side: 'B' }, { nodeId: B, side: 'A' }), rail.addSegment(p, net, { nodeId: B, side: 'B' }, { nodeId: M, side: 'A' })];
  const exit = rail.addTrack(p, net, node(M), pt(f.x + 140, f.y));
  const s2 = rail.addStation(p, { networkId: net, name: 'S2', position: { x: 0, y: 0, z: 0 }, headingDeg: 0, backNodeId: exit.toNodeId, platforms: PF });
  return { p, net, s1, s2, top, bot };
}

describe('Wegwahl wie im Spiel', () => {
  it('gleich lange Wege: links vor rechts', () => {
    const { p, net, s1, s2, top, bot } = diamond();
    const g = buildGraph(p, net);
    const r = shortestRoute(p, g, { fromStationId: s1, toStationId: s2, bidirectional: false })!;
    const segs = r.states.map((s) => s.segId);
    expect(segs).toContain(top[0]);
    expect(segs).not.toContain(bot[0]);
  });

  it('gleich lange Wege: weniger Gleisteile vor links', () => {
    const { p, net, s1, s2, top, bot } = diamond();
    // Oberen Weg in drei Teile zerlegen (gleiche Länge, mehr Gleisteile)
    rail.splitSegment(p, top[0]!, 0.5);
    const g = buildGraph(p, net);
    const r = shortestRoute(p, g, { fromStationId: s1, toStationId: s2, bidirectional: false })!;
    expect(r.states.map((s) => s.segId)).toContain(bot[0]);
  });

  it('Bahnhof in Fahrtrichtung kostet 100 m, außer er steht im Fahrplan', () => {
    // S1 → Weiche F: gerade (80 m) durch Bahnhof X oder im Bogen (ca. 100 m) nach M → S2
    const p = newProject();
    const net = rail.addNetwork(p, 'N');
    const s1 = rail.addStation(p, { networkId: net, name: 'S1', position: { x: 0, y: 0, z: 0 }, headingDeg: 0, platforms: PF });
    const F = p.stations[s1]!.frontNodeId;
    const f = p.railNodes[F]!.position;
    const at = (dx: number, dy: number) => rail.addNode(p, net, { x: f.x + dx, y: f.y + dy, z: 0 }, 0);
    const x = rail.addStation(p, { networkId: net, name: 'X', position: { x: 0, y: 0, z: 0 }, headingDeg: 0, backNodeId: F, platforms: [] });
    const M = at(80, 0);
    rail.addTrack(p, net, node(p.stations[x]!.frontNodeId), node(M));
    const T = at(40, -30);
    rail.addSegment(p, net, { nodeId: F, side: 'B' }, { nodeId: T, side: 'A' });
    rail.addSegment(p, net, { nodeId: T, side: 'B' }, { nodeId: M, side: 'A' });
    const exit = rail.addTrack(p, net, node(M), pt(f.x + 140, f.y));
    const s2 = rail.addStation(p, { networkId: net, name: 'S2', position: { x: 0, y: 0, z: 0 }, headingDeg: 0, backNodeId: exit.toNodeId, platforms: PF });
    const g = buildGraph(p, net);
    const xSeg = p.stations[x]!.segmentId;
    const via = (opts: { passThroughPenaltyM?: number; scheduledStationIds?: Set<string> }) =>
      shortestRoute(p, g, { fromStationId: s1, toStationId: s2, bidirectional: false, ...opts })!.states.some((s) => s.segId === xSeg);
    // Ohne Aufschlag ist der gerade Weg über X kürzer
    expect(via({ passThroughPenaltyM: 0 })).toBe(true);
    // Mit 100 m Aufschlag wird X gemieden …
    expect(via({ passThroughPenaltyM: 100 })).toBe(false);
    // … außer X steht im Fahrplan
    expect(via({ passThroughPenaltyM: 100, scheduledStationIds: new Set([s1, s2, x]) })).toBe(true);
  });
});

/** Rundkurs mit zwei Bahnhöfen (wie simulation.test.ts). */
function loop() {
  const p = newProject();
  const net = rail.addNetwork(p, 'Netz');
  const s1 = rail.addStation(p, { networkId: net, name: 'S1', position: { x: 0, y: 0, z: 0 }, headingDeg: 0, platforms: PF });
  const S1 = p.stations[s1]!;
  const x = rail.addTrack(p, net, node(S1.frontNodeId), pt(92, 60));
  const y = rail.addTrack(p, net, node(x.toNodeId), pt(32, 120)).toNodeId;
  const s2 = rail.addStation(p, { networkId: net, name: 'S2', position: { x: 0, y: 0, z: 0 }, headingDeg: 0, backNodeId: y, platforms: PF });
  const S2 = p.stations[s2]!;
  const w = rail.addTrack(p, net, node(S2.frontNodeId), pt(-60, 60));
  rail.addTrack(p, net, node(w.toNodeId), node(S1.backNodeId));
  return { p, net, s1, s2 };
}

function addTrain(p: Project, net: string, stops: string[], name: string, consist = [{ kind: 'locomotive' as const, reversed: false }, { kind: 'wagon' as const, cargo: 'solid' as const }]) {
  const tt = rail.addTimetable(p, net, `FP ${name}`, stops);
  const t = rail.addTrain(p, net, name, consist);
  rail.updateTrain(p, t, { timetableId: tt });
  return t;
}

describe('Simulation: mehr Züge als Bahnhöfe', () => {
  it('Züge ohne freien Halt starten an einer zufälligen freien Stelle und fahren los', () => {
    const { p, net, s1, s2 } = loop();
    addTrain(p, net, [s1, s2], 'Z1');
    addTrain(p, net, [s2, s1], 'Z2');
    addTrain(p, net, [s1, s2], 'Z3');
    const sim = new TrainSimulation(p, net, simSettingsFrom(p, gd));
    const z3 = sim.trains.find((t) => t.name === 'Z3')!;
    expect(sim.events.some((e) => e.kind === 'random-start' && e.trainIds.includes(z3.id))).toBe(true);
    expect(z3.status).toBe('driving');
    expect(z3.path.length).toBeGreaterThan(0);
    // Startplatz liegt nicht auf einem Bahnhofsgleis
    const stationSegs = new Set(Object.values(p.stations).map((s) => s.segmentId));
    expect(stationSegs.has(z3.path[0]!.segId)).toBe(false);
    // Reproduzierbar: gleicher Startplatz bei erneutem Aufbau
    const again = new TrainSimulation(p, net, simSettingsFrom(p, gd)).trains.find((t) => t.name === 'Z3')!;
    expect(again.path.map((s) => s.segId)).toEqual(z3.path.map((s) => s.segId));
  });
});

describe('Zugkraft und Zuglänge', () => {
  function ramp(rise: number) {
    const p = newProject();
    const net = rail.addNetwork(p, 'N');
    const s1 = rail.addStation(p, { networkId: net, name: 'S1', position: { x: 0, y: 0, z: 0 }, headingDeg: 0, platforms: [...PF, ...PF] });
    const F = p.stations[s1]!.frontNodeId;
    const f = p.railNodes[F]!.position;
    // 80 m Rampe mit `rise` m Steigung, dann ebene Strecke zum Bahnhof S2
    const up = rail.addTrack(p, net, node(F), pt(f.x + 80, f.y, rise));
    const s2 = rail.addStation(p, { networkId: net, name: 'S2', position: { x: 0, y: 0, z: 0 }, headingDeg: 0, backNodeId: up.toNodeId, platforms: PF });
    return { p, net, s1, s2 };
  }

  it('volle Wagen auf 12,5 % Steigung: eine Lok zieht 13 Wagen', () => {
    const { p, net, s1, s2 } = ramp(10);
    const consist = [{ kind: 'locomotive' as const, reversed: false }, ...Array.from({ length: 14 }, () => ({ kind: 'wagon' as const, cargo: 'solid' as const }))];
    const t = addTrain(p, net, [s1, s2], 'Z', consist);
    const tr = trainTraction(p, gd, t)!;
    expect(tr.maxGrade).toBeCloseTo(0.125, 3);
    expect(tr.rampClass).toBe('ramp1m');
    expect(tr.wagonsPerLoco).toBe(13);
    expect(tr.locosNeeded).toBe(2);
    expect(tr.ok).toBe(false);
    expect(checkNetwork(p, gd, net).some((f) => f.ruleId === 'RAIL-025')).toBe(true);
    // Mit zweiter Lok passt es
    rail.updateTrain(p, t, { consist: [{ kind: 'locomotive', reversed: false }, ...consist] });
    expect(trainTraction(p, gd, t)!.ok).toBe(true);
    expect(checkNetwork(p, gd, net).some((f) => f.ruleId === 'RAIL-025')).toBe(false);
  });

  it('ebene Strecke: keine Grenzwerte, Maximallänge aus dem kürzesten Bahnhof', () => {
    const { p, net, s1, s2 } = ramp(0);
    const t = addTrain(p, net, [s1, s2], 'Z');
    const tr = trainTraction(p, gd, t)!;
    expect(tr.rampClass).toBeNull();
    expect(tr.ok).toBe(true);
    // S2 hat ein Bahnsteig: Lok + 1 Wagen
    expect(tr.maxVehicles).toBe(2);
    expect(tr.shortestStationId).toBe(s2);
  });
});

describe('Umschlag nur bestimmter Gegenstände', () => {
  function setup(transfer: 'all' | 'items' | 'none', itemIds: string[] = []) {
    const p = newProject();
    const fa = firstFactory(p).factory.id;
    const fb = fac.addFactory(p, 'B');
    const { p: q, net, s1, s2 } = (() => {
      const net = rail.addNetwork(p, 'N');
      const s1 = rail.addStation(p, { networkId: net, name: 'S1', position: { x: 0, y: 0, z: 0 }, headingDeg: 0, platforms: PF });
      const s2 = rail.addStation(p, { networkId: net, name: 'S2', position: { x: 0, y: 200, z: 0 }, headingDeg: 0, platforms: PF });
      return { p, net, s1, s2 };
    })();
    const t = addTrain(q, net, [s1, s2], 'Z');
    const tt = q.timetables[q.trains[t]!.timetableId!]!;
    rail.updateTimetable(q, tt.id, { stops: tt.stops.map((s) => (s.stationId === s1 ? { ...s, transfer, itemIds } : s)) });
    const o = tops.addOrder(q, gd, { name: 'Erz', itemId: 'Desc_OreIron_C', ratePerMin: 60, fromFactoryId: fa, toFactoryId: fb, fromStationId: s1, toStationId: s2, trainIds: [t], roundTripEstimateS: null });
    return { p: q, o };
  }

  it('Halt ohne den Gegenstand zählt nicht als Ladehalt (TRN-010)', () => {
    const { p, o } = setup('items', ['Desc_Coal_C']);
    const est = estimateOrder(p, gd, p.transportOrders[o]!);
    expect(est.trains[0]!.servesFrom).toBe(false);
    expect(est.trains[0]!.excludedFrom).toBe(true);
    const ids = checkTransport(p, gd).map((f) => f.ruleId);
    expect(ids).toContain('TRN-010');
    expect(ids).not.toContain('TRN-002');
  });

  it('Halt mit dem Gegenstand in der Auswahl zählt', () => {
    const { p, o } = setup('items', ['Desc_OreIron_C']);
    expect(estimateOrder(p, gd, p.transportOrders[o]!).trains[0]!.servesFrom).toBe(true);
    expect(checkTransport(p, gd).map((f) => f.ruleId)).not.toContain('TRN-010');
  });
});

describe('Förderhöhe von Rohren', () => {
  function pipeRise(dz: number, pump?: { vertical?: 'up' }) {
    const p = newProject();
    const { factory, floorId } = firstFactory(p);
    const src = fac.addBuilding(p, gd, { factoryId: factory.id, type: 'Build_WaterPump_C', placement: { floorId, x: 0, y: 0, zOffsetM: 0, rotationDeg: 0 } });
    p.buildings[src]!.extraction = { itemId: 'Desc_Water_C', purity: 'normal', nodeId: null };
    const dst = fac.addBuilding(p, gd, { factoryId: factory.id, type: 'Build_PipeStorageTank_C', placement: { floorId, x: 60, y: 0, zOffsetM: dz, rotationDeg: 0 } });
    if (!pump) {
      const l = fac.addLink(p, gd, { kind: 'pipe', tier: 'Build_PipelineMK2_C', from: { buildingId: src, portId: 'pipe-out-0' }, to: { buildingId: dst, portId: 'pipe-in-0' }, waypoints: [] });
      return { p, factoryId: factory.id, links: [l] };
    }
    const pu = fac.addBuilding(p, gd, { factoryId: factory.id, type: 'Build_PipelinePump_C', placement: { floorId, x: 30, y: 0, zOffsetM: 0, rotationDeg: 0, ...(pump.vertical ? { vertical: pump.vertical } : {}) } });
    const l1 = fac.addLink(p, gd, { kind: 'pipe', tier: 'Build_PipelineMK2_C', from: { buildingId: src, portId: 'pipe-out-0' }, to: { buildingId: pu, portId: 'pipe-in-0' }, waypoints: [] });
    const l2 = fac.addLink(p, gd, { kind: 'pipe', tier: 'Build_PipelineMK2_C', from: { buildingId: pu, portId: 'pipe-out-0' }, to: { buildingId: dst, portId: 'pipe-in-0' }, waypoints: [] });
    return { p, factoryId: factory.id, links: [l1, l2] };
  }

  it('Wasserextraktor schafft 10 m; höher meldet FAB-019', () => {
    const low = pipeRise(5);
    expect(checkHeights(low.p, gd, low.factoryId).map((f) => f.ruleId)).not.toContain('FAB-019');
    const high = pipeRise(20);
    const head = pipeHeads(high.p, gd, high.factoryId).get(high.links[0]!)!;
    expect(head.liftM).toBe(10);
    expect(head.maxZ).toBeGreaterThan(head.reachZ!);
    expect(checkHeights(high.p, gd, high.factoryId).map((f) => f.ruleId)).toContain('FAB-019');
  });

  it('eine Pumpe dazwischen hebt um 20 m', () => {
    const { p, factoryId, links } = pipeRise(15, {});
    const heads = pipeHeads(p, gd, factoryId);
    expect(heads.get(links[1]!)!.liftM).toBe(20);
    expect(checkHeights(p, gd, factoryId).map((f) => f.ruleId)).not.toContain('FAB-019');
  });
});

describe('Anschlüsse und Einbaulage', () => {
  it('LKW- und Tanklaster-Station: erster Bandeingang ist der Treibstoffeingang', () => {
    for (const type of ['Build_TruckStation_C', 'Build_FluidTruckStation_C']) {
      const ports = portDefs(gd.building(type)!);
      expect(ports.filter((x) => x.role === 'fuel').map((x) => x.id)).toEqual(['belt-in-0']);
    }
  });

  it('Weltraumlift: je drei Eingänge auf gegenüberliegenden Seiten', () => {
    const ports = portDefs(gd.building('Build_SpaceElevator_C')!);
    expect(ports).toHaveLength(6);
    const back = ports.filter((x) => x.normal.y < 0);
    const front = ports.filter((x) => x.normal.y > 0);
    expect([back.length, front.length]).toEqual([3, 3]);
  });

  it('senkrechte Pumpe: steht auf der Längsachse, Eingang unten, Ausgang oben', () => {
    const def = gd.building('Build_PipelinePump_C')!;
    const p = newProject();
    const { factory, floorId } = firstFactory(p);
    const id = fac.addBuilding(p, gd, { factoryId: factory.id, type: def.id, placement: { floorId, x: 0, y: 0, zOffsetM: 0, rotationDeg: 0 } });
    expect(fac.setVertical(p, gd, [id], 'up')).toBe(1);
    const b = p.buildings[id]!;
    const parts = buildingFootprint(def, b.placement!, p.floors[floorId]);
    expect(parts[0]!.zMax - parts[0]!.zMin).toBeCloseTo(def.bounds!.maxX - def.bounds!.minX, 3);
    const ports = worldPorts(b, def, p.floors[floorId]);
    const inlet = ports.find((x) => x.direction === 'in')!;
    const outlet = ports.find((x) => x.direction === 'out')!;
    expect(outlet.world.z).toBeGreaterThan(inlet.world.z);
    expect([inlet.vertical, outlet.vertical]).toEqual([-1, 1]);
    // gleiche Anschluss-IDs wie waagrecht → Verbindungen bleiben gültig
    expect(placedPortDefs(def, b.placement).map((x) => x.id).sort()).toEqual(portDefs(def).map((x) => x.id).sort());
    // Rohr an den senkrechten Eingang beginnt senkrecht darunter
    const src = fac.addBuilding(p, gd, { factoryId: factory.id, type: 'Build_WaterPump_C', placement: { floorId, x: -40, y: 0, zOffsetM: 0, rotationDeg: 0 } });
    const l = fac.addLink(p, gd, { kind: 'pipe', tier: 'Build_PipelineMK2_C', from: { buildingId: src, portId: 'pipe-out-0' }, to: { buildingId: id, portId: 'pipe-in-0' }, waypoints: [] });
    const path = linkPath(p, gd, p.links[l]!)!;
    const last = path.at(-1)!;
    const before = path.at(-2)!;
    expect([before.x, before.y]).toEqual([last.x, last.y]);
    expect(before.z).toBeLessThan(last.z);
    // Andere Gebäude lassen sich nicht senkrecht stellen
    const con = fac.addBuilding(p, gd, { factoryId: factory.id, type: 'Build_ConstructorMk1_C', placement: { floorId, x: 40, y: 40, zOffsetM: 0, rotationDeg: 0 } });
    expect(fac.setVertical(p, gd, [con], 'up')).toBe(0);
  });
});
