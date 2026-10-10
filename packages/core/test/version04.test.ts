/**
 * Neuerungen Version 0.4: Pumpe in eine Leitung einsetzen.
 */
import { describe, expect, it } from 'vitest';
import * as fac from '../src/project/ops/factory.ts';
import * as rail from '../src/project/ops/rail.ts';
import { checkNetwork } from '../src/rail/checks.ts';
import type { Project } from '../src/model/schema.ts';
import { linkEnds } from '../src/factory/linkPath.ts';
import { worldPorts } from '../src/factory/ports.ts';
import { firstFactory, gameData, newProject } from './helpers.ts';

const gd = gameData();

function pipeline() {
  const p = newProject();
  const { factory, floorId } = firstFactory(p);
  const src = fac.addBuilding(p, gd, { factoryId: factory.id, type: 'Build_WaterPump_C', placement: { floorId, x: 0, y: 0, zOffsetM: 0, rotationDeg: 0 } });
  const dst = fac.addBuilding(p, gd, { factoryId: factory.id, type: 'Build_PipeStorageTank_C', placement: { floorId, x: 60, y: 40, zOffsetM: 0, rotationDeg: 0 } });
  const l = fac.addLink(p, gd, { kind: 'pipe', tier: 'Build_PipelineMK2_C', from: { buildingId: src, portId: 'pipe-out-0' }, to: { buildingId: dst, portId: 'pipe-in-0' }, waypoints: [] });
  return { p, factoryId: factory.id, src, dst, l };
}

const portsOf = (p: ReturnType<typeof pipeline>['p'], id: string) => {
  const b = p.buildings[id]!;
  return worldPorts(b, gd.building(b.type)!, p.floors[b.placement!.floorId]);
};

describe('Pumpe in eine Leitung einsetzen', () => {
  it('waagrecht: Leitung wird geteilt, Pumpe liegt in Flussrichtung auf der Leitung', () => {
    const { p, src, dst, l } = pipeline();
    const ends = linkEnds(p, gd, p.links[l]!)!;
    const z = ends.from.world.z;
    // Zwei Zwischenpunkte: erst nach +x, dann nach +y
    const w1 = { x: 30, y: ends.from.world.y + 10, z };
    const w2 = { x: 30, y: 30, z };
    fac.updateLink(p, gd, l, { waypoints: [w1, w2] });
    const at = { x: 30, y: 26, z };
    const pump = fac.insertIntoLink(p, gd, l, 'Build_PipelinePump_C', at);

    expect(p.links[l]).toBeUndefined();
    const links = Object.values(p.links);
    expect(links).toHaveLength(2);
    const first = links.find((x) => x.from.buildingId === src)!;
    const second = links.find((x) => x.to.buildingId === dst)!;
    expect(first.to).toEqual({ buildingId: pump, portId: 'pipe-in-0' });
    expect(second.from).toEqual({ buildingId: pump, portId: 'pipe-out-0' });
    expect(first.waypoints).toEqual([w1]);
    expect(second.waypoints).toEqual([w2]);

    // Anschlüsse der Pumpe auf der Leitung, Ausgang in Flussrichtung (+y)
    const ports = portsOf(p, pump);
    const pin = ports.find((x) => x.id === 'pipe-in-0')!;
    const pout = ports.find((x) => x.id === 'pipe-out-0')!;
    expect(pin.world.x).toBeCloseTo(30, 6);
    expect(pout.world.x).toBeCloseTo(30, 6);
    expect(pin.world.z).toBeCloseTo(z, 6);
    expect(pout.world.y).toBeGreaterThan(pin.world.y);
    expect((pin.world.y + pout.world.y) / 2).toBeCloseTo(26, 6);
    expect(p.buildings[pump]!.placement!.vertical).toBeUndefined();
  });

  it('senkrecht: auf einem steigenden Leitungsstück wird die Pumpe senkrecht (aufwärts) eingebaut', () => {
    const { p, l } = pipeline();
    const ends = linkEnds(p, gd, p.links[l]!)!;
    const z = ends.from.world.z;
    const w1 = { x: 30, y: 20, z };
    const w2 = { x: 30, y: 20, z: z + 12 };
    fac.updateLink(p, gd, l, { waypoints: [w1, w2] });
    const pump = fac.insertIntoLink(p, gd, l, 'Build_PipelinePump_C', { x: 30, y: 20, z: z + 6 });
    const pl = p.buildings[pump]!.placement!;
    expect(pl.vertical).toBe('up');
    const ports = portsOf(p, pump);
    const pin = ports.find((x) => x.id === 'pipe-in-0')!;
    const pout = ports.find((x) => x.id === 'pipe-out-0')!;
    expect(pout.world.z).toBeGreaterThan(pin.world.z);
    expect((pin.world.z + pout.world.z) / 2).toBeCloseTo(z + 6, 6);
  });

  it('Gebäude ohne genau einen Ein- und Ausgang wird abgelehnt', () => {
    const { p, l } = pipeline();
    expect(() => fac.insertIntoLink(p, gd, l, 'Build_ConstructorMk1_C', { x: 30, y: 0, z: 0 })).toThrow();
    expect(p.links[l]).toBeDefined();
  });
});

describe('Pfadsignal-Ketten (RAIL-026)', () => {
  const pt = (x: number, y: number) => ({ kind: 'point' as const, position: { x, y, z: 0 } });
  const node = (nodeId: string) => ({ kind: 'node' as const, nodeId });
  const signalAfter = (p: Project, segId: string, nodeId: string, kind: 'block' | 'path') => {
    const seg = p.railSegments[segId]!;
    const end = seg.a.nodeId === nodeId ? seg.a : seg.b;
    return rail.addSignal(p, nodeId, kind, end.side === 'A' ? 'forward' : 'backward');
  };
  const segBetween = (p: Project, n1: string, n2: string) =>
    Object.values(p.railSegments).find((s) => (s.a.nodeId === n1 && s.b.nodeId === n2) || (s.a.nodeId === n2 && s.b.nodeId === n1))!.id;

  /** Rundkurs S1 → S2 → S1; auf dem Weg S1 → S2 liegen `kinds` als Signale hintereinander. */
  function loop(kinds: ('block' | 'path')[]) {
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
    rail.addTrack(p, net, node(w.toNodeId), node(S1.backNodeId));
    // Knoten auf dem Weg S1 → S2: S1-Ausfahrt, zwei Teilungspunkte auf x, Knoten x
    const mid1 = rail.splitSegment(p, x.segmentId, 1 / 3);
    const mid2 = rail.splitSegment(p, segBetween(p, mid1, x.toNodeId), 0.5);
    const chain = [S1.frontNodeId, mid1, mid2, x.toNodeId];
    const before = [S1.segmentId, segBetween(p, S1.frontNodeId, mid1), segBetween(p, mid1, mid2), segBetween(p, mid2, x.toNodeId)];
    kinds.forEach((k, i) => signalAfter(p, before[i]!, chain[i]!, k));
    signalAfter(p, segBetween(p, x.toNodeId, y), y, 'block');
    signalAfter(p, S2.segmentId, S2.frontNodeId, 'block');
    const tt = rail.addTimetable(p, net, 'FP', [s1, s2]);
    const t = rail.addTrain(p, net, 'Z1', [{ kind: 'locomotive', reversed: false }, { kind: 'wagon', cargo: 'solid' }]);
    rail.updateTrain(p, t, { timetableId: tt });
    return { p, net, t };
  }

  it('drei Pfadsignale hintereinander auf dem Fahrweg: Warnung mit Zug und Länge', () => {
    const { p, net, t } = loop(['path', 'path', 'path']);
    const f = checkNetwork(p, gd, net).find((x) => x.ruleId === 'RAIL-026')!;
    expect(f).toBeDefined();
    expect(f.severity).toBe('warning');
    expect(f.message).toContain('3');
    expect(f.objects).toContainEqual({ table: 'trains', id: t });
  });

  it('Blocksignal in der Mitte unterbricht die Kette', () => {
    const { p, net } = loop(['path', 'block', 'path', 'path']);
    expect(checkNetwork(p, gd, net).map((x) => x.ruleId)).not.toContain('RAIL-026');
  });
});

describe('Gleisraster', () => {
  it('Ecken, Kantenmitten und Feldmitten im 8-m-Raster', async () => {
    const { snapToGrid } = await import('../src/geometry/index.ts');
    expect(snapToGrid({ x: 9, y: 3 }, 8, 'corner')).toEqual({ x: 8, y: 0 });
    expect(snapToGrid({ x: 9, y: 3 }, 8, 'center')).toEqual({ x: 12, y: 4 });
    expect(snapToGrid({ x: 9, y: 3 }, 8, 'edge')).toEqual({ x: 8, y: 4 });
    expect(snapToGrid({ x: 13, y: 1 }, 8, 'edge')).toEqual({ x: 12, y: 0 });
    expect(snapToGrid({ x: 1.3, y: -0.6 }, 1, 'corner')).toEqual({ x: 1, y: -1 });
    expect(Object.is(snapToGrid({ x: 0, y: -2 }, 8, 'corner').y, 0)).toBe(true);
  });

  it('Endrichtung beim Gleisbau absolut zum Raster; Auswahl wird gemeinsam verschoben', () => {
    const p = newProject();
    const net = rail.addNetwork(p, 'N');
    const a = rail.addTrack(p, net, { kind: 'point', position: { x: 0, y: 0, z: 0 } }, { kind: 'point', position: { x: 40, y: 0, z: 0 }, headingDeg: 30 });
    expect(p.railNodes[a.fromNodeId]!.headingDeg).toBe(0);
    expect(p.railNodes[a.toNodeId]!.headingDeg).toBe(30);
    // Vom Knoten aus: feste Endrichtung 45° statt des tangentialen Bogens
    const b = rail.addTrack(p, net, { kind: 'node', nodeId: a.toNodeId }, { kind: 'point', position: { x: 80, y: 20, z: 0 }, headingDeg: 45 });
    expect(p.railNodes[b.toNodeId]!.headingDeg).toBe(45);
    rail.moveSelection(p, [{ table: 'railSegments', id: a.segmentId }, { table: 'railNodes', id: b.toNodeId }], { x: 8, y: 16, z: 0 });
    expect(p.railNodes[a.fromNodeId]!.position).toEqual({ x: 8, y: 16, z: 0 });
    expect(p.railNodes[a.toNodeId]!.position).toEqual({ x: 48, y: 16, z: 0 });
    expect(p.railNodes[b.toNodeId]!.position).toEqual({ x: 88, y: 36, z: 0 });
  });
});
