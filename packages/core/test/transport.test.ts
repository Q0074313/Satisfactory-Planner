import { describe, expect, it } from 'vitest';
import * as rail from '../src/project/ops/rail.ts';
import * as ops from '../src/project/ops/factory.ts';
import * as tOps from '../src/project/ops/transport.ts';
import * as prodOps from '../src/project/ops/production.ts';
import { estimateOrder, estimateTrainCycle, factoryTrade, trainCapacity } from '../src/transport/estimate.ts';
import { checkTransport } from '../src/transport/checks.ts';
import { applyGameDataMigration, planGameDataMigration } from '../src/project/gamedataMigration.ts';
import { createGameDataIndex, type GameData } from '../src/gamedata/index.ts';
import { clone } from '../src/model/clone.ts';
import { firstFactory, gameData, newProject } from './helpers.ts';

const gd = gameData();
const rules = (fs: { ruleId: string }[]) => fs.map((f) => f.ruleId);
const pt = (x: number, y: number) => ({ kind: 'point' as const, position: { x, y, z: 0 } });
const node = (nodeId: string) => ({ kind: 'node' as const, nodeId });

/** Zwei Fabriken, Rundkurs mit je einem Bahnhof, ein Zug mit 2 Güterwagen. */
function scenario() {
  const p = newProject();
  const { factory: mine } = firstFactory(p);
  const smelt = ops.addFactory(p, 'Hütte');
  const net = rail.addNetwork(p, 'Netz');
  const pf = [
    { type: 'freight' as const, mode: 'load' as const, flipped: false },
    { type: 'freight' as const, mode: 'load' as const, flipped: false },
  ];
  const s1 = rail.addStation(p, { networkId: net, name: 'Mine', position: { x: 0, y: 0, z: 0 }, headingDeg: 0, platforms: pf, factoryId: mine.id });
  const S1 = p.stations[s1]!;
  const x = rail.addTrack(p, net, node(S1.frontNodeId), pt(108, 60)).toNodeId;
  const y = rail.addTrack(p, net, node(x), pt(48, 120)).toNodeId;
  const s2 = rail.addStation(p, { networkId: net, name: 'Hütte', position: { x: 0, y: 0, z: 0 }, headingDeg: 0, backNodeId: y, platforms: pf, factoryId: smelt });
  const S2 = p.stations[s2]!;
  const w = rail.addTrack(p, net, node(S2.frontNodeId), pt(-60, 60)).toNodeId;
  rail.addTrack(p, net, node(w), node(S1.backNodeId));
  const tt = rail.addTimetable(p, net, 'Pendel', [s1, s2]);
  const train = rail.addTrain(p, net, 'Erzzug', [
    { kind: 'locomotive', reversed: false },
    { kind: 'wagon', cargo: 'solid' },
    { kind: 'wagon', cargo: 'solid' },
  ]);
  rail.updateTrain(p, train, { timetableId: tt });
  return { p, mine: mine.id, smelt, s1, s2, train, net };
}

describe('Transportplanung', () => {
  it('Zugkapazität aus Wagen, 32 Stapeln und Stapelgröße bzw. 2400 m³', () => {
    const { p, train } = scenario();
    const t = p.trains[train]!;
    expect(trainCapacity(gd, t, 'Desc_OreIron_C')).toBe(2 * 32 * gd.item('Desc_OreIron_C')!.stackSize);
    expect(trainCapacity(gd, t, 'Desc_Water_C')).toBe(0);
    expect(trainCapacity(gd, { ...t, consist: [...t.consist, { kind: 'wagon', cargo: 'liquid' }] }, 'Desc_Water_C')).toBe(2400);
  });

  it('Umlaufzeit = Strecke / Geschwindigkeit + Umschlag je Halt; Durchsatz je Minute', () => {
    const { p, mine, smelt, s1, s2, train } = scenario();
    const cyc = estimateTrainCycle(p, gd, train);
    expect(cyc.complete).toBe(true);
    const v = (p.settings.simulation.trainAverageSpeedKmh * 1000) / 3600;
    expect(cyc.cycleS!).toBeCloseTo(cyc.lengthM / v + 2 * 27.08, 6);
    const id = tOps.addOrder(p, gd, { name: 'Erz', itemId: 'Desc_OreIron_C', ratePerMin: 100, fromFactoryId: mine, toFactoryId: smelt, fromStationId: s1, toStationId: s2, trainIds: [train], roundTripEstimateS: null });
    const est = estimateOrder(p, gd, p.transportOrders[id]!);
    const cap = trainCapacity(gd, p.trains[train]!, 'Desc_OreIron_C');
    expect(est.perMin).toBeCloseTo((cap * 60) / cyc.cycleS!, 6);
    expect(est.trains[0]!.cycleSource).toBe('estimate');
    // Manuelle Umlaufzeit ersetzt die Schätzung
    tOps.updateOrder(p, gd, id, { roundTripEstimateS: 600 });
    expect(estimateOrder(p, gd, p.transportOrders[id]!).perMin).toBeCloseTo((cap * 60) / 600, 6);
  });

  it('Befunde: kein Zug, falscher Wagen, Kapazität, Bahnhof der falschen Fabrik, fehlende Plattform', () => {
    const { p, mine, smelt, s1, s2, train } = scenario();
    const a = tOps.addOrder(p, gd, { name: 'Wasser', itemId: 'Desc_Water_C', ratePerMin: 50, fromFactoryId: mine, toFactoryId: smelt, fromStationId: s1, toStationId: s2, trainIds: [], roundTripEstimateS: null });
    let fs = checkTransport(p, gd);
    expect(rules(fs)).toContain('TRN-001');
    expect(rules(fs)).toContain('TRN-009');
    tOps.updateOrder(p, gd, a, { trainIds: [train] });
    fs = checkTransport(p, gd);
    expect(rules(fs)).toContain('TRN-007');
    expect(rules(fs)).toContain('TRN-003');
    expect(rules(fs)).toContain('TRN-008');
    // Bahnhof gehört zur falschen Fabrik
    tOps.updateOrder(p, gd, a, { fromStationId: s2, toStationId: s1 });
    expect(rules(checkTransport(p, gd))).toContain('TRN-004');
  });

  it('Importbedarf eines Produktionsplans ohne Auftrag und Lieferfabrik ohne Überschuss', () => {
    const { p, mine, smelt } = scenario();
    const plan = prodOps.addPlan(p, smelt, 'Barren');
    prodOps.updatePlan(p, gd, plan, {
      targets: [{ itemId: 'Desc_IronIngot_C', ratePerMin: 30 }],
      supplies: [{ itemId: 'Desc_OreIron_C', maxPerMin: null, origin: 'import' }],
    });
    let trade = factoryTrade(p, gd, smelt).find((r) => r.itemId === 'Desc_OreIron_C')!;
    expect(trade.planImports).toBeCloseTo(30);
    expect(trade.importGap).toBeCloseTo(30);
    expect(rules(checkTransport(p, gd))).toEqual(['TRN-005']); // Importbedarf ohne jeden Auftrag
    tOps.addOrder(p, gd, { name: 'Erz', itemId: 'Desc_OreIron_C', ratePerMin: 20, fromFactoryId: mine, toFactoryId: smelt, fromStationId: null, toStationId: null, trainIds: [], roundTripEstimateS: null });
    const fs = checkTransport(p, gd);
    expect(rules(fs)).toContain('TRN-005');
    expect(rules(fs)).toContain('TRN-006'); // Mine hat keine Maschinen
    // Miner in der Mine deckt die Ausfuhr
    const { floorId } = firstFactory(p);
    ops.addBuilding(p, gd, { factoryId: mine, type: 'Build_MinerMk1_C', extraction: { itemId: 'Desc_OreIron_C', purity: 'normal' }, placement: { floorId, x: 0, y: 0, zOffsetM: 0, rotationDeg: 0 } });
    trade = factoryTrade(p, gd, mine).find((r) => r.itemId === 'Desc_OreIron_C')!;
    expect(trade.net).toBeCloseTo(60);
    expect(trade.exportGap).toBe(0);
    expect(rules(checkTransport(p, gd))).not.toContain('TRN-006');
  });

  it('Auftragsprüfung lehnt gleiche Fabrik und negative Mengen ab', () => {
    const { p, mine } = scenario();
    expect(() => tOps.addOrder(p, gd, { name: 'x', itemId: 'Desc_OreIron_C', ratePerMin: 1, fromFactoryId: mine, toFactoryId: mine, fromStationId: null, toStationId: null, trainIds: [], roundTripEstimateS: null })).toThrow(/verschiedene Fabriken/);
  });
});

describe('Spieldatensatz wechseln', () => {
  it('Trockenlauf meldet fehlende IDs, Anwenden benennt um und entfernt Unbekanntes', () => {
    const p = newProject();
    const { factory, floorId } = firstFactory(p);
    const b = ops.addBuilding(p, gd, { factoryId: factory.id, type: 'Build_ConstructorMk1_C', recipeId: 'Recipe_IronPlate_C', placement: { floorId, x: 0, y: 0, zOffsetM: 0, rotationDeg: 0 } });
    const plan = prodOps.addPlan(p, factory.id, 'P');
    prodOps.updatePlan(p, gd, plan, { targets: [{ itemId: 'Desc_IronPlate_C', ratePerMin: 10 }, { itemId: 'Desc_IronRod_C', ratePerMin: 5 }] });
    // Zieldatensatz: Eisenstab fehlt, Platten-Rezept umbenannt
    const raw = clone(gd.data) as GameData;
    raw.meta.datasetId = 'sf-test';
    raw.meta.gameVersion = '9.9';
    delete raw.items['Desc_IronRod_C'];
    raw.recipes['Recipe_IronPlate_NEU'] = { ...raw.recipes['Recipe_IronPlate_C']!, id: 'Recipe_IronPlate_NEU' };
    delete raw.recipes['Recipe_IronPlate_C'];
    const to = createGameDataIndex(raw);
    const report = planGameDataMigration(p, to, { recipes: { Recipe_IronPlate_C: 'Recipe_IronPlate_NEU' } });
    expect(report.missingItems.map((x) => x.id)).toEqual(['Desc_IronRod_C']);
    expect(report.renamed).toContainEqual({ kind: 'recipe', from: 'Recipe_IronPlate_C', to: 'Recipe_IronPlate_NEU', count: 1 });
    const changes = applyGameDataMigration(p, to, { recipes: { Recipe_IronPlate_C: 'Recipe_IronPlate_NEU' } });
    expect(p.buildings[b]!.recipeId).toBe('Recipe_IronPlate_NEU');
    expect(p.productionPlans[plan]!.targets.map((t) => t.itemId)).toEqual(['Desc_IronPlate_C']);
    expect(p.gameData).toEqual({ datasetId: 'sf-test', gameVersion: '9.9' });
    expect(changes.length).toBeGreaterThan(0);
  });
});
