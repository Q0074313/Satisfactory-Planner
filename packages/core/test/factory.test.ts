import { describe, expect, it } from 'vitest';
import { checkFactory, floorAreaStats } from '../src/factory/checks.ts';
import { portDefs } from '../src/factory/ports.ts';
import { createValidator } from '../src/validation/engine.ts';
import * as ops from '../src/project/ops/factory.ts';
import { produce } from 'immer';
import { firstFactory, gameData, newProject } from './helpers.ts';

const rules = (fs: { ruleId: string }[]) => fs.map((f) => f.ruleId);

describe('Gebäudegrundrisse aus Spieldaten', () => {
  it('Konstruktor: 8 × 10 m, 6 m hoch (Docs mClearanceData)', () => {
    const c = gameData().building('Build_ConstructorMk1_C')!;
    expect(c.bounds!.maxX - c.bounds!.minX).toBe(8);
    expect(c.bounds!.maxY - c.bounds!.minY).toBe(10);
    expect(c.bounds!.maxZ - c.bounds!.minZ).toBe(6);
  });

  it('Anschlüsse: Anzahl laut Quelle, Lage als nicht verifiziert markiert', () => {
    const gd = gameData();
    const man = portDefs(gd.building('Build_ManufacturerMk1_C')!);
    expect(man.filter((p) => p.direction === 'in')).toHaveLength(4);
    expect(man.filter((p) => p.direction === 'out')).toHaveLength(1);
    const refinery = portDefs(gd.building('Build_OilRefinery_C')!);
    expect(refinery.map((p) => p.id).sort()).toEqual(['belt-in-0', 'belt-out-0', 'pipe-in-0', 'pipe-out-0']);
    expect(refinery.every((p) => p.positionVerified === false)).toBe(true);
    const junction = portDefs(gd.building('Build_PipelineJunction_Cross_C')!);
    expect(junction.filter((p) => p.direction === 'any')).toHaveLength(4);
  });
});

describe('Kollisionsprüfung', () => {
  function setup(x2: number, rot2 = 0, floor2?: 'upper') {
    const gd = gameData();
    const p = newProject();
    const { factory, floorId } = firstFactory(p);
    const upper = floor2 ? ops.addFloor(p, factory.id, { elevationM: 6 }) : floorId;
    const a = ops.addBuilding(p, gd, { factoryId: factory.id, type: 'Build_ConstructorMk1_C', recipeId: 'Recipe_IronPlate_C', placement: { floorId, x: 0, y: 0, zOffsetM: 0, rotationDeg: 0 } });
    const b = ops.addBuilding(p, gd, { factoryId: factory.id, type: 'Build_ConstructorMk1_C', recipeId: 'Recipe_IronPlate_C', placement: { floorId: upper, x: x2, y: 0, zOffsetM: 0, rotationDeg: rot2 } });
    return { gd, p, factory, a, b };
  }

  it('erkennt überlappende feste Kollisionsboxen als Fehler', () => {
    const { gd, p, factory } = setup(5);
    const f = checkFactory(p, gd, factory.id);
    const hit = f.find((x) => x.ruleId === 'FAB-001')!;
    expect(hit.severity).toBe('error');
    expect(hit.kind).toBe('game-rule');
    expect(hit.objects).toHaveLength(2);
    expect(hit.suggestion.length).toBeGreaterThan(0);
  });

  it('bündig nebeneinander (8 m Abstand bei 8 m Breite) ist keine Überschneidung', () => {
    const { gd, p, factory } = setup(8);
    expect(rules(checkFactory(p, gd, factory.id))).not.toContain('FAB-001');
  });

  it('berücksichtigt die Drehung: 90° gedreht und 8,5 m entfernt überschneidet sich', () => {
    // gedreht ist der zweite Konstruktor 10 m breit → halbe Breiten 4 + 5 = 9 m > 8,5 m
    const { gd, p, factory } = setup(8.5, 90);
    expect(rules(checkFactory(p, gd, factory.id))).toContain('FAB-001');
  });

  it('übereinanderliegende Stockwerke kollidieren nur bei Höhenüberschneidung', () => {
    // Konstruktor ist 6 m hoch, oberes Stockwerk bei 6 m → keine Überschneidung
    const { gd, p, factory } = setup(0, 0, 'upper');
    expect(rules(checkFactory(p, gd, factory.id))).not.toContain('FAB-001');
  });
});

describe('Flächen und Planungsabstände', () => {
  it('berechnet belegte Fläche (Vereinigung) und Baufläche je Stockwerk', () => {
    const gd = gameData();
    const p = newProject();
    const { factory, floorId } = firstFactory(p);
    const at = (x: number) => ({ floorId, x, y: 0, zOffsetM: 0, rotationDeg: 0 });
    ops.addBuilding(p, gd, { factoryId: factory.id, type: 'Build_ConstructorMk1_C', recipeId: 'Recipe_IronPlate_C', placement: at(0) });
    ops.addBuilding(p, gd, { factoryId: factory.id, type: 'Build_ConstructorMk1_C', recipeId: 'Recipe_IronPlate_C', placement: at(4) });
    ops.addArea(p, { factoryId: factory.id, floorId, kind: 'build-area', polygon: [{ x: -8, y: -8 }, { x: 8, y: -8 }, { x: 8, y: 8 }, { x: -8, y: 8 }] });
    const [stats] = floorAreaStats(p, gd, factory.id);
    // Vereinigung zweier 8×10-Rechtecke mit 4 m Versatz: 12 × 10 = 120 m²
    expect(stats!.occupiedM2).toBeCloseTo(120);
    expect(stats!.buildAreaM2).toBeCloseTo(256);
    expect(stats!.extent).toEqual({ widthM: 12, depthM: 10 });
  });

  it('meldet Gebäude außerhalb der Baufläche und im Planungsabstand als Empfehlung', () => {
    const gd = gameData();
    const p = newProject();
    const { factory, floorId } = firstFactory(p);
    ops.addBuilding(p, gd, { factoryId: factory.id, type: 'Build_ConstructorMk1_C', recipeId: 'Recipe_IronPlate_C', placement: { floorId, x: 0, y: 0, zOffsetM: 0, rotationDeg: 0 } });
    ops.addArea(p, { factoryId: factory.id, floorId, kind: 'build-area', polygon: [{ x: -2, y: -2 }, { x: 40, y: -2 }, { x: 40, y: 40 }, { x: -2, y: 40 }] });
    ops.addArea(p, { factoryId: factory.id, floorId, kind: 'clearance', polygon: [{ x: 3, y: -10 }, { x: 6, y: -10 }, { x: 6, y: 10 }, { x: 3, y: 10 }] });
    const f = checkFactory(p, gd, factory.id);
    const outside = f.find((x) => x.ruleId === 'FAB-003')!;
    const clear = f.find((x) => x.ruleId === 'FAB-004')!;
    expect(outside.kind).toBe('recommendation');
    expect(clear.kind).toBe('recommendation');
  });

  it('kennzeichnet nicht geprüfte Aspekte ausdrücklich', () => {
    const gd = gameData();
    const p = newProject();
    const { factory, floorId } = firstFactory(p);
    const a = ops.addBuilding(p, gd, { factoryId: factory.id, type: 'Build_ConstructorMk1_C', recipeId: 'Recipe_IronPlate_C', placement: { floorId, x: 0, y: 0, zOffsetM: 0, rotationDeg: 0 } });
    const b = ops.addBuilding(p, gd, { factoryId: factory.id, type: 'Build_ConstructorMk1_C', recipeId: 'Recipe_IronPlate_C', placement: { floorId, x: 20, y: 0, zOffsetM: 0, rotationDeg: 0 } });
    ops.addLink(p, gd, { kind: 'belt', tier: 'Build_ConveyorBeltMk1_C', from: { buildingId: a, portId: 'belt-out-0' }, to: { buildingId: b, portId: 'belt-in-0' } });
    const f = checkFactory(p, gd, factory.id);
    expect(f.filter((x) => x.kind === 'unchecked').map((x) => x.ruleId).sort()).toEqual(['FAB-005', 'FAB-006', 'FAB-015']);
  });
});

describe('Prüfmotor', () => {
  it('berechnet nur geänderte Fabriken neu', () => {
    const gd = gameData();
    let p = newProject();
    const f1 = firstFactory(p).factory.id;
    p = produce(p, (d) => {
      ops.addFactory(d, 'Fabrik 2');
    });
    const validate = createValidator();
    expect(validate(p, gd).recomputed).toHaveLength(2);
    expect(validate(p, gd).recomputed).toHaveLength(0);
    p = produce(p, (d) => {
      ops.addBuilding(d, gd, { factoryId: f1, type: 'Build_ConstructorMk1_C', placement: null });
    });
    const r = validate(p, gd);
    expect(r.recomputed).toEqual([`factory:${f1}`]);
    expect(r.findings.map((x) => x.ruleId)).toContain('FAB-008');
  });
});
