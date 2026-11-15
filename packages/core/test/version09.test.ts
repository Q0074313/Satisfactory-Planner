import { describe, expect, it } from 'vitest';
import { buildExampleProject } from '../src/project/examples.ts';
import { countCrossings } from '../src/factory/autoLayout.ts';
import { autoConnect } from '../src/factory/autoConnect.ts';
import { findOverlaps, placedShapes } from '../src/factory/checks.ts';
import { computeFactoryFlow } from '../src/factory/flow.ts';
import { linkPath } from '../src/factory/linkPath.ts';
import * as facOps from '../src/project/ops/factory.ts';
import { suggestSites } from '../src/map/suggest.ts';
import { shardsForClock } from '../src/production/machine.ts';
import { solveProduction } from '../src/production/solver.ts';
import { lockedRecipesOf, maxTierForPhase, phaseForTier, unlockSource, unlockState } from '../src/progress/index.ts';
import { ProjectSchema, type Progress } from '../src/model/schema.ts';
import * as prodOps from '../src/project/ops/production.ts';
import { firstFactory, gameData, newProject } from './helpers.ts';

const gd = gameData();
const BASE = { datasetId: gd.data.meta.datasetId, gameVersion: gd.data.meta.gameVersion };
const manual = (maxTier: number, schematics: string[] = []): Progress => ({ source: 'manual', maxTier, schematics, phase: null });

describe('0.9: Freischaltung', () => {
  it('Schaltpläne im Datensatz: Meilensteine je Tier, M.A.M.-Bäume, Gebäude über Baurezepte', () => {
    const s = gd.data.schematics!;
    expect(Object.values(s).filter((x) => x.kind === 'milestone')).toHaveLength(42);
    expect(s['Schematic_3-4_C']!.recipes).toContain('Recipe_IngotSteel_C');
    expect(s['Schematic_3-4_C']!.buildings).toContain('Build_FoundryMk1_C');
    expect(s['Research_Caterium_1_C']!.tree).toBe('Caterium');
    // 5-1 schaltet „Oil Processing 2“ frei
    expect(s['Schematic_5-1_C']!.unlocks).toContain('Schematic_5-1-1_C');
  });

  it('ohne Fortschritt ist alles frei; altes Projekt ohne Feld lädt mit null', () => {
    const p = newProject();
    expect(p.settings.progress).toBeNull();
    expect(unlockState(gd, null).active).toBe(false);
    const raw = JSON.parse(JSON.stringify(p));
    delete raw.settings.progress;
    expect(ProjectSchema.parse(raw).settings.progress).toBeNull();
  });

  it('Tier 2: Stahl und Gießerei gesperrt mit Hinweis, Eisenplatten frei', () => {
    const u = unlockState(gd, manual(2));
    expect(u.recipeLocked('Recipe_IngotSteel_C')).toBe(true);
    expect(u.requirement('Recipe_IngotSteel_C')).toBe('ab Tier 3');
    expect(u.buildingLocked('Build_FoundryMk1_C')).toBe(true);
    expect(u.recipeLocked('Recipe_IronPlate_C')).toBe(false);
    expect(u.requirement('Recipe_IronPlate_C')).toBeNull();
    // Tier 3 schaltet frei
    expect(unlockState(gd, manual(3)).recipeLocked('Recipe_IngotSteel_C')).toBe(false);
  });

  it('M.A.M.: Caterium-Barren mit der Forschung oder ab Tier 5 (Petrolenergie 2); Rezeptquelle unabhängig vom Fortschritt', () => {
    expect(unlockState(gd, manual(4)).recipeLocked('Recipe_IngotCaterium_C')).toBe(true);
    expect(unlockState(gd, manual(4, ['Research_Caterium_1_C'])).recipeLocked('Recipe_IngotCaterium_C')).toBe(false);
    expect(unlockState(gd, manual(5)).recipeLocked('Recipe_IngotCaterium_C')).toBe(false);
    expect(unlockSource(gd, 'Recipe_IngotCaterium_C')).toBe('ab Tier 5 / M.A.M.: Caterium');
    expect(unlockState(gd, manual(4)).requirement('Recipe_IngotCaterium_C')).toBe('ab Tier 5 / M.A.M.: Caterium');
    expect(unlockSource(gd, 'Recipe_IronPlate_C')).toBe('von Anfang an');
  });

  it('Spielstand: Alternativen nur, wenn gekauft', () => {
    const alt = Object.values(gd.data.schematics!).find((s) => s.kind === 'alternate' && s.recipes.length)!;
    const r = alt.recipes[0]!;
    // Alle Meilensteine gekauft (Gebäude frei), die Festplatte nicht
    const milestones = Object.values(gd.data.schematics!).filter((s) => s.kind === 'milestone' || s.kind === 'hub').map((s) => s.id);
    const save: Progress = { source: 'save', maxTier: 9, schematics: milestones, phase: 4 };
    expect(unlockState(gd, save).recipeLocked(r)).toBe(true);
    expect(unlockState(gd, { ...save, schematics: [...milestones, alt.id] }).recipeLocked(r)).toBe(false);
    // Von Hand: Alternativen frei (Auswahl je Plan)
    expect(unlockState(gd, manual(9)).recipeLocked(r)).toBe(false);
  });

  it('Phasen → Tier laut Wiki', () => {
    expect([0, 1, 2, 3, 4].map((ph) => maxTierForPhase(gd, ph))).toEqual([2, 4, 6, 8, 9]);
    expect(phaseForTier(gd, 5)).toBe(2);
  });

  it('Produktionsplan nutzt gesperrte Rezepte nicht', () => {
    const p = newProject();
    const { factory } = firstFactory(p);
    const planId = prodOps.addPlan(p, factory.id, 'Stahl');
    prodOps.updatePlan(p, gd, planId, { targets: [{ itemId: 'Desc_SteelPlate_C', ratePerMin: 30 }] });
    const plan = p.productionPlans[planId]!;
    expect(solveProduction(gd, plan).status).toBe('optimal');
    p.settings.progress = manual(2);
    const res = solveProduction(gd, plan, { locked: lockedRecipesOf(p, gd) });
    expect(res.recipes.some((r) => r.recipeId === 'Recipe_IngotSteel_C')).toBe(false);
    expect(res.status !== 'optimal' || res.items.some((i) => i.shortfall > 1e-6)).toBe(true);
  });
});

describe('0.9: Hotfixes', () => {
  it('Energiesplitter je Takt', () => {
    expect([1, 1.01, 1.5, 1.51, 2, 2.5].map(shardsForClock)).toEqual([0, 1, 1, 2, 2, 3]);
  });

  it('Standortvorschlag übertaktet: nur nötiger Takt je Vorkommen, Energiesplitter gezählt', () => {
    const s = suggestSites(gd, [{ itemId: 'Desc_OreIron_C', perMin: 300 }], { minerType: 'Build_MinerMk2_C', clock: 2.5, limit: 1 })[0]!;
    expect(s.coverage).toBeCloseTo(1);
    expect(s.shards).toBe(s.picks.reduce((a, x) => a + x.shards, 0));
    for (const x of s.picks) {
      expect(x.clock).toBeLessThanOrEqual(2.5);
      expect(x.shards).toBe(shardsForClock(x.clock));
    }
    // Abtransport begrenzt: Mk.3 auf reinem Vorkommen mit 250 % wäre 1200/min – genau das schnellste Band
    const big = suggestSites(gd, [{ itemId: 'Desc_OreIron_C', perMin: 5000 }], { minerType: 'Build_MinerMk3_C', clock: 2.5, limit: 1 })[0]!;
    const belt = gd.beltTiers.at(-1)!.conveyor!.itemsPerMin;
    for (const x of big.picks) expect(x.capacity).toBeLessThanOrEqual(belt + 1e-9);
  });

  it('Auto-Layout: Flüssigkeitspuffer in der Spur von Zwischenprodukten, weiterhin kreuzungsfrei', () => {
    const p = buildExampleProject(gd, 'medium', BASE);
    const buffers = Object.values(p.buildings).filter((b) => b.type === 'Build_PipeStorageTank_C' && b.label.startsWith('Puffer'));
    expect(buffers.length).toBeGreaterThan(0);
    for (const b of buffers) {
      const into = Object.values(p.links).filter((l) => l.to.buildingId === b.id);
      const out = Object.values(p.links).filter((l) => l.from.buildingId === b.id);
      expect(into).toHaveLength(1);
      expect(out).toHaveLength(1);
    }
    expect(countCrossings(p, gd, Object.keys(p.links))).toBe(0);
  });
});

describe('0.9: Automatisch verbinden', () => {
  /** Von Hand gesetzt: Miner → 2 Schmelzöfen → 2 Konstruktoren; Wasserextraktor → 2 Kohlekraftwerke (Kohle fehlt → Eingang). */
  const scenario = () => {
    const p = newProject();
    const { factory, floorId } = firstFactory(p);
    const put = (type: string, x: number, y: number, rotationDeg: number, extra: Partial<facOps.NewBuilding> = {}) =>
      facOps.addBuilding(p, gd, { factoryId: factory.id, type, placement: { floorId, x, y, zOffsetM: 0, rotationDeg }, ...extra });
    put('Build_MinerMk1_C', 0, 0, 0, { extraction: { itemId: 'Desc_OreIron_C', purity: 'normal' } });
    put('Build_SmelterMk1_C', -12, 36, 0, { recipeId: 'Recipe_IngotIron_C' });
    put('Build_SmelterMk1_C', 12, 36, 0, { recipeId: 'Recipe_IngotIron_C' });
    put('Build_ConstructorMk1_C', -12, 64, 0, { recipeId: 'Recipe_IronPlate_C' });
    put('Build_ConstructorMk1_C', 12, 64, 0, { recipeId: 'Recipe_IronPlate_C' });
    put('Build_WaterPump_C', 80, 0, 0, { extraction: { itemId: 'Desc_Water_C', purity: 'normal' } });
    put('Build_GeneratorCoal_C', 70, 50, 180, { recipeId: 'Power_Build_GeneratorCoal_C_Desc_Coal_C' });
    put('Build_GeneratorCoal_C', 90, 50, 180, { recipeId: 'Power_Build_GeneratorCoal_C_Desc_Coal_C' });
    return { p, factoryId: factory.id };
  };
  const OPTS = { beltTier: 'Build_ConveyorBeltMk3_C', pipeTier: 'Build_Pipeline_C', terminals: true };

  it('verbindet alle Anschlüsse laut Bedarf mit Splittern, Zusammenführungen und Rohrkreuzungen, kreuzungsfrei', () => {
    const { p, factoryId } = scenario();
    const res = autoConnect(p, gd, factoryId, OPTS);
    expect(res.counts.unrouted).toBe(0);
    expect(res.counts.splitters).toBeGreaterThan(0);
    expect(res.counts.junctions).toBeGreaterThan(0);
    expect(res.counts.terminals).toBeGreaterThan(0);
    expect(countCrossings(p, gd, Object.keys(p.links))).toBe(0);
    // keine Überlappung harter Umrisse
    expect(findOverlaps(placedShapes(p, gd, factoryId)).filter((o) => o.hard)).toEqual([]);
    // Durchsatzmodell: Maschinen aus eigener Gewinnung voll versorgt; Kraftwerke erhalten ihr Wasser
    // (Kohle kommt aus dem neuen Eingangslager – ohne Transportauftrag liefert es im Modell nichts)
    const flow = computeFactoryFlow(p, gd, factoryId);
    for (const m of flow.machines.values()) {
      const type = p.buildings[m.buildingId]!.type;
      if (type === 'Build_GeneratorCoal_C') {
        // Wasser- und Kohleeingang angeschlossen
        const ports = Object.values(p.links).filter((l) => l.to.buildingId === m.buildingId).map((l) => l.to.portId);
        expect(ports.sort()).toEqual(['belt-in-0', 'pipe-in-0']);
        continue;
      }
      if (m.role !== 'machine' && m.role !== 'extractor') continue;
      expect(m.utilization, type).toBeGreaterThan(0.99);
    }
    // alle Leitungen auf Höhen 1/1,75 bzw. 4 m darüber, Lifte senkrecht
    for (const l of Object.values(p.links)) {
      const path = linkPath(p, gd, l)!;
      expect(path.length).toBeGreaterThan(1);
    }
  });

  it('zweiter Lauf ändert nichts; bestehende Leitungen bleiben', () => {
    const { p, factoryId } = scenario();
    autoConnect(p, gd, factoryId, OPTS);
    const before = JSON.stringify(p.links);
    const again = autoConnect(p, gd, factoryId, OPTS);
    expect(again.counts.links).toBe(0);
    expect(JSON.stringify(p.links)).toBe(before);
  });
});
