import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { buildExampleProject, createGameDataIndex, type GameData, type MapData } from '@satis/core';
import { buildScene, hitTest } from './scene';

const here = dirname(fileURLToPath(import.meta.url));
const dir = join(here, '../../../../../data/gamedata/1.2.5.1');
const gd = createGameDataIndex(JSON.parse(readFileSync(join(dir, 'gamedata.json'), 'utf8')) as GameData, JSON.parse(readFileSync(join(dir, 'map.json'), 'utf8')) as MapData);

describe('Hotfix 0.8: Auswahl im Grundriss', () => {
  it('blasse Leitungsstücke auf anderen Stockwerken lassen sich nicht anklicken', () => {
    const p = buildExampleProject(gd, 'large', { datasetId: 'sf-1.2.5.1', gameVersion: '1.2.5.1' });
    const factory = Object.values(p.factories).find((f) => f.floorIds.length > 1)!;
    const opts = (floorId: string) => ({ ports: false, links: true, floorId, measurements: false, areas: false });
    let checked = 0;
    for (const floorId of factory.floorIds) {
      const scene = buildScene(p, gd, factory.id, floorId);
      for (const sl of scene.links) {
        // Leitung mit einem Ende auf diesem Stockwerk, aber einem langen Stück auf einem anderen
        if (!sl.visibleOnFloor) continue;
        for (let i = 1; i < sl.points.length; i++) {
          const other = sl.floors[i - 1];
          if (!other || other === floorId || sl.floors[i] !== other) continue;
          const a = sl.points[i - 1]!;
          const b = sl.points[i]!;
          if (Math.hypot(b.x - a.x, b.y - a.y) < 4) continue;
          const mid = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
          // Auf dem anderen Stockwerk ist das Stück wählbar, hier nicht
          const there = hitTest(buildScene(p, gd, factory.id, other), p, mid, 0.3, opts(other));
          expect(there?.kind).toBe('link');
          const here = hitTest(scene, p, mid, 0.3, opts(floorId));
          expect(here?.kind === 'link' && here.id === sl.link.id).toBe(false);
          checked++;
          break;
        }
        if (checked > 20) break;
      }
    }
    expect(checked).toBeGreaterThan(0);
  });
});
