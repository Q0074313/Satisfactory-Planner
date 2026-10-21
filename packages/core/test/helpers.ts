import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createGameDataIndex, type GameData, type GameDataIndex } from '../src/gamedata/index.ts';
import type { MapData } from '../src/map/types.ts';
import { createProject } from '../src/project/create.ts';
import type { Project } from '../src/model/schema.ts';

const here = dirname(fileURLToPath(import.meta.url));
let cached: GameDataIndex | undefined;

/** Echter Spieldatensatz 1.2.4.0 aus dem Repository. */
export function gameData(): GameDataIndex {
  if (!cached) {
    const dir = join(here, '../../../data/gamedata/1.2.4.0');
    const raw = readFileSync(join(dir, 'gamedata.json'), 'utf8');
    const map = JSON.parse(readFileSync(join(dir, 'map.json'), 'utf8')) as MapData;
    cached = createGameDataIndex(JSON.parse(raw) as GameData, map);
  }
  return cached;
}

export function newProject(): Project {
  return createProject({ name: 'Test', datasetId: 'sf-1.2.4.0', gameVersion: '1.2.4.0' });
}

export function firstFactory(p: Project) {
  const f = Object.values(p.factories)[0]!;
  return { factory: f, floorId: f.floorIds[0]! };
}
