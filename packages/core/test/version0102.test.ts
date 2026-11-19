/**
 * Version 0.10.2: Spielstand-Import – Fabriken sauberer trennen (Lager und
 * Bahnhöfe als Schnittstelle, Wege über Splitter insgesamt gemessen,
 * Fundamentflächen), Teilungsvorschlag nach Produktionsketten, senkrechte
 * Pumpen in der richtigen Höhe.
 */
import { describe, expect, it } from 'vitest';
import { groupSave, louvain, projectFromSave } from '../src/import/fromSave.ts';
import type { SaveBuilding, SaveConveyor, SaveExtract, SaveRef } from '../src/import/saveTypes.ts';
import { gameData } from './helpers.ts';
import { fixture } from './saveFixture.ts';

const gd = gameData();
const BASE = { name: 'Import', datasetId: gd.data.meta.datasetId, gameVersion: gd.data.meta.gameVersion, rail: false, plans: false };
const ref = (id: string, comp: string): SaveRef => ({ id, comp });

/** Gebäude nach dem Muster eines vorhandenen (Lage, Höhe) mit neuen Angaben. */
function add(ex: SaveExtract, b: Partial<SaveBuilding> & Pick<SaveBuilding, 'id' | 'type' | 'x' | 'y'>): SaveBuilding {
  const base = ex.buildings.find((x) => x.id === 'Constructor')!;
  const nb: SaveBuilding = { ...base, recipe: null, conns: {}, platformConns: {}, node: null, ...b };
  ex.buildings.push(nb);
  return nb;
}
function belt(ex: SaveExtract, id: string, a: { x: number; y: number }, b: { x: number; y: number }, from: SaveRef, to: SaveRef) {
  const z = ex.buildings[0]!.z + 1;
  const points = [
    { x: a.x, y: a.y, z },
    { x: b.x, y: b.y, z },
  ];
  const c: SaveConveyor = { id, type: 'Build_ConveyorBeltMk2_C', kind: 'belt', lift: false, points, conns: [ref(from.id, from.comp), ref(to.id, to.comp)], ends: [points[0]!, points[1]!] };
  // Gebäudeseite zeigt auf das Band
  ex.buildings.find((x) => x.id === from.id)!.conns[from.comp] = ref(id, 'ConveyorAny0');
  ex.buildings.find((x) => x.id === to.id)!.conns[to.comp] = ref(id, 'ConveyorAny1');
  ex.conveyors.push(c);
}
const groupOf = (ex: SaveExtract, id: string) => groupSave(ex, gd).groups.find((g) => g.buildingIds.includes(id));

describe('0.10.2: Fabriken trennen', () => {
  it('Lager verbindet keine Fabriken: es gehört zur nächsten, die Verbindung wird ein Transportauftrag', () => {
    const ex = fixture();
    const plates = ex.buildings.find((b) => b.id === 'Plates')!;
    // Assembler 60 m hinter dem Plattenlager, über ein Band aus dem Lager beliefert
    const asm = add(ex, { id: 'Asm', type: 'Build_AssemblerMk1_C', x: plates.x, y: plates.y + 60, recipe: 'Recipe_IronPlateReinforced_C' });
    belt(ex, 'ToAsm', plates, asm, { id: 'Plates', comp: 'Output1' }, { id: 'Asm', comp: 'Input0' });
    const main = groupOf(ex, 'Constructor')!;
    expect(main.buildingIds).toContain('Plates');
    expect(main.buildingIds).not.toContain('Asm');
    const g = groupSave(ex, gd);
    expect(g.longLinks).toBe(1);
    const { project: p, report } = projectFromSave(ex, gd, { ...BASE, groups: g.groups });
    expect(report.orders).toBe(1);
    expect(Object.values(p.transportOrders)[0]).toMatchObject({ itemId: 'Desc_IronPlate_C', mode: 'belt' });
  });

  it('Weg über Splitter bzw. Zusammenführungen zählt insgesamt: über 150 m sind es zwei Fabriken', () => {
    const ex = fixture();
    const c = ex.buildings.find((b) => b.id === 'Constructor')!;
    // Konstruktor → (100 m) Zusammenführung → (100 m) Konstruktor: jedes Stück kurz, der Weg lang
    const m = add(ex, { id: 'M', type: 'Build_ConveyorAttachmentMerger_C', x: c.x + 100, y: c.y });
    const far = add(ex, { id: 'Far', type: 'Build_ConstructorMk1_C', x: c.x + 200, y: c.y, recipe: 'Recipe_Screw_C' });
    ex.buildings.find((b) => b.id === 'Constructor')!.conns.Output0 = null;
    ex.conveyors = ex.conveyors.filter((x) => x.id !== 'G');
    ex.buildings.find((b) => b.id === 'Plates')!.conns = {};
    belt(ex, 'A1', c, m, { id: 'Constructor', comp: 'Output0' }, { id: 'M', comp: 'Input1' });
    belt(ex, 'A2', m, far, { id: 'M', comp: 'Output1' }, { id: 'Far', comp: 'Input0' });
    expect(groupOf(ex, 'Far')!.key).not.toBe(groupOf(ex, 'Constructor')!.key);
    // kürzer (je 40 m): eine Fabrik
    const ex2 = fixture();
    const c2 = ex2.buildings.find((b) => b.id === 'Constructor')!;
    const m2 = add(ex2, { id: 'M', type: 'Build_ConveyorAttachmentMerger_C', x: c2.x + 40, y: c2.y });
    const near = add(ex2, { id: 'Near', type: 'Build_ConstructorMk1_C', x: c2.x + 80, y: c2.y, recipe: 'Recipe_Screw_C' });
    c2.conns.Output0 = null;
    ex2.conveyors = ex2.conveyors.filter((x) => x.id !== 'G');
    belt(ex2, 'A1', c2, m2, { id: 'Constructor', comp: 'Output0' }, { id: 'M', comp: 'Input1' });
    belt(ex2, 'A2', m2, near, { id: 'M', comp: 'Output1' }, { id: 'Near', comp: 'Input0' });
    expect(groupOf(ex2, 'Near')!.key).toBe(groupOf(ex2, 'Constructor')!.key);
  });

  it('Nähe gilt nicht über getrennte Fundamentflächen', () => {
    const ex = fixture();
    const o = ex.buildings.find((b) => b.id === 'Miner')!;
    const x0 = o.x + 400;
    add(ex, { id: 'S1', type: 'Build_SmelterMk1_C', x: x0, y: o.y, z: o.z });
    add(ex, { id: 'S2', type: 'Build_SmelterMk1_C', x: x0 + 16, y: o.y, z: o.z });
    const fd = (x: number) => ({ type: 'Build_Foundation_8x1_01_C', x, y: o.y, z: o.z - 0.5, yawDeg: 0 });
    // zwei Fundamentflächen mit einer Lücke von einem Feld
    ex.foundations = [fd(x0), fd(x0 + 16)];
    expect(groupOf(ex, 'S1')!.key).not.toBe(groupOf(ex, 'S2')!.key);
    // Lücke geschlossen: eine Fläche, eine Fabrik
    ex.foundations.push(fd(x0 + 8));
    expect(groupOf(ex, 'S1')!.key).toBe(groupOf(ex, 'S2')!.key);
    // ohne Fundamente (Gelände): Nähe zählt
    ex.foundations = [];
    expect(groupOf(ex, 'S1')!.key).toBe(groupOf(ex, 'S2')!.key);
  });
});

describe('0.10.2: Teilungsvorschlag nach Produktionsketten', () => {
  it('Louvain trennt zwei dichte Gruppen an der einzelnen Verbindung', () => {
    const edges: [number, number, number][] = [];
    for (const base of [0, 5]) for (let i = 0; i < 5; i++) for (let j = i + 1; j < 5; j++) edges.push([base + i, base + j, 1]);
    edges.push([4, 5, 1]);
    const c = louvain(10, edges);
    expect(new Set(c.slice(0, 5)).size).toBe(1);
    expect(new Set(c.slice(5)).size).toBe(1);
    expect(c[0]).not.toBe(c[5]);
  });

  /** Zwei Straßen zu je zehn Konstruktoren nebeneinander, untereinander verkettet, eine Verbindung zwischen den Straßen. */
  function twoLines(recipeB: string): SaveExtract {
    const ex = fixture();
    ex.buildings = ex.buildings.filter((b) => !['Miner', 'Smelter', 'Constructor', 'Plates', 'Pump', 'J1', 'J2', 'Gen1', 'Gen2'].includes(b.id));
    ex.conveyors = ex.conveyors.filter((c) => c.id === 'F');
    const o = fixture().buildings.find((b) => b.id === 'Miner')!;
    const lines = [
      ['A', 'Recipe_IronPlate_C', 0],
      ['B', recipeB, 12],
    ] as const;
    for (const [name, recipe, dy] of lines) {
      for (let i = 0; i < 10; i++) add(ex, { id: `${name}${i}`, type: 'Build_ConstructorMk1_C', x: o.x + i * 10, y: o.y + dy, z: o.z, recipe });
      for (let i = 0; i < 9; i++) {
        const a = ex.buildings.find((b) => b.id === `${name}${i}`)!;
        const b = ex.buildings.find((b) => b.id === `${name}${i + 1}`)!;
        belt(ex, `${name}b${i}`, a, b, { id: a.id, comp: 'Output0' }, { id: b.id, comp: 'Input0' });
      }
    }
    // eine Querverbindung (Input0 von B0 ist frei)
    belt(ex, 'X', ex.buildings.find((b) => b.id === 'A9')!, ex.buildings.find((b) => b.id === 'B0')!, { id: 'A9', comp: 'Output0' }, { id: 'B0', comp: 'Input0' });
    return ex;
  }

  it('schlägt zwei Teile vor, wenn die Straßen verschiedene Endprodukte haben', () => {
    const g = groupOf(twoLines('Recipe_IronRod_C'), 'A0')!;
    expect(g.counts.machines).toBe(20);
    expect(g.split).toHaveLength(2);
    const names = g.split!.map((x) => x.name).sort();
    expect(names).toEqual(['Fabrik: Eisenplatte', 'Fabrik: Eisenstange']);
    expect(g.split!.find((x) => x.name === 'Fabrik: Eisenplatte')!.buildingIds).toEqual(expect.arrayContaining(['A0', 'A9']));
  });

  it('kein Vorschlag bei gleichem Endprodukt (z. B. zwei gleiche Blöcke)', () => {
    const g = groupOf(twoLines('Recipe_IronPlate_C'), 'A0')!;
    expect(g.split).toBeUndefined();
  });

  it('kein Vorschlag bei kleinen Fabriken', () => {
    expect(groupSave(fixture(), gd).groups.every((g) => !g.split)).toBe(true);
  });
});

describe('0.10.2: senkrechte Pumpen', () => {
  it('Unterkante wie im Spiel; in der Vorschau schmal statt waagrecht', () => {
    const ex = fixture();
    const o = ex.buildings.find((b) => b.id === 'Smelter')!;
    // Pumpe neben dem Schmelzofen, Ursprung 4 m über dem Boden, Förderrichtung nach oben
    add(ex, { id: 'VPump', type: 'Build_PipelinePump_C', x: o.x + 8, y: o.y, z: o.z + 4, vertical: 'up' });
    add(ex, { id: 'DPump', type: 'Build_PipelinePump_C', x: o.x + 10, y: o.y, z: o.z + 4, vertical: 'down' });
    const g = groupSave(ex, gd);
    const main = g.groups.find((x) => x.buildingIds.includes('VPump'))!;
    const shape = main.shapes[main.buildingIds.indexOf('VPump')]!;
    expect(shape.maxX - shape.minX).toBeLessThan(1.5);
    expect(shape.maxY - shape.minY).toBeLessThan(1.5);
    const { project: p } = projectFromSave(ex, gd, { ...BASE, groups: g.groups });
    const bounds = gd.building('Build_PipelinePump_C')!.bounds!;
    const bottom = (dir: 'up' | 'down') => {
      const b = Object.values(p.buildings).find((x) => x.type === 'Build_PipelinePump_C' && x.placement!.vertical === dir)!;
      return p.floors[b.placement!.floorId]!.elevationM + b.placement!.zOffsetM;
    };
    expect(bottom('up')).toBeCloseTo(o.z + 4 + bounds.minX, 2);
    expect(bottom('down')).toBeCloseTo(o.z + 4 - bounds.maxX, 2);
  });
});
