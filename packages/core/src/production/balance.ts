/**
 * Vergleich Soll (Produktionsplan) ↔ Geplant ↔ Platziert ↔ Angeschlossen.
 *
 * Alle Stufen beziehen sich auf dieselben Building-Objekte der Fabrik:
 * - Geplant: alle Maschinen mit dem Rezept (Summe der Takte)
 * - Platziert: davon im Grundriss aufgestellt
 * - Angeschlossen: davon mit so vielen verbundenen Ein- und Ausgängen, wie
 *   das Rezept Feststoffe bzw. Flüssigkeiten benötigt (welcher Gegenstand über
 *   welchen Anschluss läuft, bestimmt im Spiel die Belegung, nicht der Anschluss)
 * - Durchsatz: Takt × Auslastung laut Durchsatzmodell der eingezeichneten
 *   Verbindungen (Kapazität der gezeichneten Stufen, Versorgung, Abfluss)
 */
import { computeFactoryFlow, type FactoryFlow } from '../factory/flow.ts';
import type { GameDataIndex } from '../gamedata/index.ts';
import { getLanguage } from '../i18n/index.ts';
import type { Building, Project } from '../model/schema.ts';
import { machineRates } from './machine.ts';
import type { SolveResult } from './solver.ts';

export interface RecipeBalanceRow {
  recipeId: string;
  soll: number;
  geplant: number;
  platziert: number;
  angeschlossen: number;
  /** Maschinenäquivalente, die mit den eingezeichneten Verbindungen tatsächlich laufen. */
  durchsatz: number;
  machinesGeplant: number;
  machinesPlatziert: number;
}

export interface ItemBalanceRow {
  itemId: string;
  /** Nettoerzeugung laut Plan (Produktion − Verbrauch). */
  soll: number;
  geplant: number;
  platziert: number;
  angeschlossen: number;
  durchsatz: number;
}

export function isConnected(p: Project, gd: GameDataIndex, b: Building): boolean {
  if (!b.placement || !b.recipeId) return false;
  const recipe = gd.recipe(b.recipeId);
  if (!recipe) return false;
  const count = (list: { item: string }[], solid: boolean) => list.filter((a) => (gd.item(a.item)?.form === 'solid') === solid).length;
  const links = Object.values(p.links).filter((l) => l.from.buildingId === b.id || l.to.buildingId === b.id);
  const connected = (prefix: string) =>
    links.filter((l) => (l.from.buildingId === b.id && l.from.portId.startsWith(prefix)) || (l.to.buildingId === b.id && l.to.portId.startsWith(prefix))).length;
  const pipeAny = connected('pipe-any');
  return (
    connected('belt-in') >= count(recipe.inputs, true) &&
    connected('belt-out') >= count(recipe.outputs, true) &&
    connected('pipe-in') + pipeAny >= count(recipe.inputs, false) &&
    connected('pipe-out') + pipeAny >= count(recipe.outputs, false)
  );
}

export function compareBalance(p: Project, gd: GameDataIndex, factoryId: string, result: SolveResult | null, opts: { flow?: FactoryFlow } = {}) {
  const recipes = new Map<string, RecipeBalanceRow>();
  const items = new Map<string, ItemBalanceRow>();
  const rrow = (id: string) => {
    let r = recipes.get(id);
    if (!r) {
      r = { recipeId: id, soll: 0, geplant: 0, platziert: 0, angeschlossen: 0, durchsatz: 0, machinesGeplant: 0, machinesPlatziert: 0 };
      recipes.set(id, r);
    }
    return r;
  };
  const irow = (id: string) => {
    let r = items.get(id);
    if (!r) {
      r = { itemId: id, soll: 0, geplant: 0, platziert: 0, angeschlossen: 0, durchsatz: 0 };
      items.set(id, r);
    }
    return r;
  };
  for (const r of result?.recipes ?? []) {
    rrow(r.recipeId).soll += r.machines;
    for (const o of r.outputs) irow(o.item).soll += o.perMin;
    for (const i of r.inputs) irow(i.item).soll -= i.perMin;
  }
  const flow = opts.flow ?? computeFactoryFlow(p, gd, factoryId);
  for (const b of Object.values(p.buildings)) {
    if (b.factoryId !== factoryId || !b.recipeId) continue;
    const row = rrow(b.recipeId);
    const conn = isConnected(p, gd, b);
    const util = flow.machines.get(b.id)?.utilization ?? 0;
    // Maschinenäquivalente bezogen auf den Zutatenverbrauch (Takt); Somersloops erhöhen nur die Ausgabe
    const eq = b.clock;
    row.geplant += eq;
    row.machinesGeplant++;
    if (b.placement) {
      row.platziert += eq;
      row.machinesPlatziert++;
    }
    if (conn) row.angeschlossen += eq;
    row.durchsatz += eq * util;
    const rates = machineRates(gd, b);
    const add = (item: string, v: number) => {
      const r = irow(item);
      r.geplant += v;
      if (b.placement) r.platziert += v;
      if (conn) r.angeschlossen += v;
      r.durchsatz += v * util;
    };
    for (const o of rates.outputs) add(o.item, o.perMin);
    for (const i of rates.inputs) add(i.item, -i.perMin);
  }
  return {
    recipes: [...recipes.values()].sort((a, b) => gd.name(a.recipeId).localeCompare(gd.name(b.recipeId), getLanguage())),
    items: [...items.values()].sort((a, b) => gd.name(a.itemId).localeCompare(gd.name(b.itemId), getLanguage())),
  };
}
