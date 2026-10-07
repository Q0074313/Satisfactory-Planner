/**
 * Transport zwischen Fabriken per Fahrzeug und direkter Leitung (Band/Rohr).
 */
import { describe, expect, it } from 'vitest';
import * as fac from '../src/project/ops/factory.ts';
import * as tops from '../src/project/ops/transport.ts';
import { TransportOrderSchema } from '../src/model/schema.ts';
import { estimateOrder } from '../src/transport/estimate.ts';
import { checkTransport } from '../src/transport/checks.ts';
import { computeFactoryFlow } from '../src/factory/flow.ts';
import { checkFactory } from '../src/factory/checks.ts';
import type { Project } from '../src/model/schema.ts';
import { firstFactory, gameData, newProject } from './helpers.ts';

const gd = gameData();

function twoFactories() {
  const p = newProject();
  const a = firstFactory(p);
  const bId = fac.addFactory(p, 'B');
  const b = { factory: p.factories[bId]!, floorId: p.factories[bId]!.floorIds[0]! };
  const add = (f: { factory: { id: string }; floorId: string }, type: string, x: number, extra: Record<string, unknown> = {}) =>
    fac.addBuilding(p, gd, { factoryId: f.factory.id, type, placement: { floorId: f.floorId, x, y: 0, zOffsetM: 0, rotationDeg: 0 }, ...extra });
  return { p, a, b, add };
}

const order = (p: Project, init: Partial<tops.OrderInit> & Pick<tops.OrderInit, 'fromFactoryId' | 'toFactoryId'>) =>
  tops.addOrder(p, gd, { name: '', itemId: 'Desc_OreIron_C', ratePerMin: 120, fromStationId: null, toStationId: null, trainIds: [], roundTripEstimateS: null, ...init });

describe('Transportmittel', () => {
  it('ältere Aufträge ohne Angabe sind Zugaufträge', () => {
    const o = TransportOrderSchema.parse({ id: 'o', name: '', itemId: 'Desc_OreIron_C', ratePerMin: 1, fromFactoryId: 'a', toFactoryId: 'b' });
    expect(o.mode).toBe('train');
    expect(o.vehicle).toBeNull();
    expect(o.direct).toBeNull();
  });

  it('Fahrzeugdaten stammen aus den Docs (Laderaum) und dem Wiki (Geschwindigkeit, Tank)', () => {
    expect(gd.vehicle('Desc_Truck_C')).toMatchObject({ cargo: { kind: 'solid', slots: 48 }, maxSpeedKmh: 89 });
    expect(gd.vehicle('Desc_Tractor_C')).toMatchObject({ cargo: { kind: 'solid', slots: 25 }, maxSpeedKmh: 69 });
    expect(gd.vehicle('Desc_FluidTruck_C')).toMatchObject({ cargo: { kind: 'liquid', m3: 3200 }, maxSpeedKmh: 89 });
    expect(gd.vehicle('Desc_Explorer_C')).toMatchObject({ cargo: { kind: 'solid', slots: 12 }, maxSpeedKmh: 107 });
  });

  it('Fahrzeugschätzung: Laderaum × Anzahl / (2 × Strecke / Geschwindigkeit + 2 × 8 s)', () => {
    const { p, a, b } = twoFactories();
    const id = order(p, { fromFactoryId: a.factory.id, toFactoryId: b.factory.id, mode: 'vehicle', vehicle: { type: 'Desc_Truck_C', count: 2, distanceM: 1000, speedKmh: null } });
    const est = estimateOrder(p, gd, p.transportOrders[id]!);
    const stack = gd.item('Desc_OreIron_C')!.stackSize;
    const cycle = (2 * 1000) / ((89 * 1000) / 3600) + 2 * 8;
    expect(est.vehicle!.capacityPerTrip).toBe(48 * stack);
    expect(est.vehicle!.cycleS).toBeCloseTo(cycle, 6);
    expect(est.perMin).toBeCloseTo((2 * 48 * stack * 60) / cycle, 6);
    expect(est.ok).toBe(true);
  });

  it('Tanklaster für Feststoffe wird gemeldet (TRN-011), 0 Fahrzeuge ebenfalls (TRN-012)', () => {
    const { p, a, b } = twoFactories();
    const id = order(p, { fromFactoryId: a.factory.id, toFactoryId: b.factory.id, mode: 'vehicle', vehicle: { type: 'Desc_FluidTruck_C', count: 1, distanceM: 500, speedKmh: null } });
    expect(checkTransport(p, gd).map((f) => f.ruleId)).toContain('TRN-011');
    tops.updateOrder(p, gd, id, { vehicle: { type: 'Desc_Truck_C', count: 0, distanceM: 500, speedKmh: null } });
    const ids = checkTransport(p, gd).map((f) => f.ruleId);
    expect(ids).toContain('TRN-012');
    expect(ids).not.toContain('TRN-001');
  });

  it('Lkw-Station mit „Entladen“ liefert die Auftragsmenge ins Durchsatzmodell', () => {
    const { p, a, b, add } = twoFactories();
    order(p, { fromFactoryId: a.factory.id, toFactoryId: b.factory.id, ratePerMin: 15, mode: 'vehicle', vehicle: { type: 'Desc_Truck_C', count: 1, distanceM: 500, speedKmh: null } });
    // Ohne Station: Hinweis TRN-015 für beide Fabriken
    expect(checkTransport(p, gd).filter((f) => f.ruleId === 'TRN-015')).toHaveLength(2);
    const st = add(b, 'Build_TruckStation_C', 0);
    expect(p.buildings[st]!.transfer).toEqual({ mode: 'unload', stationId: null });
    const s = add(b, 'Build_SmelterMk1_C', 40, { recipeId: 'Recipe_IngotIron_C' });
    const sink = add(b, 'Build_ResourceSink_C', 80);
    // Bandausgang der Station (belt-out-0) → Schmelzofen → Senke
    fac.addLink(p, gd, { kind: 'belt', tier: 'Build_ConveyorBeltMk1_C', from: { buildingId: st, portId: 'belt-out-0' }, to: { buildingId: s, portId: 'belt-in-0' } });
    fac.addLink(p, gd, { kind: 'belt', tier: 'Build_ConveyorBeltMk1_C', from: { buildingId: s, portId: 'belt-out-0' }, to: { buildingId: sink, portId: 'belt-in-0' } });
    const flow = computeFactoryFlow(p, gd, b.factory.id);
    expect(flow.machines.get(s)!.utilization).toBeCloseTo(0.5);
    // Nur noch die beladende Station beim Absender fehlt
    expect(checkTransport(p, gd).filter((f) => f.ruleId === 'TRN-015')).toHaveLength(1);
  });

  it('direktes Förderband: Ausgang der einen, Eingang der anderen Fabrik; Kapazität je Leitung', () => {
    const { p, a, b, add } = twoFactories();
    const src = add(a, 'Build_SmelterMk1_C', 0, { recipeId: 'Recipe_IngotIron_C' });
    const minerFeed = add(a, 'Build_MinerMk1_C', -30, { extraction: { itemId: 'Desc_OreIron_C', purity: 'normal' } });
    fac.addLink(p, gd, { kind: 'belt', tier: 'Build_ConveyorBeltMk1_C', from: { buildingId: minerFeed, portId: 'belt-out-0' }, to: { buildingId: src, portId: 'belt-in-0' } });
    const dst = add(b, 'Build_ConstructorMk1_C', 0, { recipeId: 'Recipe_IronPlate_C' });
    const sink = add(b, 'Build_ResourceSink_C', 40);
    fac.addLink(p, gd, { kind: 'belt', tier: 'Build_ConveyorBeltMk1_C', from: { buildingId: dst, portId: 'belt-out-0' }, to: { buildingId: sink, portId: 'belt-in-0' } });
    const id = order(p, { fromFactoryId: a.factory.id, toFactoryId: b.factory.id, itemId: 'Desc_IronIngot_C', ratePerMin: 30, mode: 'belt' });
    expect(p.transportOrders[id]!.direct).toMatchObject({ tier: 'Build_ConveyorBeltMk1_C', lines: 1, from: null, to: null });
    // Eingang als Start ist unzulässig
    expect(() => tops.updateOrder(p, gd, id, { direct: { ...p.transportOrders[id]!.direct!, from: { buildingId: src, portId: 'belt-in-0' } } })).toThrow();
    tops.updateOrder(p, gd, id, {
      direct: { ...p.transportOrders[id]!.direct!, from: { buildingId: src, portId: 'belt-out-0' }, to: { buildingId: dst, portId: 'belt-in-0' } },
    });
    // Empfänger: Konstruktor bekommt 30 Barren/min → voll ausgelastet; Absender: Barren fließen ab
    const fb = computeFactoryFlow(p, gd, b.factory.id);
    expect(fb.machines.get(dst)!.utilization).toBeCloseTo(1);
    expect(fb.direct.get(id)).toMatchObject({ dir: 'in' });
    const fa = computeFactoryFlow(p, gd, a.factory.id);
    expect(fa.machines.get(src)!.utilization).toBeCloseTo(1);
    expect(fa.machines.get(src)!.issues.some((x) => x.kind === 'output-blocked')).toBe(false);
    expect(checkFactory(p, gd, a.factory.id, { flow: fa }).map((f) => f.ruleId)).not.toContain('FAB-013');
    // Kapazität: 1 × Mk.1 = 60/min reicht für 30, nicht für 100
    expect(checkTransport(p, gd).map((f) => f.ruleId)).not.toContain('TRN-014');
    tops.updateOrder(p, gd, id, { ratePerMin: 100 });
    expect(checkTransport(p, gd).map((f) => f.ruleId)).toContain('TRN-014');
    tops.updateOrder(p, gd, id, { direct: { ...p.transportOrders[id]!.direct!, lines: 2 } });
    expect(checkTransport(p, gd).map((f) => f.ruleId)).not.toContain('TRN-014');
  });

  it('Rohr für Feststoffe wird gemeldet; Übergabe verschwindet beim Löschen bzw. Fabrikwechsel', () => {
    const { p, a, b, add } = twoFactories();
    const src = add(a, 'Build_SmelterMk1_C', 0, { recipeId: 'Recipe_IngotIron_C' });
    const dst = add(b, 'Build_ConstructorMk1_C', 0, { recipeId: 'Recipe_IronPlate_C' });
    const id = order(p, { fromFactoryId: a.factory.id, toFactoryId: b.factory.id, itemId: 'Desc_IronIngot_C', ratePerMin: 30, mode: 'pipe' });
    expect(checkTransport(p, gd).map((f) => f.ruleId)).toContain('TRN-011');
    tops.updateOrder(p, gd, id, { mode: 'belt', direct: { tier: 'Build_ConveyorBeltMk2_C', lines: 1, lengthM: 50, from: { buildingId: src, portId: 'belt-out-0' }, to: { buildingId: dst, portId: 'belt-in-0' } } });
    fac.removeBuildings(p, [dst]);
    expect(p.transportOrders[id]!.direct!.to).toBeNull();
    expect(p.transportOrders[id]!.direct!.from).not.toBeNull();
    const c = fac.addFactory(p, 'C');
    tops.updateOrder(p, gd, id, { fromFactoryId: c });
    expect(p.transportOrders[id]!.direct!.from).toBeNull();
  });
});
