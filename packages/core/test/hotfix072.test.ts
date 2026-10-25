/**
 * Hotfix 0.7.2: feste Höhenebenen im Auto-Layout, gesperrte Flächen,
 * Förderhöhe nur noch als Hinweis.
 */
import { describe, expect, it } from 'vitest';
import { generateLayouts } from '../src/factory/autoLayout.ts';
import { linkPath } from '../src/factory/linkPath.ts';
import { portDefs } from '../src/factory/ports.ts';
import { FAB_PIPE_HEAD_SHORT } from '../src/factory/rules.ts';
import { solveProduction } from '../src/production/solver.ts';
import { buildExampleProject } from '../src/project/examples.ts';
import * as ops from '../src/project/ops/factory.ts';
import * as prodOps from '../src/project/ops/production.ts';
import { firstFactory, gameData, newProject } from './helpers.ts';

const gd = gameData();

function resultFor(itemId: string, ratePerMin: number) {
  const p = newProject();
  const { factory } = firstFactory(p);
  const id = prodOps.addPlan(p, factory.id, 'Test');
  prodOps.updatePlan(p, gd, id, { targets: [{ itemId, ratePerMin }] });
  return solveProduction(gd, p.productionPlans[id]!);
}

describe('Hotfix 0.7.2: feste Höhenebenen', () => {
  for (const [item, rate] of [
    ['Desc_ModularFrameHeavy_C', 5],
    ['Desc_Computer_C', 5],
    ['Desc_Plastic_C', 60],
  ] as const) {
    it(`${item}: Leitungen und Knoten nur auf 1, 5 und 9 m (einseitig nur 1 und 5 m)`, () => {
      const result = resultFor(item, rate);
      for (const distribution of ['manifold', 'balanced'] as const) {
        for (const d of generateLayouts(gd, result, { distribution, crossings: 'avoid', maxFloors: 3 })) {
          const allowed = d.variant === 'rows' ? [1, 5] : [1, 5, 9];
          const heights = new Set<number>();
          for (const l of d.links) for (const w of l.waypoints) heights.add(Math.round(w.h * 100) / 100);
          for (const b of d.buildings) {
            if (b.role !== 'splitter' && b.role !== 'merger' && b.role !== 'junction') continue;
            heights.add(Math.round((b.h + portDefs(gd.building(b.type)!)[0]!.z) * 100) / 100);
          }
          expect([...heights].filter((h) => !allowed.includes(h)), `${distribution} ${d.variant}`).toEqual([]);
        }
      }
    });
  }

  it('Großes Beispiel: waagrechte Leitungen nur auf 1, 5 oder 9 m über dem Etagenboden', () => {
    const p = buildExampleProject(gd, 'large', { datasetId: 'sf-1.2.4.0', gameVersion: '1.2.4.0' });
    const levels = new Set<number>();
    for (const l of Object.values(p.links)) {
      const path = linkPath(p, gd, l);
      if (!path) continue;
      const floors = (p.factories[l.factoryId]?.floorIds ?? []).map((id) => p.floors[id]!);
      for (let i = 1; i < path.length; i++) {
        const a = path[i - 1]!;
        const b = path[i]!;
        if (Math.hypot(b.x - a.x, b.y - a.y) < 1e-6) continue;
        const fl = floors.filter((f) => f.elevationM <= a.z + 1e-6).sort((x, y) => y.elevationM - x.elevationM)[0]!;
        levels.add(Math.round((a.z - fl.elevationM) * 100) / 100);
      }
    }
    expect([...levels].sort((a, b) => a - b)).toEqual([1, 5, 9]);
  });
});

describe('Hotfix 0.7.2: gesperrte Flächen', () => {
  it('lassen sich nicht verschieben, verformen oder löschen; Entsperren entfernt das Feld', () => {
    const p = newProject();
    const { factory, floorId } = firstFactory(p);
    const id = ops.addArea(p, { factoryId: factory.id, floorId, kind: 'foundation', name: 'F', polygon: [{ x: 0, y: 0 }, { x: 8, y: 0 }, { x: 8, y: 8 }, { x: 0, y: 8 }] });
    ops.updateArea(p, id, { locked: true });
    expect(p.areas[id]!.locked).toBe(true);
    ops.moveAreas(p, [id], 8, 0);
    expect(p.areas[id]!.polygon[0]).toEqual({ x: 0, y: 0 });
    expect(() => ops.updateArea(p, id, { polygon: [{ x: 0, y: 0 }, { x: 16, y: 0 }, { x: 16, y: 8 }] })).toThrow();
    expect(() => ops.removeArea(p, id)).toThrow();
    ops.updateArea(p, id, { name: 'Umbenannt' });
    expect(p.areas[id]!.name).toBe('Umbenannt');
    ops.updateArea(p, id, { locked: false });
    expect('locked' in p.areas[id]!).toBe(false);
    ops.moveAreas(p, [id], 8, 0);
    expect(p.areas[id]!.polygon[0]).toEqual({ x: 8, y: 0 });
    ops.removeArea(p, id);
    expect(p.areas[id]).toBeUndefined();
  });
});

describe('Hotfix 0.7.2: Pumpen', () => {
  it('„Förderhöhe reicht nicht“ ist nur noch ein Hinweis', () => {
    expect(FAB_PIPE_HEAD_SHORT.severity).toBe('info');
  });
});
