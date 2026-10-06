import { describe, expect, it } from 'vitest';
import { buildFlowGraph, itemStages, layoutFlowGraph, sortItems } from '../src/production/graph.ts';
import { solveProduction } from '../src/production/solver.ts';
import type { ProductionPlan } from '../src/model/schema.ts';
import { gameData } from './helpers.ts';

const gd = gameData();

function plan(targets: { itemId: string; ratePerMin: number }[], enabledAlternates: string[] = []): ProductionPlan {
  return {
    id: 'plan',
    factoryId: 'f',
    name: 'Test',
    mode: 'target',
    targets,
    supplies: [],
    enabledAlternates,
    disabledRecipes: [],
    machineLimits: [],
    limitToExistingMachines: false,
    optimize: 'resources',
  };
}

describe('Produktionsgraph', () => {
  it('Schrauben: Erz → Barren → Stäbe → Schrauben, Kanten erhalten die Menge', () => {
    const res = solveProduction(gd, plan([{ itemId: 'Desc_IronScrew_C', ratePerMin: 40 }]));
    const g = buildFlowGraph(gd, res);
    const kinds = g.nodes.map((n) => n.kind);
    expect(kinds.filter((k) => k === 'recipe')).toHaveLength(3);
    expect(kinds).toContain('supply');
    expect(kinds).toContain('target');
    // Je Gegenstand: Summe der Kanten = Erzeugung
    for (const it of res.items) {
      const out = g.edges.filter((e) => e.itemId === it.itemId).reduce((s, e) => s + e.perMin, 0);
      expect(out).toBeCloseTo(it.produced + it.supplied, 6);
    }
    const lay = layoutFlowGraph(g);
    const layerOf = (kind: string, ref: string) => lay.nodes.find((n) => n.kind === kind && n.ref === ref)!.layer;
    expect(layerOf('supply', 'Desc_OreIron_C')).toBe(0);
    expect(layerOf('recipe', 'Recipe_IngotIron_C')).toBeLessThan(layerOf('recipe', 'Recipe_IronRod_C'));
    expect(layerOf('recipe', 'Recipe_IronRod_C')).toBeLessThan(layerOf('recipe', 'Recipe_Screw_C'));
    expect(layerOf('target', 'Desc_IronScrew_C')).toBe(lay.layers - 1);
  });

  it('Kreislauf (Recycelter Gummi ↔ Kunststoff) wird ohne Endlosschleife gelegt', () => {
    const res = solveProduction(
      gd,
      plan([{ itemId: 'Desc_Rubber_C', ratePerMin: 60 }], ['Recipe_Alternate_RecycledRubber_C', 'Recipe_Alternate_Plastic_1_C', 'Recipe_ResidualRubber_C']),
    );
    const lay = layoutFlowGraph(buildFlowGraph(gd, res));
    expect(lay.nodes.length).toBeGreaterThan(2);
    expect(lay.width).toBeGreaterThan(0);
  });

  it('Sortierung: alphabetisch, Rohstoff → Endprodukt und umgekehrt', () => {
    const res = solveProduction(gd, plan([{ itemId: 'Desc_IronScrew_C', ratePerMin: 40 }]));
    const st = itemStages(gd, res);
    const raw = sortItems(gd, res.items, 'raw-first', st).map((i) => i.itemId);
    expect(raw[0]).toBe('Desc_OreIron_C');
    expect(raw.at(-1)).toBe('Desc_IronScrew_C');
    const fin = sortItems(gd, res.items, 'final-first', st).map((i) => i.itemId);
    expect(fin[0]).toBe('Desc_IronScrew_C');
    const alpha = sortItems(gd, res.items, 'alpha').map((i) => gd.name(i.itemId));
    expect([...alpha].sort((a, b) => a.localeCompare(b, 'de'))).toEqual(alpha);
    const thr = sortItems(gd, res.items, 'throughput');
    expect(thr[0]!.throughput).toBeGreaterThanOrEqual(thr.at(-1)!.throughput);
  });
});
