import { describe, expect, it } from 'vitest';
import { dirFromDeg } from '../src/geometry/index.ts';
import { groupSave, projectFromSave } from '../src/import/fromSave.ts';
import type { SaveExtract } from '../src/import/saveTypes.ts';
import { linkPath } from '../src/factory/linkPath.ts';
import { gameData } from './helpers.ts';
import { fixture } from './saveFixture.ts';

const gd = gameData();
const BASE = { name: 'Import', datasetId: gd.data.meta.datasetId, gameVersion: gd.data.meta.gameVersion, rail: true, plans: true };
const build = (ex: SaveExtract) => projectFromSave(ex, gd, { ...BASE, groups: groupSave(ex, gd).groups });

describe('Hotfix 0.9.1: Spielstand-Import', () => {
  it('Signal gilt für Züge, die das geschützte Gleis verlassen', () => {
    // Signal schützt das Gleisende T1/0 vor dem Bahnhof; T1 führt nach +x, Züge kommen also von dort in −x-Richtung
    const { project: p } = build(fixture());
    const sig = Object.values(p.railSignals)[0]!;
    const node = p.railNodes[sig.nodeId]!;
    const d = dirFromDeg(node.headingDeg);
    const travel = sig.facing === 'forward' ? d : { x: -d.x, y: -d.y };
    expect(travel.x).toBeLessThan(-0.99);
  });

  it('Gewinnung gehört zur belieferten Fabrik, auch über ein langes Band', () => {
    const ex = fixture();
    // zweiter Miner 400 m entfernt, über ein langes Band am Schmelzofen-Lager vorbei an die Platten-Kiste
    const miner = ex.buildings.find((b) => b.id === 'Miner')!;
    const node = gd.map!.nodes.find((n) => n.kind === 'node' && n.itemId === 'Desc_OreIron_C' && Math.hypot(n.x - miner.x, n.y - miner.y) > 300)!;
    ex.buildings.push({ ...miner, id: 'FarMiner', x: node.x, y: node.y, node: node.id, conns: { Output0: { id: 'Long', comp: 'ConveyorAny0' } } });
    ex.buildings.push({ ...ex.buildings.find((b) => b.id === 'Plates')!, id: 'OreBox', x: miner.x - 20, y: miner.y + 60, conns: { Input0: { id: 'Long', comp: 'ConveyorAny1' } } });
    const pts = [
      { x: node.x, y: node.y + 8, z: miner.z + 1 },
      { x: miner.x - 20, y: miner.y + 56, z: miner.z + 1 },
    ];
    ex.conveyors.push({ id: 'Long', type: 'Build_ConveyorBeltMk2_C', kind: 'belt', lift: false, points: pts, conns: [{ id: 'FarMiner', comp: 'Output0' }, { id: 'OreBox', comp: 'Input0' }], ends: [pts[0]!, pts[1]!] });
    const g = groupSave(ex, gd);
    const main = g.groups.find((x) => x.buildingIds.includes('Miner'))!;
    expect(main.buildingIds).toContain('FarMiner');
    expect(g.groups.some((x) => x.name.startsWith('Gewinnung'))).toBe(false);
  });

  it('Name nach dem Endprodukt der Fabrik', () => {
    const g = groupSave(fixture(), gd);
    expect(g.groups.find((x) => x.buildingIds.includes('Constructor'))!.name).toBe('Fabrik: Eisenplatte');
  });

  it('Wasserextraktor auf eigener Ebene unter den Fundamenten', () => {
    const ex = fixture();
    const pump = ex.buildings.find((b) => b.id === 'Pump')!;
    // mehr als 10 m tiefer (näher wäre dasselbe Stockwerk, Hotfix 0.9.3)
    pump.z -= 12;
    const { project: p } = build(ex);
    const b = Object.values(p.buildings).find((x) => x.type === 'Build_WaterPump_C')!;
    const fl = p.floors[b.placement!.floorId]!;
    expect(Math.abs(fl.elevationM - pump.z)).toBeLessThan(0.06);
    expect(Math.abs(b.placement!.zOffsetM)).toBeLessThan(0.06);
    expect(Object.values(p.floors).filter((f) => f.factoryId === b.factoryId)).toHaveLength(2);
  });

  it('Fundamente als zusammengefasste Fundamentflächen, auch gedreht und außerhalb des Weltrasters', () => {
    const ex = fixture();
    const m = ex.buildings.find((b) => b.id === 'Miner')!;
    // 3 × 2 Fundamente (8 × 2, Oberkante = Gebäudeboden) im Weltraster unter dem Miner
    const gx = Math.round(m.x / 8) * 8;
    const gy = Math.round(m.y / 8) * 8;
    const f8 = (x: number, y: number, yawDeg = 0) => ({ type: 'Build_Foundation_8x2_01_C', x, y, z: m.z - 1, yawDeg });
    ex.foundations = [];
    for (let i = 0; i < 3; i++) for (let j = 0; j < 2; j++) ex.foundations.push(f8(gx + 8 * i, gy + 8 * j));
    // zwei gedrehte (30°) nebeneinander, daneben
    const u = { x: Math.cos(Math.PI / 6), y: Math.sin(Math.PI / 6) };
    ex.foundations.push(f8(gx + 40, gy, 30), f8(gx + 40 + 8 * u.x, gy + 8 * u.y, 30));
    // Unterbau (Oberkante 2 m tiefer) zählt nicht
    ex.foundations.push({ ...f8(gx, gy), z: m.z - 3 });
    const { project: p, report } = build(ex);
    const areas = Object.values(p.areas).filter((a) => a.kind === 'foundation');
    expect(report.areas).toBe(2);
    expect(areas).toHaveLength(2);
    const area = (poly: { x: number; y: number }[]) => Math.abs(poly.reduce((s, q, i) => s + q.x * poly[(i + 1) % poly.length]!.y - poly[(i + 1) % poly.length]!.x * q.y, 0) / 2);
    expect(areas.map((a) => Math.round(area(a.polygon))).sort((a, b) => a - b)).toEqual([128, 384]);
    expect(areas.every((a) => a.foundationType === 'Build_Foundation_8x2_01_C')).toBe(true);
  });

  it('Lift direkt am Anschluss bleibt senkrecht; Smart-Splitter am Lift wird übernommen', () => {
    const ex = fixture();
    // Lift unmittelbar am Ausgang des Konstruktors (0,5 m daneben), dann waagrecht zur Kiste
    const c = ex.buildings.find((b) => b.id === 'Constructor')!;
    const g = ex.conveyors.find((x) => x.id === 'G')!;
    const lift = { id: 'LG', type: 'Build_ConveyorLiftMk2_C', kind: 'belt' as const, lift: true, points: [{ x: c.x + 0.5, y: c.y + 3, z: c.z + 1 }, { x: c.x + 0.5, y: c.y + 3, z: c.z + 6 }], conns: [{ id: 'Constructor', comp: 'Output0' }, { id: 'G', comp: 'ConveyorAny0' }] as [never, never], ends: [{ x: c.x + 0.5, y: c.y + 3, z: c.z + 1 }, { x: c.x + 0.5, y: c.y + 3, z: c.z + 6 }] as [never, never] };
    ex.conveyors.push(lift);
    c.conns.Output0 = { id: 'LG', comp: 'ConveyorAny0' };
    g.conns[0] = { id: 'LG', comp: 'ConveyorAny1' };
    g.points = [{ x: c.x + 0.5, y: c.y + 3, z: c.z + 6 }, { x: c.x, y: c.y + 8, z: c.z + 6 }, { x: c.x, y: c.y + 8, z: c.z + 1 }];
    const { project: p } = build(ex);
    const con = Object.values(p.buildings).find((b) => b.type === 'Build_ConstructorMk1_C')!;
    const link = Object.values(p.links).find((l) => l.from.buildingId === con.id)!;
    const path = linkPath(p, gd, link)!;
    for (let i = 1; i < path.length; i++) {
      const h = Math.hypot(path[i]!.x - path[i - 1]!.x, path[i]!.y - path[i - 1]!.y);
      const v = Math.abs(path[i]!.z - path[i - 1]!.z);
      expect(v < 0.5 || h < 1e-6, `Abschnitt ${i}: ${h.toFixed(2)} m waagrecht, ${v.toFixed(2)} m senkrecht`).toBe(true);
    }

    const ex2 = fixture();
    const smelter = ex2.buildings.find((b) => b.id === 'Smelter')!;
    ex2.buildings.push({ ...smelter, id: 'SL', type: 'Build_ConveyorAttachmentSplitterSmartLift_C', recipe: null, conns: { TopConnection: { id: 'L1', comp: 'ConveyorAny1' }, BottomConnection: { id: 'D', comp: 'ConveyorAny0' }, Output1: null, Output2: null } });
    // L1 endet jetzt am Splitter, D beginnt dort
    const l1 = ex2.conveyors.find((x) => x.id === 'L1')!;
    const d = ex2.conveyors.find((x) => x.id === 'D')!;
    l1.conns[1] = { id: 'SL', comp: 'TopConnection' };
    d.conns[0] = { id: 'SL', comp: 'BottomConnection' };
    const r2 = build(ex2);
    const sl = Object.values(r2.project.buildings).find((b) => b.type === 'Build_ConveyorAttachmentSplitterSmart_C')!;
    expect(sl).toBeTruthy();
    expect(Object.values(r2.project.links).filter((l) => l.from.buildingId === sl.id || l.to.buildingId === sl.id)).toHaveLength(2);
    expect(r2.report.notes.some((n) => n.includes('Smart-Splitter'))).toBe(true);
  });
});
