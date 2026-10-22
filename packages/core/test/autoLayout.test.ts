import { describe, expect, it } from 'vitest';
import { applyLayout, checkLayout, freeLayoutOrigin, generateLayouts, type AutoLayoutOptions } from '../src/factory/autoLayout.ts';
import { solveProduction } from '../src/production/solver.ts';
import { computeFactoryFlow } from '../src/factory/flow.ts';
import { ProjectSchema } from '../src/model/schema.ts';
import { buildExampleProject } from '../src/project/examples.ts';
import { createValidator } from '../src/validation/engine.ts';
import * as prodOps from '../src/project/ops/production.ts';
import { firstFactory, gameData, newProject } from './helpers.ts';

const gd = gameData();

function planFor(targets: { itemId: string; ratePerMin: number }[], alternates: string[] = []) {
  const p = newProject();
  const { factory } = firstFactory(p);
  const id = prodOps.addPlan(p, factory.id, 'Test');
  prodOps.updatePlan(p, gd, id, { targets, enabledAlternates: alternates });
  const plan = p.productionPlans[id]!;
  return { p, factory, plan, result: solveProduction(gd, plan) };
}

describe('Auto-Layout', () => {
  const cases: [string, { itemId: string; ratePerMin: number }[]][] = [
    ['Verstärkte Eisenplatten', [{ itemId: 'Desc_IronPlateReinforced_C', ratePerMin: 10 }]],
    ['Kunststoff (Raffinerie, Rohre, Nebenprodukt)', [{ itemId: 'Desc_Plastic_C', ratePerMin: 60 }]],
    ['Modularer Rahmen', [{ itemId: 'Desc_ModularFrame_C', ratePerMin: 4 }]],
  ];
  for (const [name, targets] of cases) {
    for (const distribution of ['manifold', 'balanced'] as const) {
      it(`${name} (${distribution}): alle Varianten laufen voll, ohne feste Überschneidungen`, () => {
        const { p, factory, result } = planFor(targets);
        expect(result.status).toBe('optimal');
        const drafts = generateLayouts(gd, result, { distribution, maxFloors: 2 } satisfies Partial<AutoLayoutOptions>);
        expect(drafts.map((d) => d.variant)).toEqual(expect.arrayContaining(['rows', 'compact']));
        for (const d of drafts) {
          const origin = freeLayoutOrigin(p, gd, factory.id);
          const c = checkLayout(p, gd, factory.id, d, origin);
          expect(c.machines, d.variant).toBe(result.recipes.reduce((s, r) => s + r.machinesCeil, 0));
          expect(c.minUtilization, d.variant).toBeGreaterThan(0.999);
          expect(c.hardOverlaps, d.variant).toBe(0);
          expect(c.softOverlaps, d.variant).toBe(0);
        }
      });
    }
  }

  it('Fläche begrenzt die Linienlänge; zu kleine Fläche wird gemeldet', () => {
    const { result } = planFor([{ itemId: 'Desc_IronPlateReinforced_C', ratePerMin: 30 }]);
    const wide = generateLayouts(gd, result, {}).find((d) => d.variant === 'rows')!;
    const narrow = generateLayouts(gd, result, { maxWidthM: 80 }).find((d) => d.variant === 'rows')!;
    expect(narrow.width).toBeLessThanOrEqual(80);
    expect(narrow.counts.lines).toBeGreaterThan(wide.counts.lines);
    const tiny = generateLayouts(gd, result, { maxWidthM: 40, maxDepthM: 40 });
    expect(tiny.every((d) => !d.fits)).toBe(true);
  });

  it('Bandstufe begrenzt den Durchsatz je Linie', () => {
    const { result } = planFor([{ itemId: 'Desc_IronPlate_C', ratePerMin: 300 }]);
    const mk1 = generateLayouts(gd, result, { beltTier: 'Build_ConveyorBeltMk1_C' })[0]!;
    expect(mk1.links.every((l) => l.kind !== 'belt' || l.perMin <= 60 + 1e-6)).toBe(true);
    expect(mk1.links.every((l) => l.tier === 'Build_ConveyorBeltMk1_C' || l.kind === 'pipe')).toBe(true);
  });

  it('Übernehmen: nutzt nicht platzierte Maschinen, legt Etagen und Fundamente an', () => {
    const { p, factory, plan, result } = planFor([{ itemId: 'Desc_ModularFrame_C', ratePerMin: 4 }]);
    prodOps.materializePlan(p, gd, factory.id, result.recipes.map((r) => ({ recipeId: r.recipeId, machines: r.machines })), { adjustClocks: true });
    const before = Object.keys(p.buildings).length;
    const d = generateLayouts(gd, result, { maxFloors: 3 }).find((x) => x.variant === 'floors')!;
    expect(d).toBeTruthy();
    const r = applyLayout(p, gd, factory.id, d, { x: 0, y: 0 }, { foundations: true });
    expect(p.factories[factory.id]!.floorIds.length).toBe(d.floorHeights.length);
    expect(r.floorIds.length).toBe(d.floorHeights.length - 1);
    const machines = Object.values(p.buildings).filter((b) => b.factoryId === factory.id && b.recipeId);
    expect(machines.every((b) => b.placement)).toBe(true);
    expect(Object.keys(p.buildings).length - before).toBe(d.buildings.length - d.counts.machines);
    expect(Object.values(p.areas).filter((a) => a.kind === 'foundation').length).toBe(d.floorHeights.length);
    expect(plan.id).toBeTruthy();
  });
});

describe('Hotfix 0.7.1: Hauptbus, Kreuzungen, Raster, Beispiele', () => {
  const plans: [string, number, string[]][] = [
    ['Desc_ModularFrameHeavy_C', 5, []],
    ['Desc_Computer_C', 5, []],
    ['Desc_Rubber_C', 300, ['Recipe_Alternate_RecycledRubber_C', 'Recipe_Alternate_Plastic_1_C', 'Recipe_ResidualRubber_C']],
    ['Desc_IronScrew_C', 1500, []],
  ];
  for (const [item, rate, alts] of plans) {
    it(`${item}: „Kreuzungen vermeiden“ – keine Leitungen auf gleicher Höhe gekreuzt, alles voll ausgelastet`, () => {
      const { p, factory, result } = planFor([{ itemId: item, ratePerMin: rate }], alts);
      for (const distribution of ['manifold', 'balanced'] as const) {
        const drafts = generateLayouts(gd, result, { distribution, crossings: 'avoid', maxFloors: 3, beltTier: 'Build_ConveyorBeltMk4_C', pipeTier: 'Build_PipelineMK2_C' });
        expect(drafts.length).toBe(3);
        for (const d of drafts) {
          const c = checkLayout(p, gd, factory.id, d, { x: 0, y: 0 });
          expect(c.crossings, `${distribution} ${d.variant}`).toBe(0);
          expect(c.minUtilization, `${distribution} ${d.variant}`).toBeGreaterThan(0.999);
          expect(c.hardOverlaps + c.softOverlaps, `${distribution} ${d.variant}`).toBe(0);
        }
      }
    });
  }

  it('„Kreuzungen erlauben“: alles auf Anschlusshöhe, ohne Lifte', () => {
    const { p, factory, result } = planFor([{ itemId: 'Desc_Computer_C', ratePerMin: 5 }]);
    const d = generateLayouts(gd, result, { crossings: 'allow' })[0]!;
    expect(d.buildings.every((b) => Math.abs(b.h) < 1.1)).toBe(true);
    const c = checkLayout(p, gd, factory.id, d, { x: 0, y: 0 });
    expect(c.liftCount).toBe(0);
    expect(c.minUtilization).toBeGreaterThan(0.999);
  });

  it('Raster: Maße in ganzen Fundamenten, Maschinen mittig in Rasterfeldern, Ein- und Ausgänge am Ende einer Busspur', () => {
    const { result } = planFor([{ itemId: 'Desc_IronPlateReinforced_C', ratePerMin: 10 }]);
    for (const d of generateLayouts(gd, result, { maxFloors: 2 })) {
      expect(d.width % 8).toBe(0);
      expect(d.depth % 8).toBe(0);
      for (const b of d.buildings.filter((x) => x.role === 'machine')) {
        const bb = gd.building(b.type)!.bounds!;
        // Mitte des Umrisses auf dem 2-m-Raster (Feldmitte bei Feldbreiten von 4 bzw. 8 m), Oberkante auf dem 4-m-Raster
        expect((((b.x + (bb.minX + bb.maxX) / 2) % 2) + 2) % 2, d.variant).toBeLessThan(1e-6);
        expect((((b.y + bb.minY) % 4) + 4) % 4, d.variant).toBeLessThan(1e-6);
      }
      // Jeder Eingang speist genau eine Spur (eine Leitung ab dem Eingang)
      for (const t of d.terminals.filter((x) => x.dir === 'in')) expect(d.links.filter((l) => l.from.key === t.key)).toHaveLength(1);
    }
  });

  for (const kind of ['medium', 'large'] as const) {
    it(`Beispielprojekt ${kind}: gültig, ohne Fehler und Warnungen, Maschinen laufen voll`, () => {
      const p = buildExampleProject(gd, kind, { datasetId: 'sf-1.2.4.0', gameVersion: '1.2.4.0' });
      expect(() => ProjectSchema.parse(p)).not.toThrow();
      const findings = createValidator()(p, gd).findings.filter((f) => f.severity !== 'info');
      expect(findings.map((f) => `${f.ruleId} ${f.message}`)).toEqual([]);
      const main = Object.values(p.factories).find((f) => !f.blackbox)!;
      const flow = computeFactoryFlow(p, gd, main.id);
      expect(flow.machines.size).toBeGreaterThan(kind === 'large' ? 140 : 20);
      // Takte sind auf 6 Stellen gerundet: kleine Restabweichung zulässig
      for (const m of flow.machines.values()) expect(m.utilization).toBeGreaterThan(0.9999);
      expect(Object.values(p.factories).some((f) => f.blackbox)).toBe(true);
    });
  }
});
