import { describe, expect, it } from 'vitest';
import { groupSave, projectFromSave } from '../src/import/fromSave.ts';
import type { SaveExtract } from '../src/import/saveTypes.ts';
import { gameData } from './helpers.ts';
import { fixture } from './saveFixture.ts';

const gd = gameData();
const BASE = { name: 'Import', datasetId: gd.data.meta.datasetId, gameVersion: gd.data.meta.gameVersion, rail: false, plans: false };
const floorsOf = (ex: SaveExtract) => {
  const groups = groupSave(ex, gd).groups;
  const main = groups.find((g) => g.buildingIds.includes('Miner'))!;
  main.buildingIds.push(...ex.buildings.filter((b) => b.id.startsWith('X')).map((b) => b.id));
  const { project: p } = projectFromSave(ex, gd, { ...BASE, groups: [main] });
  const f = Object.values(p.factories)[0]!;
  return { p, floors: f.floorIds.map((id) => p.floors[id]!) };
};

describe('Hotfix 0.9.3: Stockwerke beim Import', () => {
  it('bis 10 m Abstand von Boden zu Boden ist dasselbe Stockwerk (mit Versatz)', () => {
    const ex = fixture();
    const c = ex.buildings.find((b) => b.id === 'Constructor')!;
    // Konstruktor 5 m höher direkt über dem Schmelzofen
    ex.buildings.push({ ...c, id: 'X1', x: ex.buildings.find((b) => b.id === 'Smelter')!.x, y: ex.buildings.find((b) => b.id === 'Smelter')!.y, z: c.z + 5, conns: {} });
    const { p, floors } = floorsOf(ex);
    expect(floors).toHaveLength(1);
    const x1 = Object.values(p.buildings).find((b) => b.placement!.zOffsetM > 4)!;
    expect(x1.placement!.zOffsetM).toBeCloseTo(5, 1);
    // genau 10 m darüber: ebenfalls dasselbe Stockwerk
    const ex2 = fixture();
    const sm = ex2.buildings.find((b) => b.id === 'Smelter')!;
    ex2.buildings.push({ ...c, id: 'X1', x: sm.x, y: sm.y, z: c.z + 10, conns: {} });
    expect(floorsOf(ex2).floors).toHaveLength(1);
  });

  it('höher, aber nicht darüber gebaut: dasselbe Stockwerk; darüber gebaut: eigenes Stockwerk', () => {
    const ex = fixture();
    const c = ex.buildings.find((b) => b.id === 'Constructor')!;
    // 20 m höher, 40 m daneben: nicht übereinander
    ex.buildings.push({ ...c, id: 'X1', x: c.x - 40, z: c.z + 20, conns: {} });
    expect(floorsOf(ex).floors).toHaveLength(1);
    // 20 m höher direkt über dem Konstruktor: eigenes Stockwerk
    const ex2 = fixture();
    ex2.buildings.push({ ...c, id: 'X1', z: c.z + 20, conns: {} });
    const { floors } = floorsOf(ex2);
    expect(floors).toHaveLength(2);
    expect(floors[1]!.elevationM - floors[0]!.elevationM).toBeGreaterThan(10);
  });
});
