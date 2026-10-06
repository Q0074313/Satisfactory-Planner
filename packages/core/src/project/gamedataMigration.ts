/**
 * Wechsel des Spieldatensatzes eines Projekts (z. B. nach einem Spielupdate).
 *
 * Projekte speichern Gebäudetypen, Rezepte und Gegenstände als IDs aus dem
 * Datensatz. Beim Wechsel wird zuerst ein Bericht erstellt (Trockenlauf):
 * welche IDs im Zieldatensatz fehlen und wie viele Objekte betroffen sind.
 * Umbenennungen lassen sich über eine Zuordnungstabelle angeben. Beim
 * Anwenden werden IDs umgeschrieben, nicht mehr vorhandene Rezepte entfernt
 * und Ziele bzw. Versorgungen mit unbekannten Gegenständen gestrichen.
 * Gebäude mit unbekanntem Typ bleiben erhalten und werden als Befund FAB-010
 * gemeldet, damit nichts stillschweigend verloren geht.
 */
import type { GameDataIndex } from '../gamedata/index.ts';
import { tr } from '../i18n/index.ts';
import type { Project } from '../model/schema.ts';

export interface IdRenames {
  buildings?: Record<string, string>;
  recipes?: Record<string, string>;
  items?: Record<string, string>;
}

export interface GameDataMigrationReport {
  fromDatasetId: string;
  toDatasetId: string;
  missingBuildings: { id: string; count: number }[];
  missingRecipes: { id: string; count: number }[];
  missingItems: { id: string; count: number }[];
  renamed: { kind: 'building' | 'recipe' | 'item'; from: string; to: string; count: number }[];
  /** Kurze Zusammenfassung je Änderung. */
  notes: string[];
}

function count(map: Map<string, number>, id: string) {
  map.set(id, (map.get(id) ?? 0) + 1);
}

/** Alle Datensatz-IDs, die das Projekt verwendet, mit Häufigkeit. */
export function usedGameDataIds(p: Project) {
  const buildings = new Map<string, number>();
  const recipes = new Map<string, number>();
  const items = new Map<string, number>();
  for (const b of Object.values(p.buildings)) {
    count(buildings, b.type);
    if (b.recipeId) count(recipes, b.recipeId);
    if (b.extraction) count(items, b.extraction.itemId);
  }
  for (const l of Object.values(p.links)) count(buildings, l.tier);
  for (const g of Object.values(p.groups)) {
    for (const m of g.members) {
      count(buildings, m.type);
      if (m.recipeId) count(recipes, m.recipeId);
    }
    for (const l of g.links) count(buildings, l.tier);
  }
  for (const a of Object.values(p.areas)) if (a.foundationType) count(buildings, a.foundationType);
  for (const plan of Object.values(p.productionPlans)) {
    for (const t of plan.targets) count(items, t.itemId);
    for (const s of plan.supplies) count(items, s.itemId);
    for (const r of [...plan.enabledAlternates, ...plan.disabledRecipes, ...plan.machineLimits.map((m) => m.recipeId)]) count(recipes, r);
  }
  for (const o of Object.values(p.transportOrders)) count(items, o.itemId);
  for (const tt of Object.values(p.timetables)) for (const s of tt.stops) for (const i of s.itemIds) count(items, i);
  return { buildings, recipes, items };
}

export function planGameDataMigration(p: Project, to: GameDataIndex, renames: IdRenames = {}): GameDataMigrationReport {
  const used = usedGameDataIds(p);
  const report: GameDataMigrationReport = {
    fromDatasetId: p.gameData.datasetId,
    toDatasetId: to.data.meta.datasetId,
    missingBuildings: [],
    missingRecipes: [],
    missingItems: [],
    renamed: [],
    notes: [],
  };
  const check = (
    kind: 'building' | 'recipe' | 'item',
    usedMap: Map<string, number>,
    exists: (id: string) => boolean,
    rename: Record<string, string> | undefined,
    missing: { id: string; count: number }[],
  ) => {
    for (const [id, n] of usedMap) {
      const target = rename?.[id];
      if (target && exists(target)) report.renamed.push({ kind, from: id, to: target, count: n });
      else if (!exists(id)) missing.push({ id, count: n });
    }
  };
  check('building', used.buildings, (id) => !!to.building(id), renames.buildings, report.missingBuildings);
  check('recipe', used.recipes, (id) => !!to.recipe(id), renames.recipes, report.missingRecipes);
  check('item', used.items, (id) => !!to.item(id), renames.items, report.missingItems);
  if (report.missingBuildings.length)
    report.notes.push(tr('{n} Gebäudetyp(en) fehlen im Zieldatensatz; betroffene Gebäude bleiben erhalten und werden als Befund gemeldet.', { n: report.missingBuildings.length }));
  if (report.missingRecipes.length) report.notes.push(tr('{n} Rezept(e) fehlen; Maschinen verlieren ihr Rezept, Pläne die Auswahl.', { n: report.missingRecipes.length }));
  if (report.missingItems.length) report.notes.push(tr('{n} Gegenstand/Gegenstände fehlen; Ziele, Versorgungen und Aufträge damit werden entfernt.', { n: report.missingItems.length }));
  if (report.renamed.length) report.notes.push(tr('{n} ID(s) werden umbenannt.', { n: report.renamed.length }));
  if (!report.notes.length) report.notes.push(tr('Alle verwendeten IDs sind im Zieldatensatz vorhanden.'));
  return report;
}

/** Wendet den Wechsel an (innerhalb von Immer aufrufen). Liefert die Liste der Änderungen. */
export function applyGameDataMigration(p: Project, to: GameDataIndex, renames: IdRenames = {}): string[] {
  const changes: string[] = [];
  const rb = (id: string) => renames.buildings?.[id] ?? id;
  const rr = (id: string) => renames.recipes?.[id] ?? id;
  const ri = (id: string) => renames.items?.[id] ?? id;
  for (const b of Object.values(p.buildings)) {
    b.type = rb(b.type);
    if (b.recipeId) {
      const r = rr(b.recipeId);
      if (to.recipe(r)?.producedIn.includes(b.type)) b.recipeId = r;
      else {
        changes.push(tr('Gebäude {id}: Rezept {recipe} entfernt.', { id: b.id, recipe: b.recipeId }));
        b.recipeId = null;
      }
    }
    if (b.extraction) {
      const i = ri(b.extraction.itemId);
      if (to.item(i)) b.extraction.itemId = i;
      else {
        changes.push(tr('Gebäude {id}: Rohstoff {item} entfernt.', { id: b.id, item: b.extraction.itemId }));
        b.extraction = null;
      }
    }
  }
  for (const l of Object.values(p.links)) l.tier = rb(l.tier);
  for (const g of Object.values(p.groups)) {
    for (const m of g.members) {
      m.type = rb(m.type);
      if (m.recipeId) m.recipeId = to.recipe(rr(m.recipeId)) ? rr(m.recipeId) : null;
    }
    for (const l of g.links) l.tier = rb(l.tier);
  }
  for (const a of Object.values(p.areas)) if (a.foundationType) a.foundationType = rb(a.foundationType);
  for (const plan of Object.values(p.productionPlans)) {
    const keepItem = (id: string) => !!to.item(ri(id));
    const before = plan.targets.length + plan.supplies.length;
    plan.targets = plan.targets.filter((t) => keepItem(t.itemId)).map((t) => ({ ...t, itemId: ri(t.itemId) }));
    plan.supplies = plan.supplies.filter((s) => keepItem(s.itemId)).map((s) => ({ ...s, itemId: ri(s.itemId) }));
    if (plan.targets.length + plan.supplies.length !== before) changes.push(tr('Plan „{plan}“: Ziele/Versorgungen mit unbekannten Gegenständen entfernt.', { plan: plan.name }));
    const keepRecipe = (id: string) => !!to.recipe(rr(id));
    plan.enabledAlternates = plan.enabledAlternates.filter(keepRecipe).map(rr);
    plan.disabledRecipes = plan.disabledRecipes.filter(keepRecipe).map(rr);
    plan.machineLimits = plan.machineLimits.filter((m) => keepRecipe(m.recipeId)).map((m) => ({ ...m, recipeId: rr(m.recipeId) }));
  }
  for (const o of Object.values(p.transportOrders)) {
    const i = ri(o.itemId);
    if (to.item(i)) o.itemId = i;
    else {
      changes.push(tr('Transportauftrag „{name}“ entfernt (Gegenstand fehlt).', { name: o.name }));
      delete p.transportOrders[o.id];
    }
  }
  for (const tt of Object.values(p.timetables)) for (const s of tt.stops) s.itemIds = s.itemIds.map(ri).filter((i) => !!to.item(i));
  p.gameData = { datasetId: to.data.meta.datasetId, gameVersion: to.data.meta.gameVersion };
  changes.push(tr('Spieldatensatz auf {ds} umgestellt.', { ds: to.data.meta.datasetId }));
  return changes;
}
