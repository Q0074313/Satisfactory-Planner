/**
 * Rezepte nachschlagen und vergleichen: Was braucht ein Rezept, was liefert
 * es, und was kostet der Gegenstand damit insgesamt (Rohstoffe, Maschinen,
 * Strom) – bei sonst nur Standardrezepten für die Vorprodukte.
 */
import type { GameDataIndex, GdRecipe } from '../gamedata/index.ts';
import type { ProductionPlan } from '../model/schema.ts';
import { machinePower, recipeRatesPerMachine } from './machine.ts';
import { resourceWeight, solveProduction } from './solver.ts';

export interface ItemRateRow {
  itemId: string;
  perMin: number;
}

export interface RecipeCost {
  /** Rohstoffe für 60 Einheiten pro Minute (Wasser eingeschlossen). */
  resources: ItemRateRow[];
  /** Nebenprodukte (Überschuss) dabei. */
  byproducts: ItemRateRow[];
  machines: number;
  powerMW: number;
  /** Gewichteter Rohstoffbedarf (wie im Solver: 1000 / weltweites Maximum, Wasser 0). */
  weighted: number;
}

export interface RecipeInfo {
  recipe: GdRecipe;
  building: string;
  /** Je Maschine bei 100 % Takt. */
  inputs: ItemRateRow[];
  outputs: ItemRateRow[];
  powerMW: number;
  /** Kosten für 60/min des Gegenstands; `null` = nicht lösbar (z. B. Vorprodukt nur über Alternativen). */
  cost: RecipeCost | null;
}

/** Basisplan für eine Kostenrechnung (nicht im Projekt gespeichert). */
function costPlan(itemId: string, recipe: GdRecipe, others: GdRecipe[]): ProductionPlan {
  return {
    id: 'recipe-cost',
    factoryId: '',
    name: '',
    mode: 'target',
    targets: [{ itemId, ratePerMin: 60 }],
    supplies: [],
    enabledAlternates: recipe.alternate ? [recipe.id] : [],
    disabledRecipes: others.filter((r) => r.id !== recipe.id).map((r) => r.id),
    machineLimits: [],
    limitToExistingMachines: false,
    optimize: 'resources',
    power: { generators: [] },
    suggestAlternates: false,
  };
}

/** Alle Rezepte, die den Gegenstand herstellen (Haupt- oder Nebenprodukt), mit Kennzahlen. */
export function recipesFor(gd: GameDataIndex, itemId: string): RecipeInfo[] {
  const producing = gd.recipesProducing(itemId).filter((r) => !r.generator);
  return producing
    .map((recipe) => {
      const building = recipe.producedIn[0]!;
      const def = gd.building(building);
      const rates = recipeRatesPerMachine(recipe, def);
      let cost: RecipeCost | null = null;
      const res = solveProduction(gd, costPlan(itemId, recipe, producing));
      if (res.status === 'optimal' && !res.items.some((i) => i.shortfall > 1e-6)) {
        const resources = res.items.filter((i) => gd.item(i.itemId)?.isResource && i.supplied > 1e-6).map((i) => ({ itemId: i.itemId, perMin: i.supplied }));
        cost = {
          resources,
          byproducts: res.items.filter((i) => i.itemId !== itemId && i.surplus > 1e-6).map((i) => ({ itemId: i.itemId, perMin: i.surplus })),
          machines: res.recipes.reduce((s, r) => s + r.machines, 0),
          powerMW: res.recipes.reduce((s, r) => s + (gd.building(r.building) ? machinePower(gd.building(r.building)!, gd.recipe(r.recipeId), 1, 0).avg * r.machines : 0), 0),
          weighted: resources.reduce((s, x) => s + x.perMin * resourceWeight(gd, x.itemId), 0),
        };
      }
      return {
        recipe,
        building,
        inputs: rates.inputs.map((x) => ({ itemId: x.item, perMin: x.perMin })),
        outputs: rates.outputs.map((x) => ({ itemId: x.item, perMin: x.perMin })),
        powerMW: def ? machinePower(def, recipe, 1, 0).avg : 0,
        cost,
      };
    })
    .sort((a, b) => Number(a.recipe.alternate) - Number(b.recipe.alternate) || (a.cost?.weighted ?? Infinity) - (b.cost?.weighted ?? Infinity));
}
