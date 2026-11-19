/**
 * Operationen auf Produktionsplänen und die Übernahme des Ergebnisses als
 * (noch nicht platzierte) Maschinen in die Fabrik.
 */
import type { GameDataIndex } from '../../gamedata/index.ts';
import { tr } from '../../i18n/index.ts';
import { newId } from '../../model/ids.ts';
import type { Building, ProductionPlan, Project } from '../../model/schema.ts';
import { OpError } from '../errors.ts';

export function addPlan(p: Project, factoryId: string, name: string): string {
  if (!p.factories[factoryId]) throw new OpError(tr('{what} nicht gefunden.', { what: tr('Fabrik') }));
  const id = newId('productionPlan');
  p.productionPlans[id] = {
    id,
    factoryId,
    name,
    mode: 'target',
    targets: [],
    supplies: [],
    enabledAlternates: [],
    disabledRecipes: [],
    machineLimits: [],
    limitToExistingMachines: false,
    optimize: 'resources',
    power: { generators: [] },
    suggestAlternates: false,
  };
  return id;
}

export type PlanPatch = Partial<Omit<ProductionPlan, 'id' | 'factoryId'>>;

export function updatePlan(p: Project, gd: GameDataIndex, id: string, patch: PlanPatch): void {
  const plan = p.productionPlans[id];
  if (!plan) throw new OpError(tr('{what} nicht gefunden.', { what: tr('Produktionsplan') }));
  for (const t of patch.targets ?? []) {
    if (!gd.item(t.itemId)) throw new OpError(tr('Gegenstand {id} unbekannt.', { id: t.itemId }));
    if (!(t.ratePerMin >= 0)) throw new OpError(tr('Zielmengen dürfen nicht negativ sein.'));
  }
  for (const s of patch.supplies ?? []) {
    if (!gd.item(s.itemId)) throw new OpError(tr('Gegenstand {id} unbekannt.', { id: s.itemId }));
    if (s.maxPerMin !== null && !(s.maxPerMin >= 0)) throw new OpError(tr('Versorgungsmengen dürfen nicht negativ sein.'));
  }
  for (const g of patch.power?.generators ?? []) {
    if (!gd.recipe(g.recipeId)?.generator) throw new OpError(tr('Rezept {id} unbekannt.', { id: g.recipeId }));
    if (!(g.count >= 0)) throw new OpError(tr('Die Anzahl darf nicht negativ sein.'));
  }
  for (const r of [...(patch.enabledAlternates ?? []), ...(patch.disabledRecipes ?? [])]) {
    if (!gd.recipe(r)) throw new OpError(tr('Rezept {id} unbekannt.', { id: r }));
  }
  Object.assign(plan, patch);
}

export function removePlan(p: Project, id: string): void {
  if (!p.productionPlans[id]) throw new OpError(tr('{what} nicht gefunden.', { what: tr('Produktionsplan') }));
  delete p.productionPlans[id];
}

export interface MaterializeTarget {
  recipeId: string;
  /** Benötigte Maschinenäquivalente (100 % Takt). */
  machines: number;
}

/**
 * Legt fehlende Maschinen als nicht platzierte Gebäude an. Bereits vorhandene
 * Maschinen mit demselben Rezept werden angerechnet. Mit `adjustClocks`
 * werden die Takte aller Maschinen des Rezepts gleichmäßig so gesetzt, dass
 * die Summe dem Soll entspricht (vorhandene Somersloops bleiben unberücksichtigt).
 */
export function materializePlan(
  p: Project,
  gd: GameDataIndex,
  factoryId: string,
  targets: MaterializeTarget[],
  opts: { adjustClocks: boolean },
): { created: string[]; adjusted: number } {
  if (!p.factories[factoryId]) throw new OpError(tr('{what} nicht gefunden.', { what: tr('Fabrik') }));
  const created: string[] = [];
  let adjusted = 0;
  for (const t of targets) {
    const recipe = gd.recipe(t.recipeId);
    if (!recipe) throw new OpError(tr('Rezept {id} unbekannt.', { id: t.recipeId }));
    const type = recipe.producedIn[0]!;
    const existing = Object.values(p.buildings).filter((b) => b.factoryId === factoryId && b.recipeId === t.recipeId);
    const need = Math.max(1, Math.ceil(t.machines - 1e-6));
    for (let i = existing.length; i < need; i++) {
      const id = newId('building');
      const b: Building = {
        id,
        factoryId,
        type,
        label: '',
        recipeId: t.recipeId,
        clock: 1,
        somersloops: 0,
        placement: null,
        groupInstance: null,
        extraction: null,
        transfer: null,
        stationPart: null,
        sortRules: null,
        notes: '',
      };
      p.buildings[id] = b;
      existing.push(b);
      created.push(id);
    }
    if (opts.adjustClocks && gd.building(type)?.clock) {
      const clock = Math.round((t.machines / existing.length) * 1e6) / 1e6;
      const max = gd.fact('production.clock.maxWithShards') ?? 2.5;
      const min = gd.building(type)!.clock!.min;
      const c = Math.min(max, Math.max(min, clock));
      for (const b of existing) {
        if (b.clock !== c) {
          b.clock = c;
          adjusted++;
        }
      }
    }
  }
  return { created, adjusted };
}
