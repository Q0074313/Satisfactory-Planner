import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { buildExampleProject, createGameDataIndex, type GameData, type MapData } from '@satis/core';
import { buildItems, hoverInfo } from './scene3d';

const here = dirname(fileURLToPath(import.meta.url));
const dir = join(here, '../../../../../data/gamedata/1.2.5.1');
const gd = createGameDataIndex(JSON.parse(readFileSync(join(dir, 'gamedata.json'), 'utf8')) as GameData, JSON.parse(readFileSync(join(dir, 'map.json'), 'utf8')) as MapData);
const BASE = { datasetId: 'sf-1.2.5.1', gameVersion: '1.2.5.1' };

describe('Hotfix 0.8.1: 3D-Ansicht', () => {
  const p = buildExampleProject(gd, 'medium', BASE);
  const fid = Object.values(p.factories).find((f) => !f.blackbox)!.id;

  it('Splitter, Zusammenführungen und Rohrkreuzungen haben Körper (nur weiche Kollisionsboxen)', () => {
    const { items } = buildItems(p, gd, fid, false);
    const withBody = new Set(items.filter((i) => i.kind === 'building').map((i) => i.ref.id));
    for (const type of ['Build_ConveyorAttachmentSplitter_C', 'Build_ConveyorAttachmentMerger_C', 'Build_PipelineJunction_Cross_C']) {
      const ids = Object.values(p.buildings).filter((b) => b.factoryId === fid && b.type === type).map((b) => b.id);
      expect(ids.length, type).toBeGreaterThan(0);
      expect(ids.every((id) => withBody.has(id)), type).toBe(true);
    }
  });

  it('Bänder als flache Bahnen, Rohre rund, Pfeile in Flussrichtung, ohne kaputte Geometrie', () => {
    const { items } = buildItems(p, gd, fid, false);
    const belts = items.filter((i) => i.kind === 'belt');
    const pipes = items.filter((i) => i.kind === 'pipe');
    expect(belts.length).toBeGreaterThan(0);
    expect(pipes.length).toBeGreaterThan(0);
    expect(items.some((i) => i.kind === 'arrow')).toBe(true);
    for (const i of [...belts, ...pipes]) {
      const pos = i.geometry.getAttribute('position');
      for (let k = 0; k < pos.count * 3; k++) expect(Number.isFinite(pos.array[k]!)).toBe(true);
    }
    // Ein waagrechtes Bandstück ist höchstens so dick wie die Bahn (0,25 m)
    const flat = belts.find((i) => {
      i.geometry.computeBoundingBox();
      const b = i.geometry.boundingBox!;
      return b.max.y - b.min.y < 0.26;
    });
    expect(flat).toBeDefined();
  });

  it('Fundamentraster als 8-m-Gitter (eine Platte, keine Einzelteile), Pfeile, Namen, Infotext beim Überfahren', () => {
    const area = Object.values(p.areas).find((a) => a.factoryId === fid && a.kind === 'foundation')!;
    const xs = area.polygon.map((q) => q.x);
    const ys = area.polygon.map((q) => q.y);
    const nx = Math.round((Math.max(...xs) - Math.min(...xs)) / 8);
    const ny = Math.round((Math.max(...ys) - Math.min(...ys)) / 8);
    const { items: withGrid } = buildItems(p, gd, fid, true);
    const slabs = withGrid.filter((i) => i.ref.id === area.id && i.kind === 'area');
    const grid = withGrid.find((i) => i.ref.id === area.id && i.kind === 'grid')!;
    expect(slabs).toHaveLength(1);
    // Rechteck aus nx × ny Feldern: (nx + 1) · ny senkrechte und (ny + 1) · nx waagrechte Kanten, je 2 Punkte
    expect(grid.geometry.getAttribute('position').count / 2).toBe((nx + 1) * ny + (ny + 1) * nx);
    expect(buildItems(p, gd, fid, false).items.some((i) => i.kind === 'grid')).toBe(false);
    // Pfeile: Abschnitte mit Anzahl > 0
    const arrows = withGrid.filter((i) => i.kind === 'arrow');
    expect(arrows.length).toBeGreaterThan(0);
    expect(arrows.every((i) => i.arrows!.every((r) => r.n >= 1 && r.len >= 3))).toBe(true);

    const { labels } = buildItems(p, gd, fid, false);
    expect(labels.some((l) => l.text === gd.name('Build_OilRefinery_C'))).toBe(true);
    expect(labels.some((l) => l.text === gd.name('Build_ConveyorAttachmentSplitter_C'))).toBe(false);

    const ref = Object.values(p.buildings).find((b) => b.factoryId === fid && b.recipeId)!;
    const info = hoverInfo(p, gd, fid, { table: 'buildings', id: ref.id });
    expect(info[0]).toBe(gd.name(ref.type));
    expect(info.join(' ')).toContain('%');
    const link = Object.values(p.links).find((l) => l.factoryId === fid)!;
    expect(hoverInfo(p, gd, fid, { table: 'links', id: link.id }).length).toBeGreaterThan(1);
  });
});
