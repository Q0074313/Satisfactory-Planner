/**
 * Neuerungen Version 0.5: Stromerzeugung, Vorschläge für Alternativrezepte.
 */
import { describe, expect, it } from 'vitest';
import type { ProductionPlan } from '../src/model/schema.ts';
import { machineRates } from '../src/production/machine.ts';
import { solveProduction } from '../src/production/solver.ts';
import { MAX_COMBINED, suggestAlternates } from '../src/production/suggest.ts';
import { diagnoseItem, diagnoseMachine } from '../src/factory/diagnose.ts';
import * as ops from '../src/project/ops/factory.ts';
import * as trn from '../src/project/ops/transport.ts';
import { estimateOrder, factoryTrade } from '../src/transport/estimate.ts';
import { checkTransport } from '../src/transport/checks.ts';
import { computeFactoryFlow } from '../src/factory/flow.ts';
import { buildExampleProject } from '../src/project/examples.ts';
import { createValidator } from '../src/validation/engine.ts';
import { ProjectSchema } from '../src/model/schema.ts';
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

const COAL = 'Power_Build_GeneratorCoal_C_Desc_Coal_C';
const FUEL = 'Power_Build_GeneratorFuel_C_Desc_LiquidFuel_C';
const URANIUM = 'Power_Build_GeneratorNuclear_C_Desc_NuclearFuelRod_C';

describe('Kraftwerksrezepte aus den Docs', () => {
  it('Verbrauch je Kraftwerk bei 100 % (Wiki-Werte)', () => {
    const per = (id: string) => Object.fromEntries(gd.recipe(id)!.inputs.map((a) => [a.item, a.amount]));
    expect(per(COAL)).toEqual({ Desc_Coal_C: 15, Desc_Water_C: 45 });
    expect(per(FUEL)).toEqual({ Desc_LiquidFuel_C: 20 });
    expect(per(URANIUM).Desc_NuclearFuelRod_C).toBeCloseTo(0.2, 9);
    expect(per(URANIUM).Desc_Water_C).toBeCloseTo(240, 9);
    expect(gd.recipe(URANIUM)!.outputs).toEqual([{ item: 'Desc_NuclearWaste_C', amount: 10 }]);
    expect(gd.recipe(COAL)!.generator?.powerMW).toBe(75);
  });

  it('Kraftwerk im Grundriss: Leistung und Brennstoff linear zum Takt', () => {
    const r = machineRates(gd, { type: 'Build_GeneratorCoal_C', recipeId: COAL, clock: 1.5, somersloops: 0 });
    expect(r.generatedMW).toBeCloseTo(112.5, 9);
    expect(r.inputs.find((i) => i.item === 'Desc_Coal_C')!.perMin).toBeCloseTo(22.5, 9);
  });
});

describe('Kraftwerke im Produktionsplan (vorgegebene Anzahl)', () => {
  it('ohne Vorgabe werden keine Kraftwerke eingeplant', () => {
    const r = solveProduction(gd, plan({ targets: [{ itemId: 'Desc_IronPlate_C', ratePerMin: 60 }] }));
    expect(r.recipes.some((x) => gd.recipe(x.recipeId)?.generator)).toBe(false);
    expect(r.generatedMW).toBe(0);
  });

  it('16 Kohlegeneratoren: 240 Kohle und 720 m³ Wasser pro Minute, 1200 MW; Maschinenstrom wird nicht gegengerechnet', () => {
    const r = solveProduction(gd, plan({ power: { generators: [{ recipeId: COAL, count: 16 }] } }));
    expect(r.status).toBe('optimal');
    expect(r.recipes.find((x) => x.recipeId === COAL)!.machines).toBeCloseTo(16, 6);
    expect(r.generatedMW).toBeCloseTo(1200, 6);
    expect(r.items.find((i) => i.itemId === 'Desc_Coal_C')!.supplied).toBeCloseTo(240, 6);
    expect(r.items.find((i) => i.itemId === 'Desc_Water_C')!.supplied).toBeCloseTo(720, 6);
    // Mit Produktionsziel: keine zusätzlichen Kraftwerke für den Bedarf der Maschinen
    const r2 = solveProduction(gd, plan({ targets: [{ itemId: 'Desc_IronPlate_C', ratePerMin: 60 }], power: { generators: [{ recipeId: COAL, count: 16 }] } }));
    expect(r2.recipes.find((x) => x.recipeId === COAL)!.machines).toBeCloseTo(16, 6);
  });

  it('anderer Brennstoff: Zulieferung wird geplant (Treibstoff aus Rohöl)', () => {
    const r = solveProduction(gd, plan({ power: { generators: [{ recipeId: FUEL, count: 2 }] } }));
    expect(r.items.find((i) => i.itemId === 'Desc_LiquidFuel_C')!.produced).toBeCloseTo(40, 6);
    expect(r.items.find((i) => i.itemId === 'Desc_LiquidOil_C')!.supplied).toBeGreaterThan(0);
  });

  it('Atommüll erscheint als Überschuss', () => {
    const r = solveProduction(gd, plan({ power: { generators: [{ recipeId: URANIUM, count: 1 }] } }));
    expect(r.items.find((i) => i.itemId === 'Desc_NuclearWaste_C')!.surplus).toBeCloseTo(10, 6);
  });

  it('begrenzter Brennstoff: Engpass statt unlösbar', () => {
    const r = solveProduction(gd, plan({ mode: 'maximize', targets: [{ itemId: 'Desc_IronIngot_C', ratePerMin: 1 }], supplies: [{ itemId: 'Desc_OreIron_C', maxPerMin: 30, origin: 'local' }, { itemId: 'Desc_Coal_C', maxPerMin: 30, origin: 'local' }], power: { generators: [{ recipeId: COAL, count: 4 }] } }));
    expect(r.status).toBe('optimal');
    expect(r.recipes.find((x) => x.recipeId === COAL)!.machines).toBeCloseTo(2, 6);
    expect(r.bottlenecks.some((x) => x.id === COAL)).toBe(true);
  });
});

describe('Vorschläge für Alternativrezepte', () => {
  it('schlägt Rezepte vor, die gewichtete Rohstoffe sparen, mit Einsparung je Rohstoff', () => {
    const p = plan({ targets: [{ itemId: 'Desc_IronPlateReinforced_C', ratePerMin: 10 }] });
    const s = suggestAlternates(gd, p);
    expect(s.single.length).toBeGreaterThan(0);
    const best = s.single[0]!;
    expect(best.gainPct).toBeGreaterThan(0.5);
    expect(best.recipeIds.every((id) => gd.recipe(id)!.alternate)).toBe(true);
    // Übernommen ist der Vorschlag tatsächlich günstiger
    const before = solveProduction(gd, p);
    const after = solveProduction(gd, { ...p, enabledAlternates: best.recipeIds });
    const ore = (r: typeof before) => r.items.find((i) => i.itemId === 'Desc_OreIron_C')?.supplied ?? 0;
    expect(ore(after)).toBeLessThan(ore(before));
    expect(best.resources.some((d) => d.itemId === 'Desc_OreIron_C' && d.delta < 0)).toBe(true);
  });

  it('Kombination bleibt kurz (höchstens 4 Rezepte) und ist besser als jeder Einzelvorschlag', () => {
    const p = plan({ targets: [{ itemId: 'Desc_Computer_C', ratePerMin: 5 }, { itemId: 'Desc_ModularFrameHeavy_C', ratePerMin: 2 }] });
    const s = suggestAlternates(gd, p);
    expect(s.combined).not.toBeNull();
    expect(s.combined!.recipeIds.length).toBeGreaterThan(1);
    expect(s.combined!.recipeIds.length).toBeLessThanOrEqual(MAX_COMBINED);
    expect(s.combined!.gainPct).toBeGreaterThan(s.single[0]!.gainPct);
  });

  it('keine Vorschläge, wenn alle Alternativen schon freigeschaltet sind', () => {
    const all = Object.values(gd.data.recipes).filter((r) => r.alternate).map((r) => r.id);
    const s = suggestAlternates(gd, plan({ targets: [{ itemId: 'Desc_IronPlateReinforced_C', ratePerMin: 10 }], enabledAlternates: all }));
    expect(s.single).toEqual([]);
    expect(s.combined).toBeNull();
  });
});

/** Kleine Fabrik; Gebäude stehen nebeneinander. */
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
  const ore = (purity: 'impure' | 'normal' | 'pure', type = 'Build_MinerMk1_C') => add(type, { extraction: { itemId: 'Desc_OreIron_C', purity } });
  return { p, f, add, belt, ore };
}
const texts = (l: { text: string }[]) => l.map((x) => x.text).join('\n');

describe('Etwas stimmt nicht: geführte Fehlersuche', () => {
  it('fehlende Zuleitung: Ursache und fehlende Quelle in der Fabrik', () => {
    const { p, add } = factory();
    const c = add('Build_ConstructorMk1_C', { recipeId: 'Recipe_IronPlate_C' });
    const sink = add('Build_ResourceSink_C');
    ops.addLink(p, gd, { kind: 'belt', tier: 'Build_ConveyorBeltMk1_C', from: { buildingId: c, portId: 'belt-out-0' }, to: { buildingId: sink, portId: 'belt-in-0' } });
    const d = diagnoseMachine(p, gd, c);
    expect(d[0]!.level).toBe('error');
    expect(texts(d)).toMatch(/Keine Leitung bringt Eisenbarren/);
    expect(texts(d)).toMatch(/Keine Maschine in der Fabrik erzeugt Eisenbarren/);
  });

  it('nicht angeschlossener Ausgang staut die Maschine', () => {
    const { add, belt, ore, p } = factory();
    const m = ore('normal');
    const s = add('Build_SmelterMk1_C', { recipeId: 'Recipe_IngotIron_C' });
    belt(m, 'belt-out-0', s, 'belt-in-0');
    const d = diagnoseMachine(p, gd, s);
    expect(texts(d)).toMatch(/Ausgang Eisenbarren ist nicht angeschlossen/);
  });

  it('zu wenig Quelle: unreiner Miner (30/min) für zwei Schmelzöfen (je 30/min) – Rückverfolgung bis zur Quelle', () => {
    const { add, belt, ore, p } = factory();
    const m = ore('impure');
    const s = add('Build_SmelterMk1_C', { recipeId: 'Recipe_IngotIron_C' });
    const c = add('Build_ConstructorMk1_C', { recipeId: 'Recipe_IronPlate_C' });
    const sink = add('Build_ResourceSink_C');
    belt(m, 'belt-out-0', s, 'belt-in-0');
    belt(s, 'belt-out-0', c, 'belt-in-0');
    belt(c, 'belt-out-0', sink, 'belt-in-0');
    // Konstruktor braucht 30 Barren, Schmelzofen liefert 30 – voll; dann Miner halbieren über zweiten Schmelzofen
    const s2 = add('Build_SmelterMk1_C', { recipeId: 'Recipe_IngotIron_C' });
    const sp = add('Build_ConveyorAttachmentSplitter_C');
    // Miner → Splitter → beide Schmelzöfen
    ops.removeLinks(p, Object.values(p.links).filter((l) => l.from.buildingId === m).map((l) => l.id));
    belt(m, 'belt-out-0', sp, 'belt-in-0');
    belt(sp, 'belt-out-0', s, 'belt-in-0');
    belt(sp, 'belt-out-1', s2, 'belt-in-0');
    belt(s2, 'belt-out-0', add('Build_ResourceSink_C'), 'belt-in-0');
    // Das Modell gibt das Erz einem Schmelzofen; der andere steht
    const d = diagnoseItem(p, gd, p.buildings[c]!.factoryId, 'Desc_OreIron_C');
    expect(texts(d)).toMatch(/Schmelzofen erhält 0 von 30/);
    expect(texts(d)).toMatch(/Die Quellen erzeugen 30 \/min, ihre 2 Abnehmer brauchen zusammen 60 \/min/);
    expect(d.some((x) => x.objects.some((o) => o.id === m))).toBe(true);
    // Der Konstruktor ist voll versorgt
    expect(texts(diagnoseItem(p, gd, p.buildings[c]!.factoryId, 'Desc_IronIngot_C'))).toMatch(/erhalten laut Planer ihre volle Menge/);
  });

  it('volle Leitung wird als Ursache genannt', () => {
    const { add, belt, ore, p } = factory();
    const m = ore('pure', 'Build_MinerMk2_C'); // 240/min
    const sp = add('Build_ConveyorAttachmentSplitter_C');
    belt(m, 'belt-out-0', sp, 'belt-in-0', 'Build_ConveyorBeltMk1_C'); // 60/min
    const smelters = [0, 1, 2].map(() => add('Build_SmelterMk1_C', { recipeId: 'Recipe_IngotIron_C' }));
    smelters.forEach((s, i) => {
      belt(sp, `belt-out-${i}`, s, 'belt-in-0', 'Build_ConveyorBeltMk5_C');
      belt(s, 'belt-out-0', add('Build_ResourceSink_C'), 'belt-in-0', 'Build_ConveyorBeltMk5_C');
    });
    const d = diagnoseItem(p, gd, p.buildings[m]!.factoryId, 'Desc_OreIron_C');
    expect(texts(d)).toMatch(/Leitung .* ist voll: 60 Kapazität, gebraucht würden 90/);
  });

  it('alles in Ordnung: Meldung „läuft mit 100 %“', () => {
    const { add, belt, ore, p } = factory();
    const m = ore('normal');
    const s = add('Build_SmelterMk1_C', { recipeId: 'Recipe_IngotIron_C' });
    const sink = add('Build_ResourceSink_C');
    belt(m, 'belt-out-0', s, 'belt-in-0');
    belt(s, 'belt-out-0', sink, 'belt-in-0');
    const d = diagnoseMachine(p, gd, s);
    expect(d).toHaveLength(1);
    expect(d[0]!.level).toBe('ok');
  });
});

describe('Drohnen als Transportmittel', () => {
  function twoFactories() {
    const { p, f, add, belt } = factory();
    const other = ops.addFactory(p, 'Lieferant');
    const floor = p.factories[other]!.floorIds[0]!;
    const port = (factoryId: string, floorId: string, mode: 'load' | 'unload') =>
      ops.addBuilding(p, gd, { factoryId, type: 'Build_DroneStation_C', placement: { floorId, x: 200, y: 0, zOffsetM: 0, rotationDeg: 0 }, transfer: { mode, stationId: null } });
    return { p, f, add, belt, other, floor, port };
  }

  it('Umlauf, Laderaum und Batterieverbrauch aus Docs und Wiki', () => {
    const { p, f, other } = twoFactories();
    const id = trn.addOrder(p, gd, { name: '', itemId: 'Desc_IronPlate_C', ratePerMin: 100, fromFactoryId: other, toFactoryId: f.id, fromStationId: null, toStationId: null, trainIds: [], roundTripEstimateS: null, mode: 'drone' });
    trn.updateOrder(p, gd, id, { drone: { count: 1, distanceM: 1000, fuelId: 'Desc_Battery_C' } });
    const e = estimateOrder(p, gd, p.transportOrders[id]!).drone!;
    // 2 × (1000 m / 75 m/s + 2 × 51 s)
    expect(e.cycleS).toBeCloseTo(2 * (1000 / 75 + 102), 6);
    expect(e.capacityPerTrip).toBe(9 * gd.item('Desc_IronPlate_C')!.stackSize);
    // (24 000 MJ + 6 MJ/m × 1000 m) / 6000 MJ = 5 Batterien
    expect(e.fuelPerTrip).toBeCloseTo(5, 9);
    expect(e.fuelPerMin).toBeCloseTo((5 * 60) / e.cycleS!, 9);
    // Brennstoff zählt beim Absender
    const row = factoryTrade(p, gd, other).find((r) => r.itemId === 'Desc_Battery_C')!;
    expect(row.transportFuel).toBeCloseTo(e.fuelPerMin, 9);
    expect(row.fuelGap).toBeCloseTo(e.fuelPerMin, 9);
  });

  it('Befunde: Flüssigkeit, fehlende Häfen, fehlender Brennstoff', () => {
    const { p, f, other, floor, port } = twoFactories();
    const liquid = trn.addOrder(p, gd, { name: '', itemId: 'Desc_Water_C', ratePerMin: 10, fromFactoryId: other, toFactoryId: f.id, fromStationId: null, toStationId: null, trainIds: [], roundTripEstimateS: null, mode: 'drone' });
    let ids = checkTransport(p, gd).map((x) => x.ruleId);
    expect(ids).toContain('TRN-011');
    expect(ids.filter((x) => x === 'TRN-015')).toHaveLength(2);
    expect(ids).toContain('TRN-017');
    trn.removeOrders(p, [liquid]);
    trn.addOrder(p, gd, { name: '', itemId: 'Desc_IronPlate_C', ratePerMin: 10, fromFactoryId: other, toFactoryId: f.id, fromStationId: null, toStationId: null, trainIds: [], roundTripEstimateS: null, mode: 'drone' });
    port(other, floor, 'load');
    port(f.id, f.floorIds[0]!, 'unload');
    ids = checkTransport(p, gd).map((x) => x.ruleId);
    expect(ids).not.toContain('TRN-015');
    expect(ids).not.toContain('TRN-011');
  });

  it('entladender Drohnenhafen speist das Durchsatzmodell der Empfängerfabrik', () => {
    const { p, f, add, belt, other, port } = twoFactories();
    trn.addOrder(p, gd, { name: '', itemId: 'Desc_IronIngot_C', ratePerMin: 15, fromFactoryId: other, toFactoryId: f.id, fromStationId: null, toStationId: null, trainIds: [], roundTripEstimateS: null, mode: 'drone' });
    const dp = port(f.id, f.floorIds[0]!, 'unload');
    const c = add('Build_ConstructorMk1_C', { recipeId: 'Recipe_IronPlate_C' });
    belt(dp, 'belt-out-0', c, 'belt-in-0');
    belt(c, 'belt-out-0', add('Build_ResourceSink_C'), 'belt-in-0');
    const flow = computeFactoryFlow(p, gd, f.id);
    expect(flow.machines.get(c)!.utilization).toBeCloseTo(0.5, 6);
  });
});

describe('Beispielprojekte', () => {
  for (const kind of ['simple', 'complex'] as const) {
    it(`${kind}: gültig, ohne Fehler und Warnungen, alle Maschinen voll ausgelastet, Pläne erreichbar`, () => {
      const p = buildExampleProject(gd, kind, { datasetId: 'sf-1.2.5.1', gameVersion: '1.2.5.1' });
      expect(() => ProjectSchema.parse(p)).not.toThrow();
      const findings = createValidator()(p, gd).findings.filter((f) => f.severity !== 'info');
      expect(findings.map((f) => `${f.ruleId} ${f.message}`)).toEqual([]);
      for (const fid of Object.keys(p.factories)) {
        const flow = computeFactoryFlow(p, gd, fid);
        expect(flow.machines.size).toBeGreaterThan(0);
        for (const m of flow.machines.values()) expect(m.utilization).toBeCloseTo(1, 6);
      }
      for (const plan of Object.values(p.productionPlans)) {
        const r = solveProduction(gd, plan);
        expect(r.items.every((i) => i.shortfall < 1e-6)).toBe(true);
      }
    });
  }
});
