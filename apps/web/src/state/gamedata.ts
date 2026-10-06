import { createGameDataIndex, tr, type GameData, type GameDataIndex } from '@satis/core';

/**
 * Alle Spieldatensätze unter data/gamedata/<version>/ werden automatisch
 * registriert und erst bei Bedarf geladen (eigener Chunk je Version).
 */
const modules = import.meta.glob<GameData>('../../../../data/gamedata/*/gamedata.json', { import: 'default' });

export interface DatasetInfo {
  datasetId: string;
  gameVersion: string;
  load: () => Promise<GameData>;
}

function compareVersions(a: string, b: string): number {
  const pa = a.split('.').map(Number);
  const pb = b.split('.').map(Number);
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
    const d = (pa[i] ?? 0) - (pb[i] ?? 0);
    if (d !== 0) return d;
  }
  return 0;
}

export const DATASETS: DatasetInfo[] = Object.entries(modules)
  .map(([path, load]) => {
    const gameVersion = path.split('/').at(-2)!;
    return { datasetId: `sf-${gameVersion}`, gameVersion, load };
  })
  .sort((a, b) => compareVersions(b.gameVersion, a.gameVersion));

export const DEFAULT_DATASET = DATASETS[0];

const cache = new Map<string, Promise<GameDataIndex>>();

export function loadGameData(datasetId: string): Promise<GameDataIndex> {
  const info = DATASETS.find((d) => d.datasetId === datasetId);
  if (!info) return Promise.reject(new Error(tr('Spieldatensatz {id} ist in dieser Version der Anwendung nicht enthalten.', { id: datasetId })));
  let p = cache.get(datasetId);
  if (!p) {
    p = info.load().then(createGameDataIndex);
    cache.set(datasetId, p);
  }
  return p;
}
