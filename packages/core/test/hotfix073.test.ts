/**
 * Hotfix 0.7.3: Bedarf je Eingang, Tausch von Absender und Empfänger,
 * weniger übereinanderliegende Leitungen, Logistikebenen im Auto-Layout.
 */
import { describe, expect, it } from 'vitest';
import { checkLayout, generateLayouts } from '../src/factory/autoLayout.ts';
import { computeFactoryFlow } from '../src/factory/flow.ts';
import { factoryInputs } from '../src/factory/inputs.ts';
import { ProjectSchema } from '../src/model/schema.ts';
import { solveProduction } from '../src/production/solver.ts';
import { buildExampleProject } from '../src/project/examples.ts';
import * as fac from '../src/project/ops/factory.ts';
import * as prodOps from '../src/project/ops/production.ts';
import * as trn from '../src/project/ops/transport.ts';
import { createValidator } from '../src/validation/engine.ts';
import { firstFactory, gameData, newProject } from './helpers.ts';

const gd = gameData();
const BASE = { datasetId: 'sf-1.2.4.0', gameVersion: '1.2.4.0' };

function planFor(itemId: string, ratePerMin: number) {
  const p = newProject();
  const { factory } = firstFactory(p);
  const id = prodOps.addPlan(p, factory.id, 'Test');
  prodOps.updatePlan(p, gd, id, { targets: [{ itemId, ratePerMin }] });
  return { p, factory, result: solveProduction(gd, p.productionPlans[id]!) };
}

describe('Hotfix 0.7.3: Bedarf je Eingang', () => {
  it('Großes Beispiel: Gegenstand und Bedarf je Eingang, auch ohne Aufträge', () => {
    const p = buildExampleProject(gd, 'large', BASE);
    const fid = Object.values(p.factories).find((f) => !f.blackbox)!.id;
    const byLabel = () => new Map(factoryInputs(p, gd, fid).map((x) => [p.buildings[x.buildingId]!.label, x]));
    const withOrders = byLabel();
    expect(withOrders.size).toBe(4);
    for (const x of withOrders.values()) {
      expect(x.directOrderIds).toHaveLength(1);
      expect(x.directPerMin).toBeCloseTo(x.requiredPerMin, 1);
    }
    for (const o of Object.keys(p.transportOrders)) delete p.transportOrders[o];
    const without = byLabel();
    const sum = new Map<string, number>();
    for (const x of without.values()) sum.set(x.itemId!, (sum.get(x.itemId!) ?? 0) + x.requiredPerMin);
    // Eisenerz verteilt sich auf zwei Eingänge, Kohle wird trotz gleicher Abnehmer (Gießereien) richtig erkannt
    expect(Object.fromEntries([...sum].map(([k, v]) => [k, Math.round(v)]))).toEqual({ Desc_Stone_C: 450, Desc_OreIron_C: 1200, Desc_Coal_C: 450 });
    for (const x of without.values()) expect(x.directOrderIds).toHaveLength(0);
  });
});

describe('Hotfix 0.7.3: Absender und Empfänger tauschen', () => {
  it('Bei zwei Fabriken tauscht die Auswahl der anderen Fabrik beide Seiten', () => {
    const p = newProject();
    const a = Object.keys(p.factories)[0]!;
    const b = fac.addFactory(p, 'B');
    const id = trn.addOrder(p, gd, { name: '', itemId: 'Desc_OreIron_C', ratePerMin: 60, fromFactoryId: a, toFactoryId: b, fromStationId: null, toStationId: null, trainIds: [], roundTripEstimateS: null });
    trn.updateOrder(p, gd, id, { fromFactoryId: b });
    expect([p.transportOrders[id]!.fromFactoryId, p.transportOrders[id]!.toFactoryId]).toEqual([b, a]);
    trn.updateOrder(p, gd, id, { toFactoryId: b });
    expect([p.transportOrders[id]!.fromFactoryId, p.transportOrders[id]!.toFactoryId]).toEqual([a, b]);
    trn.swapOrderEnds(p, gd, id);
    expect([p.transportOrders[id]!.fromFactoryId, p.transportOrders[id]!.toFactoryId]).toEqual([b, a]);
  });
});

describe('Hotfix 0.7.3: Leitungen übereinander und Logistikebenen', () => {
  const plans: [string, number][] = [
    ['Desc_ModularFrameHeavy_C', 5],
    ['Desc_Computer_C', 5],
    ['Desc_IronPlateReinforced_C', 10],
    ['Desc_Plastic_C', 60],
  ];
  it('Linien beidseitig: kaum noch Abzweige übereinander, weiterhin 0 Kreuzungen', () => {
    let stacked = 0;
    for (const [item, rate] of plans) {
      const { p, factory, result } = planFor(item, rate);
      for (const distribution of ['manifold', 'balanced'] as const)
        for (const d of generateLayouts(gd, result, { distribution, maxFloors: 3, beltTier: 'Build_ConveyorBeltMk4_C', pipeTier: 'Build_PipelineMK2_C' })) {
          const c = checkLayout(p, gd, factory.id, d, { x: 0, y: 0 });
          expect(c.crossings, `${item} ${distribution} ${d.variant}`).toBe(0);
          stacked += c.stacked;
        }
    }
    // vorher über 100 Paare in diesen Plänen
    expect(stacked).toBeLessThanOrEqual(6);
  });

  for (const [item, rate] of plans) {
    it(`${item} mit Logistikebene: Maschinen oben, Verteilung darunter, voll ausgelastet, 0 Kreuzungen`, () => {
      const { p, factory, result } = planFor(item, rate);
      for (const d of generateLayouts(gd, result, { logistics: true, maxFloors: 2 })) {
        expect(d.floorKinds.length % 2).toBe(0);
        d.floorKinds.forEach((k, i) => expect(k).toBe(i % 2 === 0 ? 'logistics' : 'production'));
        for (const b of d.buildings) expect(d.floorKinds[b.floor], `${b.role} ${d.variant}`).toBe(b.role === 'machine' ? 'production' : 'logistics');
        const c = checkLayout(p, gd, factory.id, d, { x: 0, y: 0 });
        expect(c.crossings, d.variant).toBe(0);
        expect(c.minUtilization, d.variant).toBeGreaterThan(0.999);
        expect(c.hardOverlaps + c.softOverlaps, d.variant).toBe(0);
      }
    });
  }

  for (const kind of ['medium', 'large'] as const) {
    it(`Beispielprojekt ${kind} mit Logistikebenen: gültig, ohne Fehler und Warnungen, Maschinen laufen voll`, () => {
      const p = buildExampleProject(gd, kind, BASE, { logistics: true });
      expect(() => ProjectSchema.parse(p)).not.toThrow();
      const findings = createValidator()(p, gd).findings.filter((f) => f.severity !== 'info');
      expect(findings.map((f) => `${f.ruleId} ${f.message}`)).toEqual([]);
      const main = Object.values(p.factories).find((f) => !f.blackbox)!;
      expect(main.floorIds.map((id) => p.floors[id]!.kind)).toContain('logistics');
      const flow = computeFactoryFlow(p, gd, main.id);
      for (const m of flow.machines.values()) expect(m.utilization).toBeGreaterThan(0.9999);
    });
  }
});
