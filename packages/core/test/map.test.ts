/**
 * Weltkarte: Kartendaten, Fabrikstandort, Verknüpfung mit Vorkommen,
 * Prüfregeln MAP-001 … MAP-008, Entfernungen und Standortvorschlag.
 */
import { describe, expect, it } from 'vitest';
import { factoryFootprint, nodeRate, nodeUsage, orderMapDistance, snapToWorldGrid, toLocalOf, toWorldOf, type MapNode } from '../src/map/index.ts';
import { checkMap } from '../src/map/checks.ts';
import { siteDemandFromPlan, suggestSites, usedNodes } from '../src/map/suggest.ts';
import * as fac from '../src/project/ops/factory.ts';
import * as mapOps from '../src/project/ops/map.ts';
import * as prod from '../src/project/ops/production.ts';
import * as tops from '../src/project/ops/transport.ts';
import { checkTransport } from '../src/transport/checks.ts';
import { createValidator } from '../src/validation/engine.ts';
import type { Project } from '../src/model/schema.ts';
import { firstFactory, gameData, newProject } from './helpers.ts';

const gd = gameData();
const map = gd.map!;
const nodes = (pred: (n: MapNode) => boolean) => map.nodes.filter(pred);
const pureIron = nodes((n) => n.kind === 'node' && n.itemId === 'Desc_OreIron_C' && n.purity === 'pure');

/** Fabrik mit einem Miner Mk.1 im Ursprung; optional auf einem Vorkommen platziert. */
function minerFactory(node?: MapNode) {
  const p = newProject();
  const { factory, floorId } = firstFactory(p);
  const miner = fac.addBuilding(p, gd, { factoryId: factory.id, type: 'Build_MinerMk1_C', placement: { floorId, x: 0, y: 0, zOffsetM: 0, rotationDeg: 0 } });
  if (node) {
    mapOps.setFactoryMap(p, factory.id, { x: node.x, y: node.y, rotationDeg: 0 });
    mapOps.assignNode(p, gd, miner, node.id);
  }
  return { p, factoryId: factory.id, floorId, miner };
}

const ids = (p: Project) => checkMap(p, gd).map((f) => f.ruleId);

describe('Kartendaten', () => {
  it('enthalten alle Vorkommen mit eindeutiger ID, bekanntem Rohstoff und Lage in der Spielwelt', () => {
    expect(map.nodes.length).toBeGreaterThan(600);
    expect(new Set(map.nodes.map((n) => n.id)).size).toBe(map.nodes.length);
    for (const n of map.nodes) {
      if (n.kind !== 'geyser') expect(gd.item(n.itemId!), n.id).toBeDefined();
      expect(n.x).toBeGreaterThanOrEqual(map.world.west);
      expect(n.x).toBeLessThanOrEqual(map.world.east);
      expect(n.y).toBeGreaterThanOrEqual(map.world.north);
      expect(n.y).toBeLessThanOrEqual(map.world.south);
      if (n.kind === 'well') expect(gd.mapNode(n.coreId!)?.kind).toBe('well-core');
    }
  });

  it('Anzahl der Eisenerz-Nodes je Reinheit wie im Wiki (39 / 42 / 46)', () => {
    const iron = (purity: string) => nodes((n) => n.kind === 'node' && n.itemId === 'Desc_OreIron_C' && n.purity === purity).length;
    expect([iron('impure'), iron('normal'), iron('pure')]).toEqual([39, 42, 46]);
  });

  it('Förderrate je Vorkommen: Miner Mk.1 auf reinem Node 120/min, Ölpumpe rein 240 m³/min, Quellenextraktor normal 60 m³/min', () => {
    expect(nodeRate(gd, pureIron[0]!, 'Build_MinerMk1_C')).toBeCloseTo(120);
    expect(nodeRate(gd, pureIron[0]!, 'Build_MinerMk3_C', 2.5)).toBeCloseTo(1200);
    const oil = nodes((n) => n.kind === 'node' && n.itemId === 'Desc_LiquidOil_C' && n.purity === 'pure')[0]!;
    expect(nodeRate(gd, oil, 'Build_OilPump_C')).toBeCloseTo(240);
    expect(nodeRate(gd, oil, 'Build_MinerMk1_C')).toBe(0);
    const well = nodes((n) => n.kind === 'well' && n.purity === 'normal')[0]!;
    expect(nodeRate(gd, well, 'Build_FrackingExtractor_C')).toBeCloseTo(60);
  });
});

describe('Fabrikstandort', () => {
  it('Welt ↔ lokal ist umkehrbar, auch gedreht', () => {
    const m = { x: 1000, y: -500, rotationDeg: 30 };
    const w = toWorldOf(m, { x: 12, y: -7 });
    const l = toLocalOf(m, w);
    expect(l.x).toBeCloseTo(12);
    expect(l.y).toBeCloseTo(-7);
    // 90° im Uhrzeigersinn: lokales +x zeigt in der Welt nach +y (Süden)
    const r = toWorldOf({ x: 0, y: 0, rotationDeg: 90 }, { x: 10, y: 0 });
    expect(r.x).toBeCloseTo(0);
    expect(r.y).toBeCloseTo(10);
  });

  it('Grundriss aus Flächen, sonst aus Gebäuden, sonst Platzhalter', () => {
    const p = newProject();
    const { factory, floorId } = firstFactory(p);
    expect(factoryFootprint(p, gd, factory.id).source).toBe('none');
    fac.addBuilding(p, gd, { factoryId: factory.id, type: 'Build_ConstructorMk1_C', placement: { floorId, x: 40, y: 0, zOffsetM: 0, rotationDeg: 0 } });
    const fb = factoryFootprint(p, gd, factory.id);
    expect(fb.source).toBe('buildings');
    expect(fb.rect.minX).toBeLessThan(40);
    fac.addArea(p, { factoryId: factory.id, floorId, kind: 'build-area', name: 'A', polygon: [{ x: 0, y: 0 }, { x: 64, y: 0 }, { x: 64, y: 32 }, { x: 0, y: 32 }] });
    const fa = factoryFootprint(p, gd, factory.id);
    expect(fa.source).toBe('areas');
    expect(fa.rect).toEqual({ minX: 0, minY: 0, maxX: 64, maxY: 32 });
  });

  it('Weltraster: Fundamentkanten auf Vielfachen von 8 m, auch gedreht und mit versetzter Fundamentfläche', () => {
    const p = newProject();
    const { factory, floorId } = firstFactory(p);
    const edge = (v: number) => Math.abs(((v % 8) + 8) % 8) < 1e-6 || Math.abs(((v % 8) + 8) % 8 - 8) < 1e-6;
    // Ohne Fundament: Ursprung auf einer Kante
    const a = snapToWorldGrid(p, factory.id, { x: 101, y: -37, rotationDeg: 0 });
    expect(edge(a.x) && edge(a.y)).toBe(true);
    // Fundamentfläche mit Ecke bei (3, 1): diese Ecke liegt auf dem Raster, für jede Himmelsrichtung
    fac.addArea(p, { factoryId: factory.id, floorId, kind: 'foundation', polygon: [{ x: 3, y: 1 }, { x: 27, y: 1 }, { x: 27, y: 17 }, { x: 3, y: 17 }] });
    for (const rot of [0, 90, 180, 270]) {
      const m = snapToWorldGrid(p, factory.id, { x: 1234.5, y: -987.25, rotationDeg: rot });
      for (const corner of [{ x: 3, y: 1 }, { x: 27, y: 17 }, { x: 11, y: 9 }]) {
        const w = toWorldOf(m, corner);
        expect(edge(w.x) && edge(w.y), `${rot}° ${corner.x}/${corner.y}`).toBe(true);
      }
      // Höchstens eine halbe Rasterweite verschoben
      expect(Math.abs(m.x - 1234.5)).toBeLessThanOrEqual(4);
    }
  });

  it('setFactoryMap normalisiert die Drehung; Entfernen setzt null', () => {
    const { p, factoryId } = minerFactory();
    mapOps.setFactoryMap(p, factoryId, { x: 1, y: 2, rotationDeg: -90 });
    expect(p.factories[factoryId]!.map).toEqual({ x: 1, y: 2, rotationDeg: 270 });
    mapOps.moveFactoryOnMap(p, factoryId, 8, -8, 90);
    expect(p.factories[factoryId]!.map).toEqual({ x: 9, y: -6, rotationDeg: 0 });
    mapOps.setFactoryMap(p, factoryId, null);
    expect(p.factories[factoryId]!.map).toBeNull();
  });
});

describe('Verknüpfung mit Vorkommen', () => {
  it('übernimmt Rohstoff und Reinheit, ein Vorkommen trägt nur ein Gebäude', () => {
    const { p, factoryId, floorId, miner } = minerFactory(pureIron[0]);
    expect(p.buildings[miner]!.extraction).toEqual({ itemId: 'Desc_OreIron_C', purity: 'pure', nodeId: pureIron[0]!.id });
    expect(nodeUsage(p).get(pureIron[0]!.id)).toEqual([miner]);
    const second = fac.addBuilding(p, gd, { factoryId, type: 'Build_MinerMk2_C', placement: { floorId, x: 20, y: 0, zOffsetM: 0, rotationDeg: 0 } });
    expect(() => mapOps.assignNode(p, gd, second, pureIron[0]!.id)).toThrow(/belegt/);
    const oil = nodes((n) => n.kind === 'node' && n.itemId === 'Desc_LiquidOil_C')[0]!;
    expect(() => mapOps.assignNode(p, gd, second, oil.id)).toThrow();
    mapOps.assignNode(p, gd, miner, null);
    expect(p.buildings[miner]!.extraction).toEqual({ itemId: 'Desc_OreIron_C', purity: 'pure', nodeId: null });
  });

  it('Rohstoff von Hand ändern löst die Verknüpfung; Kopien sind nicht verknüpft', () => {
    const { p, miner } = minerFactory(pureIron[0]);
    const [copy] = fac.duplicateBuildings(p, [miner], { x: 20, y: 0, z: 0 });
    expect(p.buildings[copy!]!.extraction?.nodeId).toBeNull();
    fac.updateBuildings(p, gd, [miner], { extraction: { itemId: 'Desc_OreIron_C', purity: 'normal' } });
    expect(p.buildings[miner]!.extraction?.nodeId).toBeNull();
  });

  it('Gruppen: Vorlage speichert keine Verknüpfung, Abgleich der Instanzen behält sie', () => {
    const { p, factoryId, floorId, miner } = minerFactory(pureIron[0]);
    const g = fac.createGroupFromBuildings(p, [miner], 'G');
    expect(p.groups[g]!.members[0]!.extraction?.nodeId).toBeNull();
    const inst = fac.instantiateGroup(p, gd, g, { factoryId, floorId, x: 100, y: 0, rotationDeg: 0 });
    expect(p.buildings[inst[0]!]!.extraction?.nodeId).toBeNull();
    fac.syncGroupInstances(p, gd, g, 'none');
    const linked = Object.values(p.buildings).filter((b) => b.extraction?.nodeId === pureIron[0]!.id);
    expect(linked).toHaveLength(1);
  });
});

describe('Prüfregeln der Karte', () => {
  it('Miner auf dem Vorkommen: keine Fehler; nur Hinweis zum Gelände', () => {
    const { p } = minerFactory(pureIron[0]);
    expect(ids(p)).toEqual(['MAP-008']);
  });

  it('MAP-001: Vorkommen doppelt belegt', () => {
    const { p, factoryId, floorId, miner } = minerFactory(pureIron[0]);
    const second = fac.addBuilding(p, gd, { factoryId, type: 'Build_MinerMk1_C', placement: { floorId, x: 0, y: 0, zOffsetM: 0, rotationDeg: 0 } });
    p.buildings[second]!.extraction = { ...p.buildings[miner]!.extraction! };
    expect(ids(p)).toContain('MAP-001');
  });

  it('MAP-002: Fabrik verschoben, Miner steht neben dem Vorkommen', () => {
    const { p, factoryId } = minerFactory(pureIron[0]);
    mapOps.moveFactoryOnMap(p, factoryId, 40, 0);
    const f = checkMap(p, gd).find((x) => x.ruleId === 'MAP-002')!;
    expect(f.message).toMatch(/40 m/);
  });

  it('MAP-003: Reinheit passt nicht, MAP-004: unbekanntes Vorkommen', () => {
    const { p, miner } = minerFactory(pureIron[0]);
    p.buildings[miner]!.extraction!.purity = 'impure';
    expect(ids(p)).toContain('MAP-003');
    p.buildings[miner]!.extraction!.nodeId = 'BP_GibtEsNicht';
    expect(ids(p)).toContain('MAP-004');
  });

  it('MAP-005: Grundrisse überschneiden sich; MAP-006: außerhalb der Welt', () => {
    const p = newProject();
    const a = firstFactory(p).factory.id;
    const b = fac.addFactory(p, 'B');
    mapOps.setFactoryMap(p, a, { x: 0, y: 0, rotationDeg: 0 });
    mapOps.setFactoryMap(p, b, { x: 20, y: 0, rotationDeg: 45 });
    expect(ids(p)).toContain('MAP-005');
    mapOps.setFactoryMap(p, b, { x: 200, y: 0, rotationDeg: 0 });
    expect(ids(p)).not.toContain('MAP-005');
    mapOps.setFactoryMap(p, b, { x: 9000, y: 0, rotationDeg: 0 });
    expect(ids(p)).toContain('MAP-006');
  });

  it('MAP-007: nicht verknüpfter Miner über einem passenden freien Vorkommen', () => {
    const { p, factoryId } = minerFactory();
    mapOps.setFactoryMap(p, factoryId, { x: pureIron[1]!.x + 3, y: pureIron[1]!.y, rotationDeg: 0 });
    expect(ids(p)).toContain('MAP-007');
  });

  it('der Prüfmotor bezieht die Karte ein, sobald eine Fabrik platziert ist', () => {
    const { p } = minerFactory();
    const v = createValidator();
    expect(v(p, gd).findings.some((f) => f.domain === 'map')).toBe(false);
    const { p: q } = minerFactory(pureIron[0]);
    expect(v(q, gd).findings.some((f) => f.ruleId === 'MAP-008')).toBe(true);
  });
});

describe('Entfernungen für Transportaufträge', () => {
  function twoOnMap() {
    const p = newProject();
    const a = firstFactory(p).factory.id;
    const b = fac.addFactory(p, 'B');
    mapOps.setFactoryMap(p, a, { x: 0, y: 0, rotationDeg: 0 });
    mapOps.setFactoryMap(p, b, { x: 3000, y: 4000, rotationDeg: 0 });
    return { p, a, b };
  }
  const init = (a: string, b: string) => ({ name: '', itemId: 'Desc_OreIron_C', ratePerMin: 60, fromFactoryId: a, toFactoryId: b, fromStationId: null, toStationId: null, trainIds: [], roundTripEstimateS: null });

  it('Luftlinie zwischen den Fabrikmitten bzw. Drohnenhäfen; neue Aufträge übernehmen sie', () => {
    const { p, a, b } = twoOnMap();
    expect(orderMapDistance(p, gd, { fromFactoryId: a, toFactoryId: b, mode: 'drone', direct: null })).toMatchObject({ distM: 5000, basis: 'factories' });
    const pa = p.factories[a]!.floorIds[0]!;
    fac.addBuilding(p, gd, { factoryId: a, type: 'Build_DroneStation_C', placement: { floorId: pa, x: 0, y: -100, zOffsetM: 0, rotationDeg: 0 } });
    fac.addBuilding(p, gd, { factoryId: b, type: 'Build_DroneStation_C', placement: { floorId: p.factories[b]!.floorIds[0]!, x: 0, y: 0, zOffsetM: 0, rotationDeg: 0 } });
    const m = orderMapDistance(p, gd, { fromFactoryId: a, toFactoryId: b, mode: 'drone', direct: null })!;
    expect(m.basis).toBe('ports');
    const id = tops.addOrder(p, gd, { ...init(a, b), mode: 'drone' });
    expect(p.transportOrders[id]!.drone!.distanceM).toBe(Math.round(m.distM));
  });

  it('TRN-018: Strecke kürzer als die Luftlinie bzw. Drohne zu weit', () => {
    const { p, a, b } = twoOnMap();
    const v = tops.addOrder(p, gd, { ...init(a, b), mode: 'vehicle' });
    expect(checkTransport(p, gd).some((f) => f.ruleId === 'TRN-018')).toBe(false);
    tops.updateOrder(p, gd, v, { vehicle: { ...p.transportOrders[v]!.vehicle!, distanceM: 1000 } });
    expect(checkTransport(p, gd).find((f) => f.ruleId === 'TRN-018')?.message).toMatch(/kürzer/);
    tops.updateOrder(p, gd, v, { vehicle: { ...p.transportOrders[v]!.vehicle!, distanceM: 9000 } });
    expect(checkTransport(p, gd).some((f) => f.ruleId === 'TRN-018')).toBe(false);
    const d = tops.addOrder(p, gd, { ...init(a, b), mode: 'drone' });
    tops.updateOrder(p, gd, d, { drone: { ...p.transportOrders[d]!.drone!, distanceM: 9000 } });
    expect(checkTransport(p, gd).filter((f) => f.ruleId === 'TRN-018')).toHaveLength(1);
  });
});

describe('Standortvorschlag', () => {
  it('deckt 480 Eisenerz/min mit vier reinen Nodes (Miner Mk.1, 100 %) möglichst nah', () => {
    const s = suggestSites(gd, [{ itemId: 'Desc_OreIron_C', perMin: 480 }], { minerType: 'Build_MinerMk1_C', clock: 1, maxRadiusM: 3000 });
    expect(s.length).toBeGreaterThan(1);
    const best = s[0]!;
    expect(best.coverage).toBeCloseTo(1);
    expect(best.picks.reduce((a, x) => a + x.used, 0)).toBeCloseTo(480);
    expect(best.meanDistM).toBeLessThanOrEqual(s[1]!.meanDistM + 1e-6);
    // Vorschläge liegen auseinander
    expect(Math.hypot(best.center.x - s[1]!.center.x, best.center.y - s[1]!.center.y)).toBeGreaterThanOrEqual(400);
  });

  it('belegte Vorkommen werden ausgelassen; mehrere Rohstoffe, Teildeckung bei kleinem Radius', () => {
    const demand = [
      { itemId: 'Desc_OreIron_C', perMin: 240 },
      { itemId: 'Desc_Coal_C', perMin: 240 },
    ];
    const best = suggestSites(gd, demand, { minerType: 'Build_MinerMk2_C', clock: 1 })[0]!;
    expect(best.items.map((i) => i.itemId)).toEqual(['Desc_OreIron_C', 'Desc_Coal_C']);
    const taken = new Set(best.picks.map((x) => x.nodeId));
    const again = suggestSites(gd, demand, { minerType: 'Build_MinerMk2_C', clock: 1, used: taken })[0]!;
    expect(again.picks.some((x) => taken.has(x.nodeId))).toBe(false);
    const tiny = suggestSites(gd, [{ itemId: 'Desc_OreIron_C', perMin: 5000 }], { minerType: 'Build_MinerMk1_C', clock: 1, maxRadiusM: 300 })[0]!;
    expect(tiny.coverage).toBeLessThan(1);
  });

  it('Bedarf aus einem Produktionsplan (ohne Wasser und Importe); belegte Vorkommen anderer Fabriken', () => {
    const { p, factoryId } = minerFactory(pureIron[0]);
    const plan = prod.addPlan(p, factoryId, 'Platten');
    prod.updatePlan(p, gd, plan, { targets: [{ itemId: 'Desc_IronPlate_C', ratePerMin: 60 }] });
    expect(siteDemandFromPlan(p, gd, plan)).toEqual([{ itemId: 'Desc_OreIron_C', perMin: expect.closeTo(90, 6) }]);
    expect(usedNodes(p).has(pureIron[0]!.id)).toBe(true);
    expect(usedNodes(p, factoryId).has(pureIron[0]!.id)).toBe(false);
  });
});
