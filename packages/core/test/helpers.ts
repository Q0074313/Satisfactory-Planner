import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createGameDataIndex, type GameData, type GameDataIndex } from '../src/gamedata/index.ts';
import { createProject } from '../src/project/create.ts';
import type { Project } from '../src/model/schema.ts';

const here = dirname(fileURLToPath(import.meta.url));
let cached: GameDataIndex | undefined;

/** Echter Spieldatensatz 1.2.4.0 aus dem Repository. */
export function gameData(): GameDataIndex {
  if (!cached) {
    const raw = readFileSync(join(here, '../../../data/gamedata/1.2.4.0/gamedata.json'), 'utf8');
    cached = createGameDataIndex(JSON.parse(raw) as GameData);
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
