import { describe, expect, it } from 'vitest';
import { checkFactory } from '../src/factory/checks.ts';
import { computeFactoryFlow, sunkItems } from '../src/factory/flow.ts';
import { controlPoints, linkPath, pathLength, routePath, verticalSections } from '../src/factory/linkPath.ts';
import { machineRates } from '../src/production/machine.ts';
import { compareBalance } from '../src/production/balance.ts';
import { solveProduction } from '../src/production/solver.ts';
import * as ops from '../src/project/ops/factory.ts';
import * as prodOps from '../src/project/ops/production.ts';
import type { Project } from '../src/model/schema.ts';
import { firstFactory, gameData, newProject } from './helpers.ts';

const gd = gameData();
const rules = (fs: { ruleId: string }[]) => fs.map((f) => f.ruleId);

/** Kleine Fabrik mit Hilfsfunktionen; Gebäude stehen nebeneinander. */
function factory() {
  const p = newProject();
  const { factory: f, floorId } = firstFactory(p);
  let x = 0;
  const add = (type: string, extra: Partial<ops.NewBuilding> = {}) => {
    x += 30;
    return ops.addBuilding(p, gd, { factoryId: f.id, type, placement: { floorId, x, y: 0, zOffsetM: 0, rotationDeg: 0 }, ...extra });
  };
  const belt = (from: string, fromPort: string, to: string, toPort: string, tier = 'Build_ConveyorBeltMk1_C') =>
    ops.addLink(p, gd, { kind: 'belt', tier, from: { buildingId: from, portId: fromPort }, to: { buildingId: to, portId: toPort } });
  return { p, f, floorId, add, belt };
}

const miner = (purity: 'impure' | 'normal' | 'pure' = 'normal', type = 'Build_MinerMk1_C') => ({
  extraction: { itemId: 'Desc_OreIron_C', purity },
  type,
});

describe('Gewinnung', () => {
  it('Förderraten aus Docs-Zykluszeit, Reinheit und Takt', () => {
    const rate = (type: string, purity: 'impure' | 'normal' | 'pure', clock: number, itemId = 'Desc_OreIron_C') =>
      machineRates(gd, { type, recipeId: null, clock, somersloops: 0, extraction: { itemId, purity } }).outputs[0]!.perMin;
    expect(rate('Build_MinerMk1_C', 'normal', 1)).toBeCloseTo(60);
    expect(rate('Build_MinerMk1_C', 'impure', 1)).toBeCloseTo(30);
    expect(rate('Build_MinerMk2_C', 'pure', 1)).toBeCloseTo(240);
    expect(rate('Build_MinerMk3_C', 'pure', 2.5)).toBeCloseTo(1200);
    // Wasserextraktor: 2000 l je Sekunde = 120 m³/min, Reinheit ohne Wirkung
    expect(rate('Build_WaterPump_C', 'pure', 1, 'Desc_Water_C')).toBeCloseTo(120);
    expect(rate('Build_OilPump_C', 'impure', 1, 'Desc_LiquidOil_C')).toBeCloseTo(60);
  });

  it('Wasserextraktor erhält Wasser automatisch; falsche Rohstoffe werden abgelehnt', () => {
    const { p, add } = factory();
    const w = add('Build_WaterPump_C');
    expect(p.buildings[w]!.extraction).toEqual({ itemId: 'Desc_Water_C', purity: 'normal' });
    const m = add('Build_MinerMk1_C');
    expect(() => ops.updateBuildings(p, gd, [m], { extraction: { itemId: 'Desc_Water_C', purity: 'normal' } })).toThrow(/nicht fördern/);
    ops.updateBuildings(p, gd, [m], { extraction: { itemId: 'Desc_OreCopper_C', purity: 'pure' } });
    expect(p.buildings[m]!.extraction!.itemId).toBe('Desc_OreCopper_C');
  });
});

describe('Durchsatzmodell', () => {
  it('Kette Miner → Splitter → 2 Schmelzöfen → Zusammenführung → Konstruktor: alles voll ausgelastet', () => {
    const { p, f, add, belt } = factory();
    const m = add('Build_MinerMk1_C', miner());
    const sp = add('Build_ConveyorAttachmentSplitter_C');
    const s1 = add('Build_SmelterMk1_C', { recipeId: 'Recipe_IngotIron_C' });
    const s2 = add('Build_SmelterMk1_C', { recipeId: 'Recipe_IngotIron_C' });
    const mg = add('Build_ConveyorAttachmentMerger_C');
    const c1 = add('Build_ConstructorMk1_C', { recipeId: 'Recipe_IronPlate_C' });
    const c2 = add('Build_ConstructorMk1_C', { recipeId: 'Recipe_IronPlate_C' });
    const sink = add('Build_ResourceSink_C');
    const feed = belt(m, 'belt-out-0', sp, 'belt-in-0');
    belt(sp, 'belt-out-0', s1, 'belt-in-0');
    belt(sp, 'belt-out-1', s2, 'belt-in-0');
    belt(s1, 'belt-out-0', mg, 'belt-in-0');
    belt(s2, 'belt-out-0', mg, 'belt-in-1');
    // Zusammenführung → Splitter für zwei Konstruktoren
    const sp2 = add('Build_ConveyorAttachmentSplitter_C');
    const ingots = belt(mg, 'belt-out-0', sp2, 'belt-in-0');
    belt(sp2, 'belt-out-0', c1, 'belt-in-0');
    belt(sp2, 'belt-out-1', c2, 'belt-in-0');
    const mg2 = add('Build_ConveyorAttachmentMerger_C');
    belt(c1, 'belt-out-0', mg2, 'belt-in-0');
    belt(c2, 'belt-out-0', mg2, 'belt-in-1');
    belt(mg2, 'belt-out-0', sink, 'belt-in-0');

    const flow = computeFactoryFlow(p, gd, f.id);
    expect(flow.status).toBe('ok');
    for (const id of [m, s1, s2, c1, c2]) expect(flow.machines.get(id)!.utilization).toBeCloseTo(1);
    expect(flow.links.get(feed)!.total).toBeCloseTo(60);
    expect(flow.links.get(feed)!.items).toEqual([{ itemId: 'Desc_OreIron_C', perMin: expect.closeTo(60) }]);
    expect(flow.links.get(ingots)!.total).toBeCloseTo(60);
    const fs = checkFactory(p, gd, f.id);
    expect(rules(fs)).not.toContain('FAB-011');
    expect(rules(fs)).not.toContain('FAB-012');
    expect(rules(fs)).not.toContain('FAB-013');
  });

  it('Schredder: Zufluss gilt als Überschuss (FAB-020, Hinweis) statt als Fehler', () => {
    const { p, f, add, belt } = factory();
    const m = add('Build_MinerMk1_C', miner());
    const s1 = add('Build_SmelterMk1_C', { recipeId: 'Recipe_IngotIron_C' });
    const sink = add('Build_ResourceSink_C');
    belt(m, 'belt-out-0', s1, 'belt-in-0');
    belt(s1, 'belt-out-0', sink, 'belt-in-0');
    const flow = computeFactoryFlow(p, gd, f.id);
    expect(flow.sinks.get(sink)).toEqual([{ itemId: 'Desc_IronIngot_C', perMin: expect.closeTo(30) }]);
    expect(sunkItems(flow).get('Desc_IronIngot_C')).toBeCloseTo(30);
    const fs = checkFactory(p, gd, f.id);
    const hint = fs.find((x) => x.ruleId === 'FAB-020')!;
    expect(hint.severity).toBe('info');
    expect(hint.objects).toEqual([{ table: 'buildings', id: sink }]);
    expect(rules(fs)).not.toContain('FAB-013');
  });

  it('Band zu klein: theoretisch 120/min, Mk.1 schafft 60 → Befund FAB-011 und Auslastung 50 %', () => {
    const { p, f, add, belt } = factory();
    const m = add('Build_MinerMk2_C', miner('normal', 'Build_MinerMk2_C'));
    const sink = add('Build_ResourceSink_C');
    const l = belt(m, 'belt-out-0', sink, 'belt-in-0');
    const flow = computeFactoryFlow(p, gd, f.id);
    expect(flow.links.get(l)!.required).toBeCloseTo(120);
    expect(flow.links.get(l)!.total).toBeCloseTo(60);
    expect(flow.machines.get(m)!.utilization).toBeCloseTo(0.5);
    expect(flow.machines.get(m)!.utilizationUncapped).toBeCloseTo(1);
    const fs = checkFactory(p, gd, f.id);
    const over = fs.find((x) => x.ruleId === 'FAB-011')!;
    expect(over.objects).toEqual([{ table: 'links', id: l }]);
    expect(over.message).toMatch(/120/);
    expect(rules(fs)).toContain('FAB-012');
    // Höhere Stufe behebt den Engpass
    ops.updateLink(p, gd, l, { tier: 'Build_ConveyorBeltMk2_C' });
    expect(rules(checkFactory(p, gd, f.id))).not.toContain('FAB-011');
  });

  it('Nicht abgeführtes Produkt hält die Maschine an (FAB-013)', () => {
    const { p, f, add, belt } = factory();
    const m = add('Build_MinerMk1_C', miner('impure'));
    const s = add('Build_SmelterMk1_C', { recipeId: 'Recipe_IngotIron_C' });
    belt(m, 'belt-out-0', s, 'belt-in-0');
    const flow = computeFactoryFlow(p, gd, f.id);
    expect(flow.machines.get(s)!.utilization).toBe(0);
    expect(flow.machines.get(s)!.issues).toContainEqual({ kind: 'output-blocked', itemId: 'Desc_IronIngot_C', portId: 'belt-out-0' });
    expect(rules(checkFactory(p, gd, f.id))).toContain('FAB-013');
  });

  it('Falscher Gegenstand am Eingang (FAB-014) und fehlende Zutat (FAB-012)', () => {
    const { p, f, add, belt } = factory();
    const m = add('Build_MinerMk1_C', miner());
    const c = add('Build_ConstructorMk1_C', { recipeId: 'Recipe_IronPlate_C' });
    const l = belt(m, 'belt-out-0', c, 'belt-in-0');
    const flow = computeFactoryFlow(p, gd, f.id);
    expect(flow.links.get(l)!.rejectedItems).toEqual(['Desc_OreIron_C']);
    expect(flow.machines.get(c)!.issues).toContainEqual({ kind: 'input-missing', itemId: 'Desc_IronIngot_C' });
    const fs = checkFactory(p, gd, f.id);
    expect(rules(fs)).toContain('FAB-014');
    expect(rules(fs)).toContain('FAB-012');
  });

  it('Unterversorgung durch zu geringe Zulieferung wird mit Prozentwert gemeldet', () => {
    const { p, f, add, belt } = factory();
    const m = add('Build_MinerMk1_C', miner('impure')); // 30 Erz
    const sp = add('Build_ConveyorAttachmentSplitter_C');
    const s1 = add('Build_SmelterMk1_C', { recipeId: 'Recipe_IngotIron_C' });
    const s2 = add('Build_SmelterMk1_C', { recipeId: 'Recipe_IngotIron_C' });
    const sink = add('Build_ResourceSink_C');
    const mg = add('Build_ConveyorAttachmentMerger_C');
    belt(m, 'belt-out-0', sp, 'belt-in-0');
    belt(sp, 'belt-out-0', s1, 'belt-in-0');
    belt(sp, 'belt-out-1', s2, 'belt-in-0');
    belt(s1, 'belt-out-0', mg, 'belt-in-0');
    belt(s2, 'belt-out-0', mg, 'belt-in-1');
    belt(mg, 'belt-out-0', sink, 'belt-in-0');
    const flow = computeFactoryFlow(p, gd, f.id);
    const total = flow.machines.get(s1)!.utilization + flow.machines.get(s2)!.utilization;
    expect(total).toBeCloseTo(1); // zusammen nur 30 von 60 Erz
    const under = checkFactory(p, gd, f.id).filter((x) => x.ruleId === 'FAB-012');
    expect(under.length).toBeGreaterThan(0);
  });

  it('Entladende Frachtplattform liefert die Menge des Transportauftrags', () => {
    const { p, f, add, belt } = factory();
    const other = ops.addFactory(p, 'Mine');
    const pf = add('Build_TrainDockingStation_C');
    expect(p.buildings[pf]!.transfer).toEqual({ mode: 'unload', stationId: null });
    const s = add('Build_SmelterMk1_C', { recipeId: 'Recipe_IngotIron_C' });
    const sink = add('Build_ResourceSink_C');
    belt(pf, 'belt-out-0', s, 'belt-in-0');
    belt(s, 'belt-out-0', sink, 'belt-in-0');
    p.transportOrders.o1 = { id: 'o1', name: 'Erz', itemId: 'Desc_OreIron_C', ratePerMin: 15, fromFactoryId: other, toFactoryId: f.id, mode: 'train', fromStationId: null, toStationId: null, trainIds: [], roundTripEstimateS: null, vehicle: null, drone: null, direct: null };
    const flow = computeFactoryFlow(p, gd, f.id);
    expect(flow.machines.get(s)!.utilization).toBeCloseTo(0.5);
    expect(flow.platforms.get(pf)!.items).toEqual([{ itemId: 'Desc_OreIron_C', perMin: expect.closeTo(15) }]);
  });
});

describe('Verlauf von Förderbändern', () => {
  function linked(routing: 'direct' | 'straight' | 'curved', waypoints = [{ x: 20, y: 30, z: 1 }]) {
    const { p, f, add } = factory();
    const a = add('Build_SmelterMk1_C', { recipeId: 'Recipe_IngotIron_C' });
    const b = add('Build_ConstructorMk1_C', { recipeId: 'Recipe_IronPlate_C' });
    p.buildings[b]!.placement!.y = 40;
    const id = ops.addLink(p, gd, { kind: 'belt', tier: 'Build_ConveyorBeltMk1_C', from: { buildingId: a, portId: 'belt-out-0' }, to: { buildingId: b, portId: 'belt-in-0' }, waypoints, routing });
    return { p, f, link: p.links[id]! };
  }

  it('rechtwinklig: alle Abschnitte achsparallel, Anfang und Ende an den Anschlüssen', () => {
    const { p, link } = linked('straight');
    const path = linkPath(p, gd, link)!;
    for (let i = 1; i < path.length; i++) {
      const a = path[i - 1]!;
      const b = path[i]!;
      expect(Math.abs(a.x - b.x) < 1e-6 || Math.abs(a.y - b.y) < 1e-6).toBe(true);
    }
    const direct = linkPath(p, gd, { ...link, routing: 'direct' })!;
    expect(path[0]).toEqual(direct[0]);
    expect(path.at(-1)).toEqual(direct.at(-1));
    expect(pathLength(path).total).toBeGreaterThanOrEqual(pathLength(direct).total - 1e-9);
  });

  it('Kurve: geht durch die Zwischenpunkte und ist feiner abgetastet', () => {
    const { p, link } = linked('curved');
    const path = linkPath(p, gd, link)!;
    expect(path.length).toBeGreaterThan(10);
    expect(path.some((q) => Math.hypot(q.x - 20, q.y - 30) < 1e-6)).toBe(true);
  });

  it('Lifte bleiben in allen Modi senkrecht', () => {
    const ctrl = [
      { x: 0, y: 0, z: 1 },
      { x: 0, y: 1, z: 1 },
      { x: 5, y: 8, z: 1 },
      { x: 5, y: 8, z: 13 },
      { x: 12, y: 3, z: 13 },
      { x: 12, y: 2, z: 13 },
    ];
    for (const r of ['direct', 'straight', 'curved'] as const) {
      const v = verticalSections(routePath(ctrl, r));
      expect(v).toHaveLength(1);
      expect(v[0]).toMatchObject({ at: { x: 5, y: 8 }, z0: 1, z1: 13 });
    }
  });

  it('Steuerpunkte enthalten Anschluss und Austrittspunkt', () => {
    const { p, link } = linked('direct', []);
    const a = p.buildings[link.from.buildingId]!;
    expect(a).toBeDefined();
    const path = linkPath(p, gd, link)!;
    expect(path.length).toBe(4);
    expect(controlPoints).toBeTypeOf('function');
  });
});

describe('Lifte und Höhen', () => {
  it('Lift durch ein Stockwerk und Rohrsteigung werden als Hinweis gemeldet', () => {
    const { p, f, floorId, add } = factory();
    const upper = ops.addFloor(p, f.id, { elevationM: 8 });
    const top = ops.addFloor(p, f.id, { elevationM: 16 });
    const a = add('Build_SmelterMk1_C', { recipeId: 'Recipe_IngotIron_C' });
    const b = ops.addBuilding(p, gd, { factoryId: f.id, type: 'Build_ConstructorMk1_C', recipeId: 'Recipe_IronPlate_C', placement: { floorId: top, x: 0, y: 40, zOffsetM: 0, rotationDeg: 0 } });
    ops.addLink(p, gd, {
      kind: 'belt',
      tier: 'Build_ConveyorBeltMk1_C',
      from: { buildingId: a, portId: 'belt-out-0' },
      to: { buildingId: b, portId: 'belt-in-0' },
      waypoints: [
        { x: 10, y: 20, z: 1 },
        { x: 10, y: 20, z: 17 },
      ],
    });
    void upper;
    void floorId;
    const fs = checkFactory(p, gd, f.id);
    const lift = fs.find((x) => x.ruleId === 'FAB-017')!;
    expect(lift.message).toMatch(/Ebene 2/);
    expect(rules(fs)).not.toContain('FAB-018');
  });
});

describe('Gebäudegruppen bearbeiten', () => {
  it('Vorlage aus geänderter Instanz übernehmen und auf andere Instanzen übertragen', () => {
    const { p, f, floorId, add } = factory();
    const a = add('Build_ConstructorMk1_C', { recipeId: 'Recipe_IronPlate_C' });
    const b = add('Build_ConstructorMk1_C', { recipeId: 'Recipe_IronPlate_C' });
    const gid = ops.createGroupFromBuildings(p, [a, b], 'Platten');
    const inst1 = p.buildings[a]!.groupInstance!.instanceId;
    const ids2 = ops.instantiateGroup(p, gd, gid, { factoryId: f.id, floorId, x: 200, y: 100, rotationDeg: 90 });
    const inst2 = p.buildings[ids2[0]!]!.groupInstance!.instanceId;
    const before = ids2.map((id) => ({ ...p.buildings[id]!.placement! }));
    // Instanz 1 ändern: Rezept tauschen
    ops.updateBuildings(p, gd, [a], { recipeId: 'Recipe_IronRod_C' });
    ops.updateGroupFromInstance(p, gid, inst1);
    expect(p.groups[gid]!.members.map((m) => m.recipeId).sort()).toEqual(['Recipe_IronPlate_C', 'Recipe_IronRod_C']);
    const r = ops.syncGroupInstances(p, gd, gid, inst1);
    expect(r.instances).toBe(1);
    const now = Object.values(p.buildings).filter((x) => x.groupInstance?.instanceId === inst2);
    expect(now.map((x) => x.recipeId).sort()).toEqual(['Recipe_IronPlate_C', 'Recipe_IronRod_C']);
    // Lage der zweiten Instanz bleibt erhalten
    const pos = now.map((x) => x.placement!).sort((u, v) => u.x - v.x || u.y - v.y);
    const old = [...before].sort((u, v) => u.x - v.x || u.y - v.y);
    pos.forEach((q, i) => {
      expect(q.x).toBeCloseTo(old[i]!.x);
      expect(q.y).toBeCloseTo(old[i]!.y);
      expect(q.rotationDeg).toBeCloseTo(old[i]!.rotationDeg);
    });
    ops.detachInstance(p, inst2);
    expect(now.every((x) => p.buildings[x.id]!.groupInstance === null)).toBe(true);
  });
});

describe('Abgleich Produktionsplan ↔ Grundriss', () => {
  function plan(p: Project, factoryId: string) {
    const id = prodOps.addPlan(p, factoryId, 'Platten');
    prodOps.updatePlan(p, gd, id, { targets: [{ itemId: 'Desc_IronPlate_C', ratePerMin: 20 }] });
    return p.productionPlans[id]!;
  }

  it('Soll → angelegt → platziert → angeschlossen → Durchsatz über dieselben Gebäude', () => {
    const { p, f, floorId } = factory();
    const pl = plan(p, f.id);
    const res = solveProduction(gd, pl);
    prodOps.materializePlan(p, gd, f.id, res.recipes.map((r) => ({ recipeId: r.recipeId, machines: r.machines })), { adjustClocks: true });
    let cmp = compareBalance(p, gd, f.id, res);
    const plate = () => cmp.recipes.find((r) => r.recipeId === 'Recipe_IronPlate_C')!;
    expect(plate().geplant).toBeCloseTo(1);
    expect(plate().platziert).toBe(0);
    // Platzieren
    const ctor = Object.values(p.buildings).find((b) => b.recipeId === 'Recipe_IronPlate_C')!;
    const smelter = Object.values(p.buildings).find((b) => b.recipeId === 'Recipe_IngotIron_C')!;
    ops.placeBuilding(p, ctor.id, { floorId, x: 0, y: 40, zOffsetM: 0, rotationDeg: 0 });
    ops.placeBuilding(p, smelter.id, { floorId, x: 0, y: 0, zOffsetM: 0, rotationDeg: 0 });
    cmp = compareBalance(p, gd, f.id, res);
    expect(plate().platziert).toBeCloseTo(1);
    expect(plate().angeschlossen).toBe(0);
    expect(plate().durchsatz).toBe(0);
    // Anschließen: Miner → Schmelzofen → Konstruktor → Schredder
    const m = ops.addBuilding(p, gd, { factoryId: f.id, type: 'Build_MinerMk1_C', extraction: { itemId: 'Desc_OreIron_C', purity: 'impure' }, placement: { floorId, x: -40, y: 0, zOffsetM: 0, rotationDeg: 0 } });
    const sink = ops.addBuilding(p, gd, { factoryId: f.id, type: 'Build_ResourceSink_C', placement: { floorId, x: 40, y: 60, zOffsetM: 0, rotationDeg: 0 } });
    const link = (a: string, ap: string, b: string, bp: string) => ops.addLink(p, gd, { kind: 'belt', tier: 'Build_ConveyorBeltMk1_C', from: { buildingId: a, portId: ap }, to: { buildingId: b, portId: bp } });
    link(m, 'belt-out-0', smelter.id, 'belt-in-0');
    link(smelter.id, 'belt-out-0', ctor.id, 'belt-in-0');
    link(ctor.id, 'belt-out-0', sink, 'belt-in-0');
    cmp = compareBalance(p, gd, f.id, res);
    expect(plate().angeschlossen).toBeCloseTo(1);
    expect(plate().durchsatz).toBeCloseTo(1);
    const plates = cmp.items.find((i) => i.itemId === 'Desc_IronPlate_C')!;
    expect(plates.durchsatz).toBeCloseTo(20);
  });
});
