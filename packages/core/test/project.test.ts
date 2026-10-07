import { describe, expect, it } from 'vitest';
import { PROJECT_FORMAT_VERSION, ProjectSchema } from '../src/model/schema.ts';
import { exportProject, importProject, ImportError } from '../src/project/serialize.ts';
import { migrateProject } from '../src/project/migrations.ts';
import * as ops from '../src/project/ops/factory.ts';
import { OpError } from '../src/project/errors.ts';
import { firstFactory, gameData, newProject } from './helpers.ts';

describe('Projekt anlegen', () => {
  it('erzeugt ein schemakonformes Projekt mit Fabrik und Erdgeschoss', () => {
    const p = newProject();
    expect(ProjectSchema.safeParse(p).success).toBe(true);
    const { factory } = firstFactory(p);
    expect(factory.floorIds).toHaveLength(1);
    expect(p.gameData.datasetId).toBe('sf-1.2.4.0');
  });
});

describe('Speichern und Laden (Export/Import)', () => {
  it('liefert nach Export und Import ein identisches Projekt', () => {
    const gd = gameData();
    const p = newProject();
    const { factory, floorId } = firstFactory(p);
    const a = ops.addBuilding(p, gd, {
      factoryId: factory.id,
      type: 'Build_ConstructorMk1_C',
      recipeId: 'Recipe_IronPlate_C',
      placement: { floorId, x: 0, y: 0, zOffsetM: 0, rotationDeg: 0 },
    });
    const b = ops.addBuilding(p, gd, {
      factoryId: factory.id,
      type: 'Build_ConstructorMk1_C',
      recipeId: 'Recipe_IronPlate_C',
      placement: { floorId, x: 16, y: 0, zOffsetM: 0, rotationDeg: 90 },
    });
    ops.addBuilding(p, gd, { factoryId: factory.id, type: 'Build_AssemblerMk1_C', placement: null });
    ops.addLink(p, gd, {
      kind: 'belt',
      tier: 'Build_ConveyorBeltMk1_C',
      from: { buildingId: a, portId: 'belt-out-0' },
      to: { buildingId: b, portId: 'belt-in-0' },
      waypoints: [{ x: 4, y: 8, z: 1 }],
    });
    ops.addArea(p, { factoryId: factory.id, floorId, kind: 'build-area', polygon: [{ x: -40, y: -40 }, { x: 40, y: -40 }, { x: 40, y: 40 }, { x: -40, y: 40 }] });

    const json = exportProject(p);
    const parsed = JSON.parse(json) as { kind: string; formatVersion: number };
    expect(parsed.kind).toBe('satis-planner-project');
    expect(parsed.formatVersion).toBe(PROJECT_FORMAT_VERSION);

    const result = importProject(json);
    expect(result.project).toEqual(p);
    expect(result.repairs).toEqual([]);
  });

  it('weist ungültiges JSON und fremde Dateien verständlich ab', () => {
    expect(() => importProject('{kaputt')).toThrow(ImportError);
    expect(() => importProject(JSON.stringify({ kind: 'etwas-anderes' }))).toThrow(/Unbekannter Dateityp/);
    expect(() => importProject(JSON.stringify({ kind: 'satis-planner-project', project: { formatVersion: 1 } }))).toThrow(
      /nicht dem erwarteten Format/,
    );
  });

  it('lehnt Projekte aus neueren Formatversionen ab', () => {
    const p = { ...newProject(), formatVersion: PROJECT_FORMAT_VERSION + 1 };
    expect(() => importProject(p)).toThrow(/neueren Version/);
  });

  it('bereinigt ungültige Verweise beim Import', () => {
    const p = newProject();
    p.links['lnk_x'] = {
      id: 'lnk_x',
      factoryId: firstFactory(p).factory.id,
      kind: 'belt',
      tier: 'Build_ConveyorBeltMk1_C',
      from: { buildingId: 'fehlt', portId: 'belt-out-0' },
      to: { buildingId: 'fehlt2', portId: 'belt-in-0' },
      waypoints: [],
      routing: 'direct',
    };
    const r = importProject(p);
    expect(r.project.links).toEqual({});
    expect(r.repairs).toHaveLength(1);
  });
});

describe('Formatmigrationen', () => {
  it('führt eine Migrationskette in Reihenfolge aus', () => {
    const steps = [
      { from: 1, description: 'Feld umbenannt', migrate: (r: Record<string, unknown>) => ({ ...r, title: r.name }) },
      { from: 2, description: 'Feld ergänzt', migrate: (r: Record<string, unknown>) => ({ ...r, extra: true }) },
    ];
    const { value, steps: applied } = migrateProject({ formatVersion: 1, name: 'A' }, steps, 3);
    expect(value).toEqual({ formatVersion: 3, name: 'A', title: 'A', extra: true });
    expect(applied).toEqual(['1 → 2: Feld umbenannt', '2 → 3: Feld ergänzt']);
  });

  it('meldet fehlende Migrationsschritte', () => {
    expect(() => migrateProject({ formatVersion: 1 }, [], 2)).toThrow(/Keine Migration/);
  });
});

describe('Fabrikoperationen', () => {
  it('neue Ebenen: Produktion 18 m, Logistik 6 m, dazwischen 2 m Decke', () => {
    const p = newProject();
    const { factory } = firstFactory(p);
    const eg = p.floors[factory.floorIds[0]!]!;
    expect([eg.elevationM, eg.heightM]).toEqual([0, 18]);
    const log = ops.addFloor(p, factory.id, { kind: 'logistics' });
    expect([p.floors[log]!.elevationM, p.floors[log]!.heightM]).toEqual([20, 6]);
    const up = ops.addFloor(p, factory.id);
    expect([p.floors[up]!.elevationM, p.floors[up]!.heightM]).toEqual([28, 18]);
  });

  it('Stockwerk entfernen hebt Platzierungen auf, Maschinen bleiben geplant', () => {
    const gd = gameData();
    const p = newProject();
    const { factory } = firstFactory(p);
    const upper = ops.addFloor(p, factory.id, { name: 'OG' });
    // Erdgeschoss 0–18 m, Decke 2 m, nächste Ebene ab 20 m
    expect(p.floors[upper]!.elevationM).toBe(20);
    const id = ops.addBuilding(p, gd, {
      factoryId: factory.id,
      type: 'Build_SmelterMk1_C',
      placement: { floorId: upper, x: 0, y: 0, zOffsetM: 0, rotationDeg: 0 },
    });
    ops.removeFloor(p, upper);
    expect(p.buildings[id]!.placement).toBeNull();
    expect(p.factories[factory.id]!.floorIds).toHaveLength(1);
  });

  it('das letzte Stockwerk kann nicht entfernt werden', () => {
    const p = newProject();
    const { floorId } = firstFactory(p);
    expect(() => ops.removeFloor(p, floorId)).toThrow(OpError);
  });

  it('prüft Rezept-Gebäude-Zuordnung, Takt und Somersloops', () => {
    const gd = gameData();
    const p = newProject();
    const { factory } = firstFactory(p);
    expect(() =>
      ops.addBuilding(p, gd, { factoryId: factory.id, type: 'Build_SmelterMk1_C', recipeId: 'Recipe_IronPlate_C' }),
    ).toThrow(/kann nicht in/);
    const id = ops.addBuilding(p, gd, { factoryId: factory.id, type: 'Build_ConstructorMk1_C', recipeId: 'Recipe_IronPlate_C' });
    expect(() => ops.updateBuildings(p, gd, [id], { clock: 3 })).toThrow(/Takt/);
    ops.updateBuildings(p, gd, [id], { clock: 2.5, somersloops: 1 });
    expect(() => ops.updateBuildings(p, gd, [id], { somersloops: 2 })).toThrow(/Höchstens 1/);
    // Typwechsel verwirft unpassendes Rezept
    ops.updateBuildings(p, gd, [id], { type: 'Build_AssemblerMk1_C' });
    expect(p.buildings[id]!.recipeId).toBeNull();
  });

  it('verbindet nur passende Anschlüsse und jeden Anschluss nur einmal', () => {
    const gd = gameData();
    const p = newProject();
    const { factory, floorId } = firstFactory(p);
    const at = (x: number) => ({ floorId, x, y: 0, zOffsetM: 0, rotationDeg: 0 });
    const a = ops.addBuilding(p, gd, { factoryId: factory.id, type: 'Build_ConstructorMk1_C', placement: at(0) });
    const b = ops.addBuilding(p, gd, { factoryId: factory.id, type: 'Build_ConstructorMk1_C', placement: at(20) });
    const c = ops.addBuilding(p, gd, { factoryId: factory.id, type: 'Build_ConstructorMk1_C', placement: at(40) });
    const tier = 'Build_ConveyorBeltMk2_C';
    expect(() =>
      ops.addLink(p, gd, { kind: 'belt', tier, from: { buildingId: a, portId: 'belt-in-0' }, to: { buildingId: b, portId: 'belt-in-0' } }),
    ).toThrow(/Zwei Eingänge/);
    expect(() =>
      ops.addLink(p, gd, { kind: 'pipe', tier: 'Build_Pipeline_C', from: { buildingId: a, portId: 'belt-out-0' }, to: { buildingId: b, portId: 'belt-in-0' } }),
    ).toThrow();
    ops.addLink(p, gd, { kind: 'belt', tier, from: { buildingId: a, portId: 'belt-out-0' }, to: { buildingId: b, portId: 'belt-in-0' } });
    expect(() =>
      ops.addLink(p, gd, { kind: 'belt', tier, from: { buildingId: a, portId: 'belt-out-0' }, to: { buildingId: c, portId: 'belt-in-0' } }),
    ).toThrow(/bereits verbunden/);
    ops.removeBuildings(p, [b]);
    expect(Object.keys(p.links)).toHaveLength(0);
  });

  it('Förderband vom Eingang zum Ausgang gezeichnet wird in Flussrichtung gespeichert', () => {
    const gd = gameData();
    const p = newProject();
    const { factory, floorId } = firstFactory(p);
    const at = (x: number) => ({ floorId, x, y: 0, zOffsetM: 0, rotationDeg: 0 });
    const a = ops.addBuilding(p, gd, { factoryId: factory.id, type: 'Build_ConstructorMk1_C', placement: at(0) });
    const b = ops.addBuilding(p, gd, { factoryId: factory.id, type: 'Build_ConstructorMk1_C', placement: at(20) });
    const wp = [
      { x: 1, y: 1, z: 1 },
      { x: 2, y: 2, z: 1 },
    ];
    const id = ops.addLink(p, gd, {
      kind: 'belt',
      tier: 'Build_ConveyorBeltMk1_C',
      from: { buildingId: b, portId: 'belt-in-0' },
      to: { buildingId: a, portId: 'belt-out-0' },
      waypoints: wp,
      routing: 'straight',
    });
    const l = p.links[id]!;
    expect(l.from).toEqual({ buildingId: a, portId: 'belt-out-0' });
    expect(l.to).toEqual({ buildingId: b, portId: 'belt-in-0' });
    expect(l.waypoints).toEqual([wp[1], wp[0]]);
    expect(l.routing).toBe('straight');
  });

  it('Kopieren übernimmt interne Verbindungen, Drehen dreht um den Mittelpunkt', () => {
    const gd = gameData();
    const p = newProject();
    const { factory, floorId } = firstFactory(p);
    const a = ops.addBuilding(p, gd, { factoryId: factory.id, type: 'Build_ConstructorMk1_C', placement: { floorId, x: -10, y: 0, zOffsetM: 0, rotationDeg: 0 } });
    const b = ops.addBuilding(p, gd, { factoryId: factory.id, type: 'Build_ConstructorMk1_C', placement: { floorId, x: 10, y: 0, zOffsetM: 0, rotationDeg: 0 } });
    ops.addLink(p, gd, { kind: 'belt', tier: 'Build_ConveyorBeltMk1_C', from: { buildingId: a, portId: 'belt-out-0' }, to: { buildingId: b, portId: 'belt-in-0' } });
    const copies = ops.duplicateBuildings(p, [a, b], { x: 0, y: 40, z: 0 });
    expect(copies).toHaveLength(2);
    expect(Object.keys(p.links)).toHaveLength(2);
    ops.rotateBuildings(p, [a, b], 90);
    expect(p.buildings[a]!.placement!.x).toBeCloseTo(0);
    expect(p.buildings[a]!.placement!.y).toBeCloseTo(-10);
    expect(p.buildings[a]!.placement!.rotationDeg).toBe(90);
  });

  it('Gebäudegruppen werden als Vorlage gespeichert und gedreht eingefügt', () => {
    const gd = gameData();
    const p = newProject();
    const { factory, floorId } = firstFactory(p);
    const a = ops.addBuilding(p, gd, { factoryId: factory.id, type: 'Build_SmelterMk1_C', recipeId: 'Recipe_IngotIron_C', placement: { floorId, x: 0, y: 0, zOffsetM: 0, rotationDeg: 0 } });
    const b = ops.addBuilding(p, gd, { factoryId: factory.id, type: 'Build_ConstructorMk1_C', recipeId: 'Recipe_IronPlate_C', placement: { floorId, x: 0, y: 20, zOffsetM: 0, rotationDeg: 0 } });
    ops.addLink(p, gd, { kind: 'belt', tier: 'Build_ConveyorBeltMk1_C', from: { buildingId: a, portId: 'belt-out-0' }, to: { buildingId: b, portId: 'belt-in-0' } });
    const g = ops.createGroupFromBuildings(p, [a, b], 'Eisenplatten');
    const ids = ops.instantiateGroup(p, gd, g, { factoryId: factory.id, floorId, x: 100, y: 100, rotationDeg: 90 });
    expect(ids).toHaveLength(2);
    const placed = ids.map((id) => p.buildings[id]!.placement!);
    expect(placed[0]!.x).toBeCloseTo(110);
    expect(placed[1]!.x).toBeCloseTo(90);
    expect(placed.every((pl) => pl.rotationDeg === 90)).toBe(true);
    expect(Object.values(p.links)).toHaveLength(2);
    expect(p.buildings[ids[0]!]!.recipeId).toBe('Recipe_IngotIron_C');
  });
});

describe('Operationen innerhalb von Immer-Entwürfen (wie in der Web-App)', () => {
  it('Kopieren, Gruppen und Löschen funktionieren auf Proxys', async () => {
    const { produce } = await import('immer');
    const gd = gameData();
    let p = newProject();
    const { factory, floorId } = firstFactory(p);
    let ids: string[] = [];
    p = produce(p, (d) => {
      const a = ops.addBuilding(d, gd, { factoryId: factory.id, type: 'Build_SmelterMk1_C', placement: { floorId, x: 0, y: 0, zOffsetM: 0, rotationDeg: 0 } });
      const b = ops.addBuilding(d, gd, { factoryId: factory.id, type: 'Build_ConstructorMk1_C', placement: { floorId, x: 0, y: 20, zOffsetM: 0, rotationDeg: 0 } });
      ops.addLink(d, gd, { kind: 'belt', tier: 'Build_ConveyorBeltMk1_C', from: { buildingId: a, portId: 'belt-out-0' }, to: { buildingId: b, portId: 'belt-in-0' } });
      ids = [a, b];
    });
    p = produce(p, (d) => {
      ops.duplicateBuildings(d, ids, { x: 30, y: 0, z: 0 });
      const g = ops.createGroupFromBuildings(d, ids, 'G');
      ops.instantiateGroup(d, gd, g, { factoryId: factory.id, floorId, x: 100, y: 0, rotationDeg: 180 });
    });
    expect(Object.keys(p.buildings)).toHaveLength(6);
    expect(Object.keys(p.links)).toHaveLength(3);
    expect(ProjectSchema.safeParse(p).success).toBe(true);
  });
});
