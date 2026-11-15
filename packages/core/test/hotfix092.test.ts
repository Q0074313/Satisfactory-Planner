import { describe, expect, it } from 'vitest';
import { computeFactoryFlow } from '../src/factory/flow.ts';
import { portDefs } from '../src/factory/ports.ts';
import { groupSave, projectFromSave } from '../src/import/fromSave.ts';
import { toWorldOf } from '../src/map/index.ts';
import * as facOps from '../src/project/ops/factory.ts';
import { reassignToFactory } from '../src/project/ops/reassign.ts';
import { firstFactory, gameData, newProject } from './helpers.ts';
import { fixture } from './saveFixture.ts';

const gd = gameData();
const BASE = { name: 'Import', datasetId: gd.data.meta.datasetId, gameVersion: gd.data.meta.gameVersion, rail: true, plans: true };

describe('Hotfix 0.9.2', () => {
  it('Flüssigkeitspuffer: beide Anschlüsse richtungsfrei, Anschluss-IDs unverändert', () => {
    for (const type of ['Build_PipeStorageTank_C', 'Build_IndustrialTank_C']) {
      const ports = portDefs(gd.building(type)!);
      expect(ports.map((q) => [q.id, q.direction])).toEqual([
        ['pipe-in-0', 'any'],
        ['pipe-out-0', 'any'],
      ]);
    }
  });

  it('Rohre zwischen Rohrkreuzungen fließen auch entgegen der Zeichenrichtung', () => {
    const p = newProject();
    const { factory, floorId } = firstFactory(p);
    const put = (type: string, x: number, y: number, extra: Partial<facOps.NewBuilding> = {}) =>
      facOps.addBuilding(p, gd, { factoryId: factory.id, type, placement: { floorId, x, y, zOffsetM: 0, rotationDeg: 0 }, ...extra });
    const pump = put('Build_WaterPump_C', 0, 0, { extraction: { itemId: 'Desc_Water_C', purity: 'normal' } });
    const j1 = put('Build_PipelineJunction_Cross_C', 0, 30);
    const j2 = put('Build_PipelineJunction_Cross_C', 0, 50);
    const tank = put('Build_PipeStorageTank_C', 0, 70);
    const link = (a: string, pa: string, b: string, pb: string) => facOps.addLink(p, gd, { kind: 'pipe', tier: 'Build_PipelineMK2_C', from: { buildingId: a, portId: pa }, to: { buildingId: b, portId: pb } });
    link(pump, 'pipe-out-0', j1, 'pipe-any-0');
    // gegen die Flussrichtung gezeichnet: J2 → J1
    link(j2, 'pipe-any-0', j1, 'pipe-any-1');
    // in den „Ausgang“ des Puffers (richtungsfrei)
    link(j2, 'pipe-any-1', tank, 'pipe-out-0');
    const flow = computeFactoryFlow(p, gd, factory.id);
    expect(flow.machines.get(pump)!.utilization).toBeGreaterThan(0.99);
  });

  it('Stationen nach Bedarf: entladende Lkw-Station ohne Auftrag versorgt die Maschinen dahinter (Projekteinstellung)', () => {
    const p = newProject();
    const { factory, floorId } = firstFactory(p);
    const put = (type: string, x: number, y: number, extra: Partial<facOps.NewBuilding> = {}) =>
      facOps.addBuilding(p, gd, { factoryId: factory.id, type, placement: { floorId, x, y, zOffsetM: 0, rotationDeg: 0 }, ...extra });
    const truck = put('Build_TruckStation_C', 0, 0, { transfer: { mode: 'unload', stationId: null } });
    const smelter = put('Build_SmelterMk1_C', 40, 0, { recipeId: 'Recipe_IngotIron_C' });
    const box = put('Build_StorageContainerMk1_C', 70, 0);
    const out = portDefs(gd.building('Build_TruckStation_C')!).find((q) => q.kind === 'belt' && q.direction === 'out')!;
    facOps.addLink(p, gd, { kind: 'belt', tier: 'Build_ConveyorBeltMk2_C', from: { buildingId: truck, portId: out.id }, to: { buildingId: smelter, portId: 'belt-in-0' } });
    facOps.addLink(p, gd, { kind: 'belt', tier: 'Build_ConveyorBeltMk2_C', from: { buildingId: smelter, portId: 'belt-out-0' }, to: { buildingId: box, portId: 'belt-in-0' } });
    expect(computeFactoryFlow(p, gd, factory.id).machines.get(smelter)!.utilization).toBe(0);
    p.settings.stationsOnDemand = true;
    const flow = computeFactoryFlow(p, gd, factory.id);
    expect(flow.machines.get(smelter)!.utilization).toBeGreaterThan(0.99);
    expect(flow.assumptions.some((a) => a.includes('nach Bedarf'))).toBe(true);
  });

  it('Import: Lkw-Station mit Be-/Entladen, Stationen nach Bedarf, Logistikebene', () => {
    const ex = fixture();
    const smelter = ex.buildings.find((b) => b.id === 'Smelter')!;
    ex.buildings.push({ ...smelter, id: 'Truck', type: 'Build_TruckStation_C', recipe: null, x: smelter.x - 40, loadMode: false, conns: {} });
    // 12 Splitter auf eigener Höhe (12 m über den Maschinen, mehr als 10 m): Logistikebene
    for (let i = 0; i < 12; i++) ex.buildings.push({ ...smelter, id: `S${i}`, type: 'Build_ConveyorAttachmentSplitter_C', recipe: null, x: smelter.x + 4 * i, z: smelter.z + 12, conns: {} });
    const groups = groupSave(ex, gd).groups;
    const main = groups.find((g) => g.buildingIds.includes('Miner'))!;
    main.buildingIds.push(...ex.buildings.filter((b) => /^S\d+$/.test(b.id) || b.id === 'Truck').map((b) => b.id));
    const { project: p } = projectFromSave(ex, gd, { ...BASE, groups: [main] });
    expect(p.settings.stationsOnDemand).toBe(true);
    const truck = Object.values(p.buildings).find((b) => b.type === 'Build_TruckStation_C')!;
    expect(truck.transfer).toEqual({ mode: 'unload', stationId: null });
    const floors = p.factories[truck.factoryId]!.floorIds.map((id) => p.floors[id]!);
    expect(floors.map((f) => f.kind)).toEqual(['production', 'logistics']);
    expect(floors[1]!.elevationM).toBeCloseTo(smelter.z + 12, 0);
  });

  it('Gebäude einer anderen Fabrik zuweisen: Weltlage bleibt, Leitung über die Grenze wird Transportauftrag', () => {
    const ex = fixture();
    const { project: p } = projectFromSave(ex, gd, { ...BASE, groups: groupSave(ex, gd).groups });
    const con = Object.values(p.buildings).find((b) => b.type === 'Build_ConstructorMk1_C')!;
    const box = Object.values(p.buildings).find((b) => b.type === 'Build_StorageContainerMk1_C' && b.factoryId === con.factoryId)!;
    const src = p.factories[con.factoryId]!;
    const before = toWorldOf(src.map!, con.placement!);
    const elev = p.floors[con.placement!.floorId]!.elevationM;
    const res = reassignToFactory(p, gd, { buildingIds: [con.id, box.id] }, { newName: 'Platten' });
    const dst = p.factories[res.factoryId]!;
    expect(dst.name).toBe('Platten');
    expect(con.factoryId).toBe(dst.id);
    const after = toWorldOf(dst.map!, con.placement!);
    expect(after.x).toBeCloseTo(before.x, 3);
    expect(after.y).toBeCloseTo(before.y, 3);
    expect(p.floors[con.placement!.floorId]!.elevationM).toBeCloseTo(elev);
    // Leitung Konstruktor → Kiste wandert mit, Schmelzofen → Konstruktor wird Auftrag (30 Eisenbarren/min)
    expect(Object.values(p.links).some((l) => l.from.buildingId === con.id && l.factoryId === dst.id)).toBe(true);
    const order = Object.values(p.transportOrders).find((o) => o.toFactoryId === dst.id)!;
    expect(order).toMatchObject({ mode: 'belt', itemId: 'Desc_IronIngot_C', fromFactoryId: src.id });
    expect(order.ratePerMin).toBeCloseTo(30);
    expect(res.orders).toBe(1);
    // Fluss in der neuen Fabrik: Konstruktor über den Auftrag versorgt
    expect(computeFactoryFlow(p, gd, dst.id).machines.get(con.id)!.utilization).toBeGreaterThan(0.99);
  });
});
