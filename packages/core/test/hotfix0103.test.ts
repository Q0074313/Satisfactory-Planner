/**
 * Hotfix 0.10.3: Spielstand-Import und Durchsatzmodell – Logistikebenen mit
 * Lagern, Bahnhöfe an Gewinnungsposten über lange Bänder, Transportaufträge
 * über Fabrikgrenzen und Stationen hinweg, gleichmäßig verteilte Gewinnung,
 * Ausfuhr aus Stationen, Reihenfolge der Fabriken.
 */
import { describe, expect, it } from 'vitest';
import { computeFactoryFlow } from '../src/factory/flow.ts';
import { groupSave, projectFromSave } from '../src/import/fromSave.ts';
import type { SaveBuilding, SaveExtract, SaveRef } from '../src/import/saveTypes.ts';
import * as facOps from '../src/project/ops/factory.ts';
import { addOrder } from '../src/project/ops/transport.ts';
import { firstFactory, gameData, newProject } from './helpers.ts';
import { fixture } from './saveFixture.ts';

const gd = gameData();
const BASE = { name: 'Import', datasetId: gd.data.meta.datasetId, gameVersion: gd.data.meta.gameVersion, rail: false, plans: false };

/** Gebäude nach dem Muster des Konstruktors (Lage, Höhe) mit neuen Angaben; `first`: vorn in der Liste. */
function add(ex: SaveExtract, b: Partial<SaveBuilding> & Pick<SaveBuilding, 'id' | 'type' | 'x' | 'y'>, first = false): SaveBuilding {
  const base = ex.buildings.find((x) => x.id === 'Constructor')!;
  const nb: SaveBuilding = { ...base, recipe: null, conns: {}, platformConns: {}, node: null, loadMode: null, ...b };
  if (first) ex.buildings.unshift(nb);
  else ex.buildings.push(nb);
  return nb;
}
/** Gerades Band von Anschluss `from` zu Anschluss `to` (beide Gebäude zeigen darauf). */
function belt(ex: SaveExtract, id: string, from: SaveRef, to: SaveRef) {
  const a = ex.buildings.find((x) => x.id === from.id)!;
  const b = ex.buildings.find((x) => x.id === to.id)!;
  const points = [
    { x: a.x, y: a.y, z: a.z + 1 },
    { x: b.x, y: b.y, z: b.z + 1 },
  ];
  ex.conveyors.push({ id, type: 'Build_ConveyorBeltMk2_C', kind: 'belt', lift: false, points, conns: [from, to], ends: [points[0]!, points[1]!] });
  a.conns[from.comp] = { id, comp: 'ConveyorAny0' };
  b.conns[to.comp] = { id, comp: 'ConveyorAny1' };
}
const groupOf = (ex: SaveExtract, id: string) => groupSave(ex, gd).groups.find((g) => g.buildingIds.includes(id));

describe('Hotfix 0.10.3: Logistikebene mit Lagern', () => {
  it('Lager auf der Logistikebene bilden keine eigene Ebene; die Maschinen 10 m darüber werden ein eigenes Stockwerk', () => {
    const ex = fixture();
    const o = ex.buildings.find((b) => b.id === 'Miner')!;
    const x0 = o.x + 600;
    const Z = o.z;
    const ids: string[] = [];
    // Logistikebene: Fundamente (Oberkante Z), 12 Splitter 1 m darüber, 2 Lager
    ex.foundations = [];
    for (let i = 0; i < 4; i++) {
      ex.foundations.push({ type: 'Build_Foundation_8x1_01_C', x: x0 + i * 8, y: o.y, z: Z - 0.5, yawDeg: 0 });
      ex.foundations.push({ type: 'Build_Foundation_8x1_01_C', x: x0 + i * 8, y: o.y, z: Z + 9.5, yawDeg: 0 });
    }
    for (let i = 0; i < 12; i++) ids.push(add(ex, { id: `Sp${i}`, type: 'Build_ConveyorAttachmentSplitter_C', x: x0 + i * 2, y: o.y, z: Z + 1 }).id);
    for (let i = 0; i < 2; i++) ids.push(add(ex, { id: `Box${i}`, type: 'Build_StorageContainerMk1_C', x: x0 + i * 6, y: o.y, z: Z }).id);
    // Maschinen auf der Ebene darüber
    for (let i = 0; i < 3; i++) ids.push(add(ex, { id: `C${i}`, type: 'Build_ConstructorMk1_C', x: x0 + i * 10, y: o.y, z: Z + 10, recipe: 'Recipe_IronPlate_C' }).id);
    const { project: p } = projectFromSave(ex, gd, { ...BASE, groups: [{ name: 'Alu', buildingIds: ids }] });
    const f = Object.values(p.factories)[0]!;
    const floors = f.floorIds.map((id) => p.floors[id]!);
    expect(floors.map((x) => x.kind)).toEqual(['logistics', 'production']);
    expect(floors[0]!.elevationM).toBeCloseTo(Z, 0);
    expect(floors[1]!.elevationM).toBeCloseTo(Z + 10, 0);
    const box = Object.values(p.buildings).find((b) => b.type === 'Build_StorageContainerMk1_C')!;
    expect(box.placement!.floorId).toBe(floors[0]!.id);
  });
});

describe('Hotfix 0.10.3: Gruppieren', () => {
  it('Bahnhof eines Gewinnungspostens über ein Band länger als 150 m gehört zum Posten', () => {
    const ex = fixture();
    // Plattform ohne Lager dahinter: Bahnhof und Plattform allein hätten keine Fabrik
    ex.buildings = ex.buildings.filter((b) => b.id !== 'Box');
    ex.conveyors = ex.conveyors.filter((c) => c.id !== 'F');
    const pf = ex.buildings.find((b) => b.id === 'Platform')!;
    pf.conns = {};
    add(ex, { id: 'Far', type: 'Build_MinerMk2_C', x: pf.x - 155, y: pf.y + 10, node: ex.buildings.find((b) => b.id === 'Miner')!.node });
    belt(ex, 'Long', { id: 'Far', comp: 'Output0' }, { id: 'Platform', comp: 'Input0' });
    expect(groupOf(ex, 'Far')!.buildingIds).toEqual(expect.arrayContaining(['Platform', 'Station']));
  });
});

describe('Hotfix 0.10.3: Transportaufträge zwischen Fabriken', () => {
  it('über eine einzelne Zusammenführung zwischen zwei Fabriken: ein Auftrag vom Erzeuger zum Abnehmer, auch wenn die Kette rückwärts gefunden wird', () => {
    const ex = fixture();
    const c = ex.buildings.find((b) => b.id === 'Constructor')!;
    c.conns.Output0 = null;
    ex.conveyors = ex.conveyors.filter((x) => x.id !== 'G');
    ex.buildings.find((b) => b.id === 'Plates')!.conns = {};
    // Zusammenführung und Assembler vorn in der Liste: die Suche findet die Ketten vom Abnehmer aus
    add(ex, { id: 'Asm', type: 'Build_AssemblerMk1_C', x: c.x + 400, y: c.y, recipe: 'Recipe_IronPlateReinforced_C' }, true);
    add(ex, { id: 'M', type: 'Build_ConveyorAttachmentMerger_C', x: c.x + 200, y: c.y }, true);
    belt(ex, 'A1', { id: 'Constructor', comp: 'Output0' }, { id: 'M', comp: 'Input1' });
    belt(ex, 'A2', { id: 'M', comp: 'Output1' }, { id: 'Asm', comp: 'Input0' });
    const g = groupSave(ex, gd);
    const { project: p } = projectFromSave(ex, gd, { ...BASE, groups: g.groups });
    const factoryOf = (saveId: string) => p.factories[Object.values(p.buildings).find((b) => b.type === (saveId === 'Asm' ? 'Build_AssemblerMk1_C' : 'Build_ConstructorMk1_C'))!.factoryId]!;
    const orders = Object.values(p.transportOrders);
    expect(orders).toHaveLength(1);
    expect(orders[0]).toMatchObject({ itemId: 'Desc_IronPlate_C', mode: 'belt', fromFactoryId: factoryOf('Constructor').id, toFactoryId: factoryOf('Asm').id });
  });

  it('aus einer Station mit unbekannter Ladung: was der Abnehmer braucht, ohne das, was über seine anderen Eingänge kommt', () => {
    const ex = fixture();
    const c = ex.buildings.find((b) => b.id === 'Constructor')!;
    c.conns.Output0 = null;
    ex.conveyors = ex.conveyors.filter((x) => x.id !== 'G');
    ex.buildings.find((b) => b.id === 'Plates')!.conns = {};
    // Assembler neben dem Konstruktor (Platten), Schrauben kommen 200 m weit aus einer entladenden Lkw-Station
    add(ex, { id: 'Asm', type: 'Build_AssemblerMk1_C', x: c.x + 12, y: c.y, recipe: 'Recipe_IronPlateReinforced_C' });
    belt(ex, 'P', { id: 'Constructor', comp: 'Output0' }, { id: 'Asm', comp: 'Input0' });
    add(ex, { id: 'Truck', type: 'Build_TruckStation_C', x: c.x + 212, y: c.y, loadMode: false });
    add(ex, { id: 'Box2', type: 'Build_StorageContainerMk1_C', x: c.x + 212, y: c.y + 14 });
    // eigene Maschine dort: eine eigene Fabrik (ohne Maschine ginge sie an die belieferte, Hotfix 0.9.1)
    add(ex, { id: 'Rod', type: 'Build_ConstructorMk1_C', x: c.x + 224, y: c.y, recipe: 'Recipe_IronRod_C' });
    belt(ex, 'S', { id: 'Truck', comp: 'Output0' }, { id: 'Asm', comp: 'Input1' });
    const g = groupSave(ex, gd);
    expect(groupOf(ex, 'Truck')!.key).not.toBe(groupOf(ex, 'Asm')!.key);
    const { project: p } = projectFromSave(ex, gd, { ...BASE, groups: g.groups });
    const orders = Object.values(p.transportOrders);
    expect(orders.map((o) => o.itemId)).toEqual(['Desc_IronScrew_C']);
    // Die Station liefert nach Bedarf auch an den Auftrag (Ausfuhr fließt)
    const truck = Object.values(p.buildings).find((b) => b.type === 'Build_TruckStation_C')!;
    const flow = computeFactoryFlow(p, gd, truck.factoryId);
    expect(flow.direct.get(orders[0]!.id)!.perMin).toBeGreaterThan(1);
  });
});

describe('Hotfix 0.10.3: Durchsatzmodell', () => {
  it('Überschuss verteilt sich gleichmäßig auf die Gewinnung eines Netzes', () => {
    const p = newProject();
    const { factory, floorId } = firstFactory(p);
    const put = (type: string, x: number, y: number, extra: Partial<facOps.NewBuilding> = {}) =>
      facOps.addBuilding(p, gd, { factoryId: factory.id, type, placement: { floorId, x, y, zOffsetM: 0, rotationDeg: 0 }, ...extra });
    const ore = { itemId: 'Desc_OreIron_C', purity: 'normal' as const };
    const m1 = put('Build_MinerMk1_C', 0, 0, { extraction: ore });
    const m2 = put('Build_MinerMk1_C', 20, 0, { extraction: ore });
    const merger = put('Build_ConveyorAttachmentMerger_C', 10, 20);
    const smelter = put('Build_SmelterMk1_C', 10, 40, { recipeId: 'Recipe_IngotIron_C' });
    const box = put('Build_StorageContainerMk1_C', 10, 60);
    const link = (a: string, pa: string, b: string, pb: string) => facOps.addLink(p, gd, { kind: 'belt', tier: 'Build_ConveyorBeltMk2_C', from: { buildingId: a, portId: pa }, to: { buildingId: b, portId: pb } });
    link(m1, 'belt-out-0', merger, 'belt-in-0');
    link(m2, 'belt-out-0', merger, 'belt-in-2');
    link(merger, 'belt-out-0', smelter, 'belt-in-0');
    link(smelter, 'belt-out-0', box, 'belt-in-0');
    const flow = computeFactoryFlow(p, gd, factory.id);
    expect(flow.machines.get(smelter)!.utilization).toBeCloseTo(1, 3);
    // 2 × 60/min Erz, gebraucht 30/min: beide Miner zu je 25 %
    expect(flow.machines.get(m1)!.utilization).toBeCloseTo(0.25, 2);
    expect(flow.machines.get(m2)!.utilization).toBeCloseTo(0.25, 2);
  });
});

describe('Hotfix 0.10.3 (2): Splitter wie im Spiel', () => {
  /** Schmelzofen (30 Barren/min) → Splitter → zwei Abnehmer; liefert die IDs. */
  function setup(type: string, a: string, b: string, rules: Record<string, string[]> | null = null, recipe = 'Recipe_IngotIron_C') {
    const p = newProject();
    const { factory, floorId } = firstFactory(p);
    const put = (t: string, x: number, y: number, extra: Partial<facOps.NewBuilding> = {}) =>
      facOps.addBuilding(p, gd, { factoryId: factory.id, type: t, placement: { floorId, x, y, zOffsetM: 0, rotationDeg: 0 }, ...extra });
    const miner = put('Build_MinerMk1_C', 0, 0, { extraction: { itemId: recipe === 'Recipe_IngotIron_C' ? 'Desc_OreIron_C' : 'Desc_OreCopper_C', purity: 'impure' }, clock: 1 });
    const smelter = put('Build_SmelterMk1_C', 0, 20, { recipeId: recipe });
    const sp = put(type, 0, 40, { sortRules: rules });
    const A = put(a, -30, 60, a.includes('Truck') ? { transfer: { mode: 'load', stationId: null } } : {});
    const B = put(b, 30, 60);
    const link = (x: string, px: string, y: string, py: string) => facOps.addLink(p, gd, { kind: 'belt', tier: 'Build_ConveyorBeltMk3_C', from: { buildingId: x, portId: px }, to: { buildingId: y, portId: py } });
    link(miner, 'belt-out-0', smelter, 'belt-in-0');
    link(smelter, 'belt-out-0', sp, 'belt-in-0');
    const la = link(sp, 'belt-out-0', A, 'belt-in-0');
    const lb = link(sp, 'belt-out-1', B, 'belt-in-0');
    return { p, factory: factory.id, la, lb, A };
  }
  const flowOf = (x: ReturnType<typeof setup>) => computeFactoryFlow(x.p, gd, x.factory);
  const total = (x: ReturnType<typeof setup>, l: string) => flowOf(x).links.get(l)!.total;

  it('normaler Splitter verteilt gleichmäßig auf zwei Senken statt alles über einen Weg', () => {
    const x = setup('Build_ConveyorAttachmentSplitter_C', 'Build_ResourceSink_C', 'Build_ResourceSink_C');
    expect(total(x, x.la)).toBeCloseTo(15, 3);
    expect(total(x, x.lb)).toBeCloseTo(15, 3);
  });

  it('Smart-Splitter: Filter und Überlauf wie im Spiel', () => {
    const iron = { 'belt-out-0': ['Desc_IronIngot_C'], 'belt-out-1': ['overflow'], 'belt-out-2': ['none'] };
    let x = setup('Build_ConveyorAttachmentSplitterSmart_C', 'Build_ResourceSink_C', 'Build_ResourceSink_C', iron);
    expect(total(x, x.la)).toBeCloseTo(30, 3);
    expect(total(x, x.lb)).toBeCloseTo(0, 3);
    // Filter passt nicht (Kupferbarren): alles über den Überlauf
    x = setup('Build_ConveyorAttachmentSplitterSmart_C', 'Build_ResourceSink_C', 'Build_ResourceSink_C', iron, 'Recipe_IngotCopper_C');
    expect(total(x, x.la)).toBeCloseTo(0, 3);
    expect(total(x, x.lb)).toBeCloseTo(30, 3);
    // „Nichts“ auf beiden Ausgängen: der Schmelzofen staut sich
    x = setup('Build_ConveyorAttachmentSplitterSmart_C', 'Build_ResourceSink_C', 'Build_ResourceSink_C', { 'belt-out-0': ['none'], 'belt-out-1': ['none'] });
    expect([...flowOf(x).machines.values()].find((m) => m.role === 'machine')!.utilization).toBe(0);
  });

  it('Lager ohne Abgang gilt als voll: der Überlauf geht zur Senke', () => {
    const x = setup('Build_ConveyorAttachmentSplitterSmart_C', 'Build_StorageContainerMk1_C', 'Build_ResourceSink_C', { 'belt-out-0': ['any'], 'belt-out-1': ['overflow'] });
    expect(total(x, x.la)).toBeCloseTo(0, 3);
    expect(total(x, x.lb)).toBeCloseTo(30, 3);
  });

  it('beladende Station nimmt höchstens die Auftragsmenge ab, der Rest läuft über den Überlauf', () => {
    const x = setup('Build_ConveyorAttachmentSplitterSmart_C', 'Build_TruckStation_C', 'Build_ResourceSink_C', { 'belt-out-0': ['any'], 'belt-out-1': ['overflow'] });
    // ohne Auftrag: unbegrenzt
    expect(total(x, x.la)).toBeCloseTo(30, 3);
    const other = facOps.addFactory(x.p, 'Ziel');
    addOrder(x.p, gd, { name: 'Lkw', itemId: 'Desc_IronIngot_C', ratePerMin: 10, fromFactoryId: x.factory, toFactoryId: other, mode: 'vehicle', fromStationId: null, toStationId: null, trainIds: [], roundTripEstimateS: null });
    expect(total(x, x.la)).toBeCloseTo(10, 3);
    expect(total(x, x.lb)).toBeCloseTo(20, 3);
  });

  it('Import: Filter der Smart-Splitter je Ausgang (auch am Förderlift)', () => {
    const ex = fixture();
    const c = ex.buildings.find((b) => b.id === 'Constructor')!;
    add(ex, { id: 'Sm', type: 'Build_ConveyorAttachmentSplitterSmart_C', x: c.x + 6, y: c.y, sortRules: [{ output: 0, item: 'Desc_Wildcard_C' }, { output: 1, item: 'Desc_Overflow_C' }, { output: 2, item: 'Desc_IronPlate_C' }] });
    add(ex, { id: 'SmL', type: 'Build_ConveyorAttachmentSplitterSmartLift_C', x: c.x + 9, y: c.y, sortRules: [{ output: 0, item: 'Desc_Wildcard_C' }, { output: 1, item: 'Desc_Overflow_C' }, { output: 2, item: 'Desc_None_C' }] });
    const main = groupSave(ex, gd).groups.find((g) => g.buildingIds.includes('Constructor'))!;
    const { project: p } = projectFromSave(ex, gd, { ...BASE, groups: [{ name: 'F', buildingIds: [...main.buildingIds, 'Sm', 'SmL'] }] });
    const smart = Object.values(p.buildings).filter((b) => b.type === 'Build_ConveyorAttachmentSplitterSmart_C');
    expect(smart.map((b) => b.sortRules)).toEqual(
      expect.arrayContaining([
        { 'belt-out-0': ['any'], 'belt-out-1': ['overflow'], 'belt-out-2': ['Desc_IronPlate_C'] },
        // Lift: Index 0 = weiterführender Lift (Output2), 1 = Output1, 2 = Output2 des Spiels (Output3)
        { 'belt-out-1': ['any'], 'belt-out-0': ['overflow'], 'belt-out-2': ['none'] },
      ]),
    );
  });
});

describe('Hotfix 0.10.3: Reihenfolge der Fabriken', () => {
  it('moveFactory setzt eine Fabrik vor eine andere bzw. ans Ende', () => {
    const p = newProject();
    const a = firstFactory(p).factory.id;
    const b = facOps.addFactory(p, 'B');
    const c = facOps.addFactory(p, 'C');
    facOps.moveFactory(p, c, a);
    expect(Object.keys(p.factories)).toEqual([c, a, b]);
    facOps.moveFactory(p, c, null);
    expect(Object.keys(p.factories)).toEqual([a, b, c]);
    facOps.moveFactory(p, a, c);
    expect(Object.keys(p.factories)).toEqual([b, a, c]);
  });
});
