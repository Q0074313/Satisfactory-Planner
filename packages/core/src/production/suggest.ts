/**
 * Vorschläge für Alternativrezepte, die Rohstoffe sparen.
 *
 * Vorgehen: Der Plan wird einmal mit allen Alternativrezepten gelöst. Jedes
 * dort genutzte, im Plan noch nicht freigeschaltete Alternativrezept wird
 * anschließend einzeln zum Plan hinzugefügt und neu gelöst. Vorgeschlagen
 * wird, was den gewichteten Rohstoffbedarf senkt (Modus „Zielmengen“) bzw.
 * die Skalierung erhöht (Modus „Maximieren“). Daneben steht eine kurze
 * Kombination (höchstens 4 Rezepte), schrittweise aus den besten Ergänzungen
 * aufgebaut, weil manche Rezepte erst gemeinsam etwas bringen.
 */
import type { GameDataIndex } from '../gamedata/index.ts';
import type { ProductionPlan } from '../model/schema.ts';
import { resourceWeight, solveProduction, type SolveOptions, type SolveResult } from './solver.ts';

export interface ResourceDelta {
  itemId: string;
  /** Änderung pro Minute (negativ = Einsparung). */
  delta: number;
}

export interface AlternateSuggestion {
  /** Freizuschaltende Alternativrezepte. */
  recipeIds: string[];
  /** Verbesserung in Prozent (Rohstoffbedarf gewichtet bzw. Skalierung). */
  gainPct: number;
  resources: ResourceDelta[];
}

export interface AlternateSuggestions {
  single: AlternateSuggestion[];
  /** Kurze Kombination (höchstens MAX_COMBINED Rezepte), falls besser als der beste Einzelvorschlag. */
  combined: AlternateSuggestion | null;
}

const MIN_GAIN_PCT = 0.5;
/** Höchstzahl Rezepte in einer Kombination. */
export const MAX_COMBINED = 4;

/** Gewichteter Rohstoffbedarf eines Ergebnisses (Wasser 0, Importe nicht gezählt). */
export function resourceScore(gd: GameDataIndex, plan: ProductionPlan, r: SolveResult): number {
  const imported = new Set(plan.supplies.filter((s) => s.origin === 'import').map((s) => s.itemId));
  let sum = 0;
  for (const i of r.items) if (i.supplied > 0 && gd.item(i.itemId)?.isResource && !imported.has(i.itemId)) sum += i.supplied * resourceWeight(gd, i.itemId);
  return sum;
}

function resourceUse(gd: GameDataIndex, r: SolveResult): Map<string, number> {
  return new Map(r.items.filter((i) => gd.item(i.itemId)?.isResource && i.supplied > 0).map((i) => [i.itemId, i.supplied]));
}

export function suggestAlternates(gd: GameDataIndex, plan: ProductionPlan, opts: SolveOptions = {}): AlternateSuggestions {
  const none: AlternateSuggestions = { single: [], combined: null };
  if (plan.limitToExistingMachines) return none;
  const base = solveProduction(gd, plan, opts);
  if (base.status !== 'optimal' || base.recipes.length === 0) return none;
  const unmet = (r: SolveResult) => r.items.some((i) => i.shortfall > 1e-6);
  if (unmet(base)) return none;
  const maximize = plan.mode === 'maximize';
  const baseScore = maximize ? (base.scale ?? 0) : resourceScore(gd, plan, base);
  if (baseScore <= 1e-9) return none;
  const baseUse = resourceUse(gd, base);

  const enabled = new Set(plan.enabledAlternates);
  const disabled = new Set(plan.disabledRecipes);
  const candidatesAll = Object.values(gd.data.recipes)
    .filter((r) => r.alternate && !enabled.has(r.id) && !disabled.has(r.id) && !opts.locked?.has(r.id))
    .map((r) => r.id);
  const evaluate = (ids: string[]): AlternateSuggestion | null => {
    const r = solveProduction(gd, { ...plan, enabledAlternates: [...plan.enabledAlternates, ...ids] }, opts);
    if (r.status !== 'optimal' || unmet(r)) return null;
    const score = maximize ? (r.scale ?? 0) : resourceScore(gd, plan, r);
    const gainPct = maximize ? ((score - baseScore) / baseScore) * 100 : ((baseScore - score) / baseScore) * 100;
    if (gainPct < MIN_GAIN_PCT) return null;
    const use = resourceUse(gd, r);
    const keys = new Set([...baseUse.keys(), ...use.keys()]);
    const resources = [...keys]
      .map((itemId) => ({ itemId, delta: (use.get(itemId) ?? 0) - (baseUse.get(itemId) ?? 0) }))
      .filter((d) => Math.abs(d.delta) > 1e-6)
      .sort((a, b) => a.delta - b.delta);
    // Nur tatsächlich genutzte Rezepte vorschlagen
    const used = new Set(r.recipes.map((x) => x.recipeId));
    return { recipeIds: ids.filter((id) => used.has(id)), gainPct, resources };
  };

  const full = solveProduction(gd, { ...plan, enabledAlternates: [...plan.enabledAlternates, ...candidatesAll] }, opts);
  if (full.status !== 'optimal') return none;
  const usedInFull = full.recipes.map((r) => r.recipeId).filter((id) => candidatesAll.includes(id));
  const single = usedInFull
    .map((id) => evaluate([id]))
    .filter((s): s is AlternateSuggestion => !!s && s.recipeIds.length > 0)
    .sort((a, b) => b.gainPct - a.gainPct);
  // Kombination schrittweise: jeweils die Ergänzung mit dem größten Zusatznutzen, höchstens MAX_COMBINED Rezepte
  let combo: AlternateSuggestion | null = single[0] ?? null;
  const pool = usedInFull.filter((id) => !combo?.recipeIds.includes(id));
  while (combo && combo.recipeIds.length < MAX_COMBINED && pool.length) {
    let best: AlternateSuggestion | null = null;
    for (const id of pool) {
      const s = evaluate([...combo.recipeIds, id]);
      if (s && s.gainPct > (best?.gainPct ?? combo.gainPct) + 0.1 && s.recipeIds.length > combo.recipeIds.length) best = s;
    }
    if (!best) break;
    combo = best;
    pool.splice(0, pool.length, ...pool.filter((id) => !best!.recipeIds.includes(id)));
  }
  const combined = combo && combo.recipeIds.length > 1 && combo.gainPct > (single[0]?.gainPct ?? 0) + 1e-6 ? combo : null;
  return { single, combined };
}
