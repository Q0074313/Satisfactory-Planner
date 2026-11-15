/**
 * Version 0.8: Anschlusslagen aus den Spielpaketen (portLayout), Auto-Layout
 * und Beispiele mit echten Lagen, Anzeige ohne „−0“.
 */
import { describe, expect, it } from 'vitest';
import { generateLayouts } from '../src/factory/autoLayout.ts';
import { linkEnds, linkPath } from '../src/factory/linkPath.ts';
import { portDefs } from '../src/factory/ports.ts';
import { formatNumber, roundForDisplay, setLanguage } from '../src/i18n/index.ts';
import type { Project } from '../src/model/schema.ts';
import { solveProduction } from '../src/production/solver.ts';
import { buildExampleProject } from '../src/project/examples.ts';
import * as prodOps from '../src/project/ops/production.ts';
import { firstFactory, gameData, newProject } from './helpers.ts';

const gd = gameData();
const BASE = { datasetId: 'sf-1.2.4.0', gameVersion: '1.2.4.0' };
const port = (type: string, id: string) => portDefs(gd.building(type)!).find((p) => p.id === id)!;

describe('Anschlusslagen aus den Spielpaketen', () => {
  it('alle Gebäude mit Anschlüssen haben Lagen, Anzahl wie in den Spieldaten', () => {
    for (const b of gd.data.buildings ? Object.values(gd.data.buildings) : []) {
      if (!b.ports || Object.values(b.ports).every((n) => n === 0)) continue;
      expect(b.portLayout?.length, b.id).toBe(Object.values(b.ports).reduce((s, n) => s + n, 0));
      expect(portDefs(b).every((p) => p.positionVerified), b.id).toBe(true);
    }
  });

  it('Konstruktor: Eingang hinten, Ausgang vorn, 1 m hoch', () => {
    const i = port('Build_ConstructorMk1_C', 'belt-in-0');
    const o = port('Build_ConstructorMk1_C', 'belt-out-0');
    expect(i.local).toEqual({ x: 0, y: -3 });
    expect(i.normal).toEqual({ x: 0, y: -1 });
    expect(i.z).toBe(1);
    expect(o.local).toEqual({ x: 0, y: 3 });
    expect(o.normal).toEqual({ x: 0, y: 1 });
  });

  it('Raffinerie: Eingänge vorn (+y), Rohr auf 1,75 m', () => {
    expect(port('Build_OilRefinery_C', 'belt-in-0').normal).toEqual({ x: 0, y: 1 });
    expect(port('Build_OilRefinery_C', 'pipe-out-0').normal).toEqual({ x: 0, y: -1 });
    expect(port('Build_OilRefinery_C', 'pipe-in-0').z).toBe(1.75);
  });

  it('Splitter: Eingang bei −x, Ausgänge geradeaus und zu beiden Seiten; Lager Mk.2 mit zwei Höhen', () => {
    expect(port('Build_ConveyorAttachmentSplitter_C', 'belt-in-0').normal).toEqual({ x: -1, y: 0 });
    const outs = portDefs(gd.building('Build_ConveyorAttachmentSplitter_C')!).filter((p) => p.direction === 'out').map((p) => p.normal);
    expect(outs).toEqual([{ x: 1, y: 0 }, { x: 0, y: 1 }, { x: 0, y: -1 }]);
    expect(port('Build_StorageContainerMk2_C', 'belt-in-0').z).toBe(1);
    expect(port('Build_StorageContainerMk2_C', 'belt-in-1').z).toBe(5);
  });

  it('vererbte Komponenten: Miner Mk.3 übernimmt die Lage von Mk.2', () => {
    expect(port('Build_MinerMk3_C', 'belt-out-0').local).toEqual(port('Build_MinerMk2_C', 'belt-out-0').local);
    expect(port('Build_MinerMk3_C', 'belt-out-0').local).toEqual({ x: 0, y: 8 });
  });

  it('Lkw-Station: Treibstoff am äußeren Bandeingang (im Spiel „Input0“)', () => {
    const d = gd.building('Build_TruckStation_C')!;
    expect(d.portLayout!.find((p) => p.kind === 'belt' && p.direction === 'in' && p.index === 0)!.component).toBe('Input0');
    expect(portDefs(d).find((p) => p.role === 'fuel')!.id).toBe('belt-in-0');
  });
});

/** Leitungen, die hinter der Anschlussebene durch ihr eigenes Gebäude zurücklaufen. */
function backwards(p: Project): number {
  let bad = 0;
  for (const l of Object.values(p.links)) {
    const e = linkEnds(p, gd, l);
    const pts = linkPath(p, gd, l);
    if (!e || !pts) continue;
    const behind = (end: typeof e.from, bid: string, x: number, y: number) => {
      const b = p.buildings[bid]!;
      const bb = gd.building(b.type)!.bounds!;
      const pl = b.placement!;
      const a = (-pl.rotationDeg * Math.PI) / 180;
      const dx = x - pl.x;
      const dy = y - pl.y;
      const lx = dx * Math.cos(a) - dy * Math.sin(a);
      const ly = dx * Math.sin(a) + dy * Math.cos(a);
      const inside = lx > bb.minX + 0.3 && lx < bb.maxX - 0.3 && ly > bb.minY + 0.3 && ly < bb.maxY - 0.3;
      return inside && (x - end.world.x) * end.worldNormal.x + (y - end.world.y) * end.worldNormal.y < -0.3;
    };
    let hit = false;
    for (let i = 1; i + 2 < pts.length; i++)
      for (let t = 0; t <= 1; t += 0.05) {
        const x = pts[i]!.x + (pts[i + 1]!.x - pts[i]!.x) * t;
        const y = pts[i]!.y + (pts[i + 1]!.y - pts[i]!.y) * t;
        if (behind(e.from, l.from.buildingId, x, y) || behind(e.to, l.to.buildingId, x, y)) hit = true;
      }
    if (hit) bad++;
  }
  return bad;
}

describe('Auto-Layout und Beispiele mit echten Anschlusslagen', () => {
  it('Beispiele: keine Leitung läuft durch ihr eigenes Start- oder Zielgebäude zurück', () => {
    for (const kind of ['simple', 'complex', 'medium', 'large'] as const) {
      expect(backwards(buildExampleProject(gd, kind, BASE)), kind).toBe(0);
    }
  });

  it('Maschinen werden so gedreht, dass ihre Eingänge zu den Zuführungen zeigen (Raffinerie um 180°)', () => {
    const p = newProject();
    const { factory } = firstFactory(p);
    const id = prodOps.addPlan(p, factory.id, 'Test');
    prodOps.updatePlan(p, gd, id, { targets: [{ itemId: 'Desc_Plastic_C', ratePerMin: 60 }] });
    const drafts = generateLayouts(gd, solveProduction(gd, p.productionPlans[id]!), { pipeTier: 'Build_PipelineMK2_C' });
    expect(drafts.length).toBeGreaterThan(0);
    for (const d of drafts) {
      const machines = d.buildings.filter((b) => b.role === 'machine');
      expect(machines.some((b) => b.type === 'Build_OilRefinery_C')).toBe(true);
      for (const m of machines) {
        const first = portDefs(gd.building(m.type)!).find((x) => x.direction === 'in')!;
        const a = (m.rotationDeg * Math.PI) / 180;
        const ny = first.normal.x * Math.sin(a) + first.normal.y * Math.cos(a);
        expect(ny, `${d.variant} ${m.type}`).toBeCloseTo(-1, 6);
      }
      expect(machines.filter((b) => b.type === 'Build_OilRefinery_C').every((b) => b.rotationDeg === 180)).toBe(true);
    }
  });
});

describe('Hotfix: keine „−0“', () => {
  it('kleine negative Reste werden als 0 angezeigt', () => {
    setLanguage('de');
    expect(formatNumber(-0.004, 2)).toBe('0');
    expect(formatNumber(-1e-9, 2)).toBe('0');
    expect(formatNumber(-0, 2)).toBe('0');
    expect(formatNumber(-0.006, 2)).toBe('-0,01');
    expect(Object.is(roundForDisplay(-0.001, 2), 0)).toBe(true);
    expect(roundForDisplay(1.234, 2)).toBe(1.23);
  });
});

describe('Hotfix 0.8.2: Auto-Layout – kürzere Wege, Lifte, nur nötige Höhen', () => {
  const stats = (kind: 'medium' | 'large') => {
    const p = buildExampleProject(gd, kind, BASE);
    let detour = 0;
    let worst = 0;
    let dips = 0;
    let elevated = 0;
    for (const l of Object.values(p.links)) {
      const e = linkEnds(p, gd, l);
      const pts = linkPath(p, gd, l);
      if (!e || !pts) continue;
      let len = 0;
      for (let i = 1; i < pts.length; i++) len += Math.abs(pts[i]!.x - pts[i - 1]!.x) + Math.abs(pts[i]!.y - pts[i - 1]!.y);
      const d = len - (Math.abs(e.to.world.x - e.from.world.x) + Math.abs(e.to.world.y - e.from.world.y));
      detour += d;
      worst = Math.max(worst, d);
      const zs = pts.map((q) => q.z);
      // Lift „vom Boden aus“: Verbindung zwischen Etagen taucht unter beide Enden ab
      // (auf derselben Etage läuft eine Busleitung gewollt auf 1 m unter den Abzweigen)
      const crossFloor = p.buildings[l.from.buildingId]!.placement!.floorId !== p.buildings[l.to.buildingId]!.placement!.floorId;
      if (Math.min(...zs) < Math.min(e.from.world.z, e.to.world.z) - 0.5 && (crossFloor || l.kind === 'pipe')) dips++;
      if (Math.max(...zs) > Math.max(e.from.world.z, e.to.world.z) + 0.5) elevated++;
    }
    // Flüssigkeitspuffer (0.9) teilen einen Spurabschnitt in zwei
    const buffers = Object.values(p.buildings).filter((b) => b.type === 'Build_PipeStorageTank_C' && b.label.startsWith('Puffer')).length;
    return { detour, worst, dips, elevated, buffers };
  };

  it('großes Beispiel: Umwege mehr als halbiert, kein Lift taucht unter beide Enden ab', () => {
    const s = stats('large');
    // vorher (0.8.1): 1038 m Umweg gesamt, längster 203 m, Verbindungen zwischen Etagen über die Busspur auf 1 m, 20 höher als beide Enden
    expect(s.detour).toBeLessThan(500);
    expect(s.worst).toBeLessThan(80);
    expect(s.dips).toBe(0);
    expect(s.elevated).toBeLessThanOrEqual(14 + s.buffers);
  });

  it('mittleres Beispiel: weniger Leitungen in der Luft, keine Senken', () => {
    const s = stats('medium');
    // vorher: 12 höher als beide Enden, 8 Rohre mit Senke auf 1 m vor dem Anschluss auf 1,75 m
    expect(s.elevated).toBeLessThanOrEqual(9 + s.buffers);
    expect(s.dips).toBe(0);
  });
});
