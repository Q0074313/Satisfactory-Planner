import { describe, expect, it } from 'vitest';
import { countCrossings } from '../src/factory/autoLayout.ts';
import { computeFactoryFlow } from '../src/factory/flow.ts';
import { groupSave, projectFromSave } from '../src/import/fromSave.ts';
import { ProjectSchema } from '../src/model/schema.ts';
import { solveProduction } from '../src/production/solver.ts';
import { lockedRecipesOf } from '../src/progress/index.ts';
import { gameData } from './helpers.ts';
import { fixture } from './saveFixture.ts';

const gd = gameData();
const BASE = { name: 'Import', datasetId: gd.data.meta.datasetId, gameVersion: gd.data.meta.gameVersion };

describe('0.9: Spielstand-Import', () => {
  it('gruppiert über Verbindungen und Nähe: Hauptfabrik und Bahnhof mit Lager', () => {
    const g = groupSave(fixture(), gd);
    expect(g.groups).toHaveLength(2);
    const main = g.groups.find((x) => x.buildingIds.includes('Miner'))!;
    expect(main.buildingIds).toEqual(expect.arrayContaining(['Smelter', 'Constructor', 'Pump', 'J1', 'J2', 'Gen1', 'Gen2']));
    expect(main.name).toContain('Eisen');
    const station = g.groups.find((x) => x.buildingIds.includes('Station'))!;
    expect(station.buildingIds).toEqual(expect.arrayContaining(['Platform', 'Box']));
  });

  it('baut Fabriken, Leitungen, Schienennetz, Pläne und Fortschritt auf', () => {
    const ex = fixture();
    const g = groupSave(ex, gd);
    const { project: p, report } = projectFromSave(ex, gd, { ...BASE, groups: g.groups, rail: true, plans: true });
    ProjectSchema.parse(p);
    expect(report.factories).toBe(2);
    expect(report.linksFailed).toBe(0);
    // Fortschritt aus dem Spielstand
    expect(p.settings.progress).toMatchObject({ source: 'save', maxTier: 3, phase: 1 });
    // Fabrik auf dem Weltraster (Fundamentkante bei 8k + 4 m), Gebäude lokal
    const main = Object.values(p.factories).find((f) => f.name.includes('Eisen'))!;
    expect((((main.map!.x - 4) % 8) + 8) % 8).toBeCloseTo(0);
    const miner = Object.values(p.buildings).find((b) => b.type === 'Build_MinerMk1_C')!;
    expect(miner.extraction?.itemId).toBe('Desc_OreIron_C');
    expect(miner.extraction?.nodeId).toBeTruthy();
    expect(miner.clock).toBe(0.5);
    // Bandkette mit zwei Liften als eine Leitung, Lifte senkrecht
    const smelter = Object.values(p.buildings).find((b) => b.type === 'Build_SmelterMk1_C')!;
    const toConstructor = Object.values(p.links).find((l) => l.from.buildingId === smelter.id)!;
    const zs = toConstructor.waypoints.map((w) => w.z);
    expect(Math.max(...zs) - Math.min(...zs)).toBeCloseTo(4);
    expect(toConstructor.tier).toBe('Build_ConveyorBeltMk2_C');
    // Durchsatz: Miner (50 %) → Schmelzofen → Konstruktor voll ausgelastet
    const flow = computeFactoryFlow(p, gd, main.id);
    for (const type of ['Build_MinerMk1_C', 'Build_SmelterMk1_C', 'Build_ConstructorMk1_C']) {
      const b = Object.values(p.buildings).find((x) => x.type === type)!;
      expect(flow.machines.get(b.id)!.utilization, type).toBeGreaterThan(0.99);
    }
    // Rohre von der Pumpe weg ausgerichtet, auch zwischen den Rohrkreuzungen
    const id = (type: string, x: number) => Object.values(p.buildings).find((b) => b.type === type && Math.abs(b.placement!.y - x) < 1e-6)!.id;
    const pump = Object.values(p.buildings).find((b) => b.type === 'Build_WaterPump_C')!;
    const j1 = id('Build_PipelineJunction_Cross_C', smelter.placement!.y);
    const pipes = Object.values(p.links).filter((l) => l.kind === 'pipe');
    expect(pipes).toHaveLength(4);
    expect(pipes.find((l) => l.from.buildingId === pump.id)?.to.buildingId).toBe(j1);
    expect(pipes.some((l) => l.from.buildingId === j1 && p.buildings[l.to.buildingId]!.type === 'Build_PipelineJunction_Cross_C')).toBe(true);
    expect(pipes.filter((l) => p.buildings[l.to.buildingId]!.type === 'Build_GeneratorCoal_C')).toHaveLength(2);
    expect(countCrossings(p, gd, Object.keys(p.links))).toBe(0);
    // Schienennetz: Bahnhof mit Entlade-Plattform, Bahnhofsteile im Grundriss, Band am Bahnsteig
    const st = Object.values(p.stations)[0]!;
    expect(st.name).toBe('Erzbahnhof');
    expect(st.platforms).toMatchObject([{ type: 'freight', mode: 'unload' }]);
    expect(st.factoryId).toBeTruthy();
    const parts = Object.values(p.buildings).filter((b) => b.stationPart?.stationId === st.id);
    expect(parts).toHaveLength(2);
    const platform = parts.find((b) => b.stationPart!.platformId)!;
    expect(Object.values(p.links).some((l) => l.from.buildingId === platform.id)).toBe(true);
    expect(Object.keys(p.railSegments)).toHaveLength(3);
    expect(Object.values(p.railSignals)).toHaveLength(1);
    const train = Object.values(p.trains)[0]!;
    expect(train.consist.map((v) => v.kind)).toEqual(['locomotive', 'wagon']);
    expect(p.timetables[train.timetableId!]!.stops).toMatchObject([{ stationId: st.id, waitS: 20, condition: 'fully-unloaded' }]);
    // Produktionsplan bildet die Maschinen nach
    const plan = Object.values(p.productionPlans).find((x) => x.factoryId === main.id)!;
    expect(plan.targets).toEqual([{ itemId: 'Desc_IronPlate_C', ratePerMin: 20 }]);
    const res = solveProduction(gd, plan, { existingMachines: Object.values(p.buildings).filter((b) => b.factoryId === main.id), locked: lockedRecipesOf(p, gd) });
    expect(res.status).toBe('optimal');
    expect(res.items.every((i) => i.shortfall < 1e-6)).toBe(true);
  });

  it('ohne Schienennetz und Pläne; leere Gruppenauswahl ergibt ein leeres Projekt', () => {
    const ex = fixture();
    const g = groupSave(ex, gd);
    const only = projectFromSave(ex, gd, { ...BASE, groups: g.groups.slice(0, 1), rail: false, plans: false });
    expect(Object.keys(only.project.railNodes)).toHaveLength(0);
    expect(Object.keys(only.project.productionPlans)).toHaveLength(0);
    expect(only.report.factories).toBe(1);
    const none = projectFromSave(ex, gd, { ...BASE, groups: [], rail: false, plans: false });
    expect(Object.keys(none.project.factories)).toHaveLength(0);
  });
});
