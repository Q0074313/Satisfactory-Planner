/**
 * Hotfix 0.6.1: Bahnhöfe ↔ Grundriss in beide Richtungen, Vorkommen von der
 * Karte belegen, Rohstoffbedarf gegen belegte Vorkommen, Suchbereich des
 * Standortvorschlags, gerade Bänder in den Beispielprojekten.
 */
import { describe, expect, it } from 'vitest';
import { clone } from '../src/model/clone.ts';
import type { Project } from '../src/model/schema.ts';
import { toWorldOf, type MapNode } from '../src/map/index.ts';
import { factoryNodeDemand, suggestSites } from '../src/map/suggest.ts';
import * as fac from '../src/project/ops/factory.ts';
import * as mapOps from '../src/project/ops/map.ts';
import * as prod from '../src/project/ops/production.ts';
import * as rail from '../src/project/ops/rail.ts';
import { syncStations } from '../src/project/ops/stationSync.ts';
import { buildExampleProject } from '../src/project/examples.ts';
import { linkPath } from '../src/factory/linkPath.ts';
import { firstFactory, gameData, newProject } from './helpers.ts';

const gd = gameData();
const pureIron = gd.map!.nodes.filter((n: MapNode) => n.kind === 'node' && n.itemId === 'Desc_OreIron_C' && n.purity === 'pure');

/** Änderung wie in der Oberfläche: Operation, danach Abgleich gegen den Stand vorher. */
function step(p: Project, fn: (p: Project) => void) {
  const prev = clone(p);
  fn(p);
  syncStations(prev, p, gd);
}

const parts = (p: Project) => Object.values(p.buildings).filter((b) => b.stationPart);
const part = (p: Project, platformId: string | null) => parts(p).find((b) => b.stationPart!.platformId === platformId)!;

/** Fabrik bei (1000, 2000) um 90° gedreht; Bahnhof mit Güter- (Beladen) und Flüssigkeitsbahnsteig (Entladen). */
function stationSetup() {
  const p = newProject();
  const { factory } = firstFactory(p);
  mapOps.setFactoryMap(p, factory.id, { x: 1000, y: 2000, rotationDeg: 90 });
  const net = rail.addNetwork(p, 'N');
  const st = rail.addStation(p, {
    networkId: net,
    name: 'Erzbahnhof',
    position: { x: 1040, y: 2000, z: 0 },
    headingDeg: 0,
    platforms: [
      { type: 'freight', mode: 'load', flipped: false },
      { type: 'fluid', mode: 'unload', flipped: false },
    ],
  });
  step(p, (d) => rail.updateStation(d, st, { factoryId: factory.id }));
  return { p, factoryId: factory.id, st };
}

const worldOfPart = (p: Project, factoryId: string, platformId: string | null) => {
  const b = part(p, platformId);
  return toWorldOf(p.factories[factoryId]!.map!, b.placement!);
};

describe('Bahnhöfe ↔ Fabrikgrundriss', () => {
  it('Zuordnung legt Bahnhofsgebäude und Bahnsteige an der Weltlage des Bahnhofs an', () => {
    const { p, factoryId, st } = stationSetup();
    const station = p.stations[st]!;
    expect(parts(p).map((b) => b.type).sort()).toEqual(['Build_TrainDockingStationLiquid_C', 'Build_TrainDockingStation_C', 'Build_TrainStation_C']);
    // Hinten bei x = 1040, Gebäude vorn: Mitte 8 m vor dem vorderen Knoten (x = 1040 + 48 − 8)
    const front = p.railNodes[station.frontNodeId]!.position;
    expect(front.x).toBeCloseTo(1088);
    const c = worldOfPart(p, factoryId, null);
    expect(c.x).toBeCloseTo(1080);
    expect(c.y).toBeCloseTo(2000);
    expect(worldOfPart(p, factoryId, station.platforms[0]!.id).x).toBeCloseTo(1064);
    // Gleisachse = lokale x-Achse: Fabrik 90° gedreht, Gleis zeigt nach Osten → lokal 270°
    expect(part(p, null).placement!.rotationDeg).toBeCloseTo(270);
    expect(part(p, station.platforms[0]!.id).transfer).toEqual({ mode: 'load', stationId: st });
    expect(part(p, station.platforms[1]!.id).transfer).toEqual({ mode: 'unload', stationId: st });
    expect(part(p, null).label).toBe('Erzbahnhof');
  });

  it('Schienennetz → Grundriss: Bahnhof verschieben, Bahnsteig hinzufügen', () => {
    const { p, factoryId, st } = stationSetup();
    step(p, (d) => rail.moveStation(d, st, { x: 16, y: -8, z: 0 }));
    expect(worldOfPart(p, factoryId, null).x).toBeCloseTo(1096);
    expect(worldOfPart(p, factoryId, null).y).toBeCloseTo(1992);
    step(p, (d) => rail.setPlatforms(d, st, [...d.stations[st]!.platforms, { type: 'empty', mode: 'load', flipped: false }]));
    expect(parts(p)).toHaveLength(4);
    expect(parts(p).some((b) => b.type === 'Build_TrainPlatformEmpty_C')).toBe(true);
  });

  it('Grundriss → Schienennetz: Teil verschieben bzw. drehen bewegt den ganzen Bahnhof', () => {
    const { p, st } = stationSetup();
    const station = () => p.stations[st]!;
    const back0 = { ...p.railNodes[station().backNodeId]!.position };
    // Lokal +x um 8 m: bei 90° Drehung der Fabrik ist das Welt +y
    step(p, (d) => fac.moveBuildings(d, [part(d, station().platforms[0]!.id).id], 8, 0));
    const back1 = p.railNodes[station().backNodeId]!.position;
    expect(back1.x).toBeCloseTo(back0.x);
    expect(back1.y).toBeCloseTo(back0.y + 8);
    // Alle Teile sind mitgewandert
    const a = part(p, null).placement!;
    const b = part(p, station().platforms[1]!.id).placement!;
    expect(a.x).toBeCloseTo(b.x);
    // Drehen des Bahnhofsgebäudes um 90° dreht den Bahnhof um dessen Mitte
    const id = part(p, null).id;
    step(p, (d) => fac.rotateBuildings(d, [id], 90));
    const s = station();
    const dir = { x: p.railNodes[s.frontNodeId]!.position.x - p.railNodes[s.backNodeId]!.position.x, y: p.railNodes[s.frontNodeId]!.position.y - p.railNodes[s.backNodeId]!.position.y };
    expect(Math.abs(dir.x)).toBeLessThan(1e-3);
    expect(dir.y).toBeCloseTo(48);
  });

  it('Grundriss → Schienennetz: Bahnsteig an Ort und Stelle umdrehen, Be-/Entladen, Bahnsteig löschen', () => {
    const { p, st } = stationSetup();
    const station = () => p.stations[st]!;
    const pl0 = station().platforms[0]!.id;
    const back0 = { ...p.railNodes[station().backNodeId]!.position };
    step(p, (d) => fac.rotateBuildings(d, [part(d, pl0).id], 180));
    expect(station().platforms[0]!.flipped).toBe(true);
    expect(p.railNodes[station().backNodeId]!.position).toEqual(back0);
    step(p, (d) => fac.updateBuildings(d, gd, [part(d, pl0).id], { transfer: { mode: 'unload', stationId: st } }));
    expect(station().platforms[0]!.mode).toBe('unload');
    step(p, (d) => fac.removeBuildings(d, [part(d, station().platforms[1]!.id).id]));
    expect(station().platforms).toHaveLength(1);
    expect(parts(p)).toHaveLength(2);
  });

  it('Fabrik auf der Karte verschieben nimmt den Bahnhof mit; Bahnhofsgebäude löschen entfernt den Bahnhof', () => {
    const { p, factoryId, st } = stationSetup();
    const local0 = { ...part(p, null).placement! };
    step(p, (d) => mapOps.moveFactoryOnMap(d, factoryId, 100, 0));
    expect(p.railNodes[p.stations[st]!.backNodeId]!.position.x).toBeCloseTo(1140);
    expect(part(p, null).placement!.x).toBeCloseTo(local0.x);
    expect(part(p, null).placement!.y).toBeCloseTo(local0.y);
    step(p, (d) => fac.removeBuildings(d, [part(d, null).id]));
    expect(p.stations[st]).toBeUndefined();
    expect(parts(p)).toHaveLength(0);
  });

  it('Zuordnung lösen entfernt die Teile; vorhandene Bahnsteige werden übernommen statt verdoppelt', () => {
    const { p, factoryId, st } = stationSetup();
    step(p, (d) => rail.updateStation(d, st, { factoryId: null }));
    expect(parts(p)).toHaveLength(0);
    // Von Hand gebauter Bahnsteig mit Bahnhofszuordnung
    const floorId = p.factories[factoryId]!.floorIds[0]!;
    const own = fac.addBuilding(p, gd, { factoryId, type: 'Build_TrainDockingStation_C', placement: { floorId, x: 0, y: 0, zOffsetM: 0, rotationDeg: 0 }, transfer: { mode: 'load', stationId: st } });
    step(p, (d) => rail.updateStation(d, st, { factoryId }));
    expect(parts(p)).toHaveLength(3);
    expect(p.buildings[own]!.stationPart).toEqual({ stationId: st, platformId: p.stations[st]!.platforms[0]!.id });
  });

  it('ohne Kartenstandort der Fabrik bleibt alles unverändert', () => {
    const p = newProject();
    const { factory } = firstFactory(p);
    const net = rail.addNetwork(p, 'N');
    const st = rail.addStation(p, { networkId: net, name: 'B', position: { x: 0, y: 0, z: 0 }, headingDeg: 0, platforms: [{ type: 'freight', mode: 'load', flipped: false }] });
    step(p, (d) => rail.updateStation(d, st, { factoryId: factory.id }));
    expect(parts(p)).toHaveLength(0);
  });
});

describe('Vorkommen belegen und Bedarf', () => {
  it('occupyNode legt einen verknüpften Miner an, platziert über dem Vorkommen, wenn die Fabrik auf der Karte steht', () => {
    const p = newProject();
    const { factory } = firstFactory(p);
    const n = pureIron[0]!;
    const unplaced = mapOps.occupyNode(p, gd, n.id, factory.id, 'Build_MinerMk2_C');
    expect(p.buildings[unplaced]!.placement).toBeNull();
    expect(p.buildings[unplaced]!.extraction).toEqual({ itemId: 'Desc_OreIron_C', purity: 'pure', nodeId: n.id });
    expect(() => mapOps.occupyNode(p, gd, n.id, factory.id, 'Build_MinerMk2_C')).toThrow(/belegt/);
    const n1 = pureIron[1]!;
    mapOps.setFactoryMap(p, factory.id, { x: n1.x - 40, y: n1.y, rotationDeg: 0 });
    const placed = mapOps.occupyNode(p, gd, n1.id, factory.id, 'Build_MinerMk1_C');
    const w = toWorldOf(p.factories[factory.id]!.map!, p.buildings[placed]!.placement!);
    expect(w.x).toBeCloseTo(n1.x, 3);
    expect(w.y).toBeCloseTo(n1.y, 3);
    // Weit außerhalb des Grundrisses: nur geplant
    const far = pureIron.find((x) => Math.hypot(x.x - n1.x, x.y - n1.y) > 1000)!;
    expect(p.buildings[mapOps.occupyNode(p, gd, far.id, factory.id, 'Build_MinerMk1_C')]!.placement).toBeNull();
  });

  it('factoryNodeDemand: Bedarf aus den Plänen gegen die Förderung verknüpfter und nicht verknüpfter Miner', () => {
    const p = newProject();
    const { factory } = firstFactory(p);
    const plan = prod.addPlan(p, factory.id, 'Platten');
    prod.updatePlan(p, gd, plan, { targets: [{ itemId: 'Desc_IronPlate_C', ratePerMin: 120 }] });
    mapOps.occupyNode(p, gd, pureIron[0]!.id, factory.id, 'Build_MinerMk1_C');
    fac.addBuilding(p, gd, { factoryId: factory.id, type: 'Build_MinerMk1_C', extraction: { itemId: 'Desc_OreIron_C', purity: 'normal' } });
    const [iron] = factoryNodeDemand(p, gd, factory.id);
    expect(iron).toMatchObject({ itemId: 'Desc_OreIron_C', nodes: 1 });
    expect(iron!.demand).toBeCloseTo(180);
    expect(iron!.linked).toBeCloseTo(120);
    expect(iron!.unlinked).toBeCloseTo(60);
  });

  it('Standortvorschlag nur im gewählten Bereich', () => {
    const n = pureIron[0]!;
    const bounds = { minX: n.x - 500, minY: n.y - 500, maxX: n.x + 500, maxY: n.y + 500 };
    const s = suggestSites(gd, [{ itemId: 'Desc_OreIron_C', perMin: 120 }], { minerType: 'Build_MinerMk1_C', clock: 1, bounds });
    expect(s.length).toBeGreaterThan(0);
    for (const r of s) for (const pk of r.picks) {
      const m = gd.mapNode(pk.nodeId)!;
      expect(m.x >= bounds.minX && m.x <= bounds.maxX && m.y >= bounds.minY && m.y <= bounds.maxY).toBe(true);
    }
  });
});

describe('Beispielprojekte', () => {
  it('Gebäude zeigen in Flussrichtung, alle Bänder verlaufen rechtwinklig', () => {
    for (const kind of ['simple', 'complex'] as const) {
      const p = buildExampleProject(gd, kind, { datasetId: 'sf-1.2.4.0', gameVersion: '1.2.4.0' });
      for (const l of Object.values(p.links)) {
        const pts = linkPath(p, gd, l)!;
        for (let i = 1; i < pts.length; i++) {
          const dx = Math.abs(pts[i]!.x - pts[i - 1]!.x);
          const dy = Math.abs(pts[i]!.y - pts[i - 1]!.y);
          expect(Math.min(dx, dy), `${kind} ${l.id}`).toBeLessThan(1e-6);
        }
        // Höchstens ein Knick je Band
        expect(pts.length, `${kind} ${l.id}`).toBeLessThanOrEqual(5);
      }
    }
  });
});
