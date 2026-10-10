import { describe, expect, it } from 'vitest';
import type { ProductionPlan } from '../src/model/schema.ts';
import { machinePower, machineRates } from '../src/production/machine.ts';
import { solveProduction, transportNeed, type SolveResult } from '../src/production/solver.ts';
import { compareBalance } from '../src/production/balance.ts';
import { checkPlan } from '../src/production/checks.ts';
import * as prod from '../src/project/ops/production.ts';
import * as ops from '../src/project/ops/factory.ts';
import { firstFactory, gameData, newProject } from './helpers.ts';

const gd = gameData();

function plan(patch: Partial<ProductionPlan>): ProductionPlan {
  return {
    id: 'plan_t',
    factoryId: 'fac_t',
    name: 'Test',
    mode: 'target',
    targets: [],
    supplies: [],
    enabledAlternates: [],
    disabledRecipes: [],
    machineLimits: [],
    limitToExistingMachines: false,
    optimize: 'resources',
    power: { generators: [] },
    suggestAlternates: false,
    ...patch,
  };
}

const item = (r: SolveResult, id: string) => r.items.find((x) => x.itemId === id)!;
const recipe = (r: SolveResult, id: string) => r.recipes.find((x) => x.recipeId === id);

/** Massenbilanz: Erzeugung + Versorgung + Fehlmenge = Verbrauch + Ziel + Überschuss (je Gegenstand). */
function expectBalanced(r: SolveResult) {
  for (const it of r.items) {
    const lhs = it.produced + it.supplied + it.shortfall;
    const rhs = it.consumed + it.target + it.surplus;
    expect(Math.abs(lhs - rhs), `Bilanz ${it.itemId}`).toBeLessThan(1e-6 * Math.max(1, lhs));
  }
}

describe('Maschinenkennzahlen (Spieldaten)', () => {
  it('Konstruktor Eisenplatte: 30 Barren → 20 Platten/min, 4 MW', () => {
    const r = machineRates(gd, { type: 'Build_ConstructorMk1_C', recipeId: 'Recipe_IronPlate_C', clock: 1, somersloops: 0 });
    expect(r.inputs).toEqual([{ item: 'Desc_IronIngot_C', perMin: 30 }]);
    expect(r.outputs).toEqual([{ item: 'Desc_IronPlate_C', perMin: 20 }]);
    expect(r.powerMW).toBeCloseTo(4);
  });

  it('Takt skaliert Raten linear und Leistung mit Exponent 1,321929', () => {
    const r = machineRates(gd, { type: 'Build_ConstructorMk1_C', recipeId: 'Recipe_IronPlate_C', clock: 2.5, somersloops: 0 });
    expect(r.outputs[0]!.perMin).toBeCloseTo(50);
    expect(r.powerMW).toBeCloseTo(4 * Math.pow(2.5, 1.321929), 5);
  });

  it('Somersloop verdoppelt die Ausgabe (alle Slots) und vervierfacht die Leistung', () => {
    const r = machineRates(gd, { type: 'Build_ConstructorMk1_C', recipeId: 'Recipe_IronPlate_C', clock: 1, somersloops: 1 });
    expect(r.inputs[0]!.perMin).toBeCloseTo(30);
    expect(r.outputs[0]!.perMin).toBeCloseTo(40);
    expect(r.powerMW).toBeCloseTo(16);
  });

  it('Variable Leistung: Mittelwert und Spanne', () => {
    const def = gd.building('Build_HadronCollider_C')!;
    const rec = Object.values(gd.data.recipes).find((x) => x.producedIn.includes(def.id) && x.variablePower)!;
    const pw = machinePower(def, rec, 1, 0);
    expect(pw.range).toEqual([rec.variablePower!.constantMW, rec.variablePower!.constantMW + rec.variablePower!.factorMW]);
    expect(pw.avg).toBeCloseTo(rec.variablePower!.constantMW + rec.variablePower!.factorMW / 2);
  });
});

describe('Produktionsberechnung (LP)', () => {
  it('Einfache Kette: 20 Eisenplatten/min = 1 Konstruktor, 1 Schmelzofen, 30 Eisenerz', () => {
    const r = solveProduction(gd, plan({ targets: [{ itemId: 'Desc_IronPlate_C', ratePerMin: 20 }] }));
    expect(r.status).toBe('optimal');
    expect(recipe(r, 'Recipe_IronPlate_C')!.machines).toBeCloseTo(1);
    expect(recipe(r, 'Recipe_IngotIron_C')!.machines).toBeCloseTo(1);
    expect(item(r, 'Desc_OreIron_C').supplied).toBeCloseTo(30);
    expect(r.powerMW).toBeCloseTo(8);
    expectBalanced(r);
  });

  it('Teilmengen: 45 Platten/min → 2,25 Konstruktoren = 3 × 75 %', () => {
    const r = solveProduction(gd, plan({ targets: [{ itemId: 'Desc_IronPlate_C', ratePerMin: 45 }] }));
    const c = recipe(r, 'Recipe_IronPlate_C')!;
    expect(c.machines).toBeCloseTo(2.25);
    expect(c.machinesCeil).toBe(3);
    expect(c.clockEven).toBeCloseTo(0.75);
    expect(c.powerMW).toBeCloseTo(3 * 4 * Math.pow(0.75, 1.321929), 4);
  });

  it('Komplexe Kette (Computer) ist mengenmäßig ausgeglichen', () => {
    const r = solveProduction(gd, plan({ targets: [{ itemId: 'Desc_Computer_C', ratePerMin: 5 }, { itemId: 'Desc_ModularFrameHeavy_C', ratePerMin: 2 }] }));
    expect(r.status).toBe('optimal');
    expect(r.message).toBe('Alle Ziele erreichbar.');
    expectBalanced(r);
    expect(item(r, 'Desc_Computer_C').target).toBe(5);
  });

  it('Nebenprodukte werden als Überschuss ausgewiesen (Treibstoff → Polymerharz)', () => {
    const r = solveProduction(
      gd,
      plan({ targets: [{ itemId: 'Desc_LiquidFuel_C', ratePerMin: 40 }], disabledRecipes: ['Recipe_ResidualFuel_C', 'Recipe_ResidualPlastic_C', 'Recipe_ResidualRubber_C'] }),
    );
    expect(recipe(r, 'Recipe_LiquidFuel_C')!.machines).toBeCloseTo(1);
    expect(item(r, 'Desc_PolymerResin_C').surplus).toBeCloseTo(30);
    expect(item(r, 'Desc_LiquidOil_C').supplied).toBeCloseTo(60);
    expectBalanced(r);
  });

  it('Kreislauf: Recycelter Gummi ↔ Recycelter Kunststoff wird als Gleichungssystem gelöst', () => {
    const r = solveProduction(
      gd,
      plan({
        targets: [{ itemId: 'Desc_Rubber_C', ratePerMin: 90 }],
        enabledAlternates: ['Recipe_Alternate_RecycledRubber_C', 'Recipe_Alternate_Plastic_1_C'],
        disabledRecipes: ['Recipe_Rubber_C', 'Recipe_Plastic_C', 'Recipe_ResidualRubber_C', 'Recipe_ResidualPlastic_C'],
      }),
    );
    expect(r.status).toBe('optimal');
    const a = recipe(r, 'Recipe_Alternate_RecycledRubber_C')!;
    const b = recipe(r, 'Recipe_Alternate_Plastic_1_C')!;
    // Netto: Gummi 60a − 30b = 90, Kunststoff 60b − 30a = 0 (je Maschine 60/min Ausgabe, 30/min Einsatz)
    expect(a.machines).toBeCloseTo(2);
    expect(b.machines).toBeCloseTo(1);
    expect(item(r, 'Desc_Plastic_C').supplied).toBe(0);
    expectBalanced(r);
  });

  it('Alternativrezepte werden nur genutzt, wenn freigeschaltet – und senken den Rohstoffbedarf', () => {
    const base = solveProduction(gd, plan({ targets: [{ itemId: 'Desc_IronIngot_C', ratePerMin: 65 }] }));
    expect(item(base, 'Desc_OreIron_C').supplied).toBeCloseTo(65);
    const alt = solveProduction(gd, plan({ targets: [{ itemId: 'Desc_IronIngot_C', ratePerMin: 65 }], enabledAlternates: ['Recipe_Alternate_PureIronIngot_C'] }));
    expect(recipe(alt, 'Recipe_Alternate_PureIronIngot_C')!.machines).toBeCloseTo(1);
    expect(item(alt, 'Desc_OreIron_C').supplied).toBeCloseTo(35);
    expect(item(alt, 'Desc_Water_C').supplied).toBeCloseTo(20);
  });

  it('Nicht erreichbares Ziel: Fehlmenge und Ursache statt Abbruch', () => {
    const r = solveProduction(gd, plan({ targets: [{ itemId: 'Desc_IronPlate_C', ratePerMin: 20 }], disabledRecipes: ['Recipe_IngotIron_C'] }));
    expect(r.status).toBe('optimal');
    expect(item(r, 'Desc_IronPlate_C').shortfall).toBeCloseTo(20);
    expect(r.bottlenecks.some((b) => b.kind === 'no-source' && b.id === 'Desc_IronIngot_C')).toBe(true);
    expect(r.message).toMatch(/nicht vollständig erreichbar/);
  });

  it('Begrenzte Rohstoffe: Maximierung liefert 40 Platten aus 60 Erz', () => {
    const r = solveProduction(
      gd,
      plan({ mode: 'maximize', targets: [{ itemId: 'Desc_IronPlate_C', ratePerMin: 1 }], supplies: [{ itemId: 'Desc_OreIron_C', maxPerMin: 60, origin: 'local' }] }),
    );
    expect(r.scale).toBeCloseTo(40);
    expect(item(r, 'Desc_IronPlate_C').target).toBeCloseTo(40);
    expect(r.bottlenecks.some((b) => b.kind === 'supply' && b.id === 'Desc_OreIron_C')).toBe(true);
    expectBalanced(r);
  });

  it('Maximierung mit fehlender Rohstoffgrenze ist unbeschränkt oder 0 – nie stillschweigend falsch', () => {
    const r = solveProduction(gd, plan({ mode: 'maximize', targets: [{ itemId: 'Desc_IronPlate_C', ratePerMin: 1 }] }));
    // Ohne angegebene Versorgung steht kein Erz zur Verfügung → Skalierung 0
    expect(r.scale).toBe(0);
    const u = solveProduction(gd, plan({ mode: 'maximize', targets: [{ itemId: 'Desc_IronPlate_C', ratePerMin: 1 }], supplies: [{ itemId: 'Desc_OreIron_C', maxPerMin: null, origin: 'local' }] }));
    expect(u.status).toBe('unbounded');
  });

  it('Vorhandene Maschinen begrenzen die Produktion (mit Somersloop-Variante)', () => {
    const p = newProject();
    const { factory } = firstFactory(p);
    ops.addBuilding(p, gd, { factoryId: factory.id, type: 'Build_SmelterMk1_C', recipeId: 'Recipe_IngotIron_C' });
    ops.addBuilding(p, gd, { factoryId: factory.id, type: 'Build_ConstructorMk1_C', recipeId: 'Recipe_IronPlate_C', somersloops: 1 });
    const existing = Object.values(p.buildings);
    const r = solveProduction(gd, plan({ targets: [{ itemId: 'Desc_IronPlate_C', ratePerMin: 60 }], limitToExistingMachines: true }), { existingMachines: existing });
    // 1 Schmelzofen → 30 Barren → Konstruktor mit Somersloop → 40 Platten
    expect(item(r, 'Desc_IronPlate_C').produced).toBeCloseTo(40);
    expect(item(r, 'Desc_IronPlate_C').shortfall).toBeCloseTo(20);
    expect(r.bottlenecks.some((b) => b.kind === 'machines')).toBe(true);
  });

  it('Transportbedarf: kleinste passende Bandstufe bzw. parallele Leitungen', () => {
    expect(gd.building(transportNeed(gd, 'Desc_IronPlate_C', 250).tier!)!.conveyor!.itemsPerMin).toBe(270);
    const big = transportNeed(gd, 'Desc_OreIron_C', 3000);
    expect(big.tier).toBeNull();
    expect(big.parallelAtTop).toBe(3);
    expect(transportNeed(gd, 'Desc_Water_C', 450).kind).toBe('pipe');
  });
});

describe('Produktionsplan ↔ Fabrik', () => {
  it('Maschinen anlegen erzeugt nicht platzierte Gebäude; Bilanz zeigt Soll/Geplant/Platziert', () => {
    const p = newProject();
    const { factory, floorId } = firstFactory(p);
    const planId = prod.addPlan(p, factory.id, 'Platten');
    prod.updatePlan(p, gd, planId, { targets: [{ itemId: 'Desc_IronPlate_C', ratePerMin: 45 }] });
    const res = solveProduction(gd, p.productionPlans[planId]!);
    expect(checkPlan(p, gd, planId).map((f) => f.ruleId)).toContain('PROD-003');

    const out = prod.materializePlan(p, gd, factory.id, res.recipes.map((r) => ({ recipeId: r.recipeId, machines: r.machines })), { adjustClocks: true });
    // 45 Platten: 2,25 Konstruktoren → 3; 67,5 Barren: 2,25 Schmelzöfen → 3
    expect(out.created).toHaveLength(6);
    expect(Object.values(p.buildings).every((b) => b.placement === null)).toBe(true);
    let cmp = compareBalance(p, gd, factory.id, res);
    const plates = cmp.recipes.find((r) => r.recipeId === 'Recipe_IronPlate_C')!;
    expect(plates.soll).toBeCloseTo(2.25);
    expect(plates.geplant).toBeCloseTo(2.25);
    expect(plates.platziert).toBe(0);
    expect(checkPlan(p, gd, planId).map((f) => f.ruleId)).not.toContain('PROD-003');

    // Eine Maschine platzieren → erscheint als „platziert“, nicht angeschlossen
    const ctor = Object.values(p.buildings).find((b) => b.recipeId === 'Recipe_IronPlate_C')!;
    ops.placeBuilding(p, ctor.id, { floorId, x: 0, y: 0, zOffsetM: 0, rotationDeg: 0 });
    cmp = compareBalance(p, gd, factory.id, res);
    const row = cmp.recipes.find((r) => r.recipeId === 'Recipe_IronPlate_C')!;
    expect(row.platziert).toBeCloseTo(0.75);
    expect(row.angeschlossen).toBe(0);
    // Erneutes Anlegen erzeugt keine Duplikate
    expect(prod.materializePlan(p, gd, factory.id, res.recipes.map((r) => ({ recipeId: r.recipeId, machines: r.machines })), { adjustClocks: true }).created).toHaveLength(0);
  });

  it('Angeschlossen: Maschine mit verbundenen Ein- und Ausgängen', () => {
    const p = newProject();
    const { factory, floorId } = firstFactory(p);
    const at = (x: number) => ({ floorId, x, y: 0, zOffsetM: 0, rotationDeg: 0 });
    const s = ops.addBuilding(p, gd, { factoryId: factory.id, type: 'Build_SmelterMk1_C', recipeId: 'Recipe_IngotIron_C', placement: at(0) });
    const c = ops.addBuilding(p, gd, { factoryId: factory.id, type: 'Build_ConstructorMk1_C', recipeId: 'Recipe_IronPlate_C', placement: at(20) });
    const sink = ops.addBuilding(p, gd, { factoryId: factory.id, type: 'Build_StorageContainerMk1_C', placement: at(40) });
    const miner = ops.addBuilding(p, gd, { factoryId: factory.id, type: 'Build_StorageContainerMk1_C', placement: at(-20) });
    const tier = 'Build_ConveyorBeltMk1_C';
    ops.addLink(p, gd, { kind: 'belt', tier, from: { buildingId: miner, portId: 'belt-out-0' }, to: { buildingId: s, portId: 'belt-in-0' } });
    ops.addLink(p, gd, { kind: 'belt', tier, from: { buildingId: s, portId: 'belt-out-0' }, to: { buildingId: c, portId: 'belt-in-0' } });
    let cmp = compareBalance(p, gd, factory.id, null);
    expect(cmp.recipes.find((r) => r.recipeId === 'Recipe_IngotIron_C')!.angeschlossen).toBe(1);
    expect(cmp.recipes.find((r) => r.recipeId === 'Recipe_IronPlate_C')!.angeschlossen).toBe(0);
    ops.addLink(p, gd, { kind: 'belt', tier, from: { buildingId: c, portId: 'belt-out-0' }, to: { buildingId: sink, portId: 'belt-in-0' } });
    cmp = compareBalance(p, gd, factory.id, null);
    expect(cmp.recipes.find((r) => r.recipeId === 'Recipe_IronPlate_C')!.angeschlossen).toBe(1);
  });
});
