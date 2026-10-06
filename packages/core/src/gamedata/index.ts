import { localName } from '../i18n/index.ts';
import type { BuildingCategory, GameData, GdBuilding, GdItem, GdRecipe, ItemId } from './types.ts';

export * from './types.ts';

/**
 * Lesezugriff auf einen Spieldatensatz mit vorberechneten Nachschlagetabellen.
 * Der Index ist unveränderlich und kann zwischen Berechnungen geteilt werden.
 */
export interface GameDataIndex {
  data: GameData;
  item(id: string): GdItem | undefined;
  recipe(id: string): GdRecipe | undefined;
  building(id: string): GdBuilding | undefined;
  /** Rezepte, die den Gegenstand herstellen (inkl. Nebenprodukt). */
  recipesProducing(itemId: ItemId): GdRecipe[];
  recipesConsuming(itemId: ItemId): GdRecipe[];
  buildingsByCategory(category: BuildingCategory): GdBuilding[];
  /** Förderbandstufen, aufsteigend nach Durchsatz (ohne Lifte). */
  beltTiers: GdBuilding[];
  /** Förderliftstufen, aufsteigend. */
  liftTiers: GdBuilding[];
  /** Rohrstufen, aufsteigend (ohne „Clean“-Varianten). */
  pipeTiers: GdBuilding[];
  fact(key: string): number | undefined;
  /** Name in der Oberflächensprache. */
  name(id: string): string;
}

export function createGameDataIndex(data: GameData): GameDataIndex {
  const producing = new Map<string, GdRecipe[]>();
  const consuming = new Map<string, GdRecipe[]>();
  for (const r of Object.values(data.recipes)) {
    for (const o of r.outputs) producing.set(o.item, [...(producing.get(o.item) ?? []), r]);
    for (const i of r.inputs) consuming.set(i.item, [...(consuming.get(i.item) ?? []), r]);
  }
  const byCategory = new Map<BuildingCategory, GdBuilding[]>();
  for (const b of Object.values(data.buildings)) {
    byCategory.set(b.category, [...(byCategory.get(b.category) ?? []), b]);
  }
  const sortBy = <T>(list: T[], key: (t: T) => number) => [...list].sort((a, b) => key(a) - key(b));
  const all = Object.values(data.buildings);
  const beltTiers = sortBy(
    all.filter((b) => b.conveyor && !b.conveyor.isLift),
    (b) => b.conveyor!.itemsPerMin,
  );
  const liftTiers = sortBy(
    all.filter((b) => b.conveyor?.isLift),
    (b) => b.conveyor!.itemsPerMin,
  );
  const pipeTiers = sortBy(
    all.filter((b) => b.pipe && !b.id.includes('NoIndicator')),
    (b) => b.pipe!.m3PerMin,
  );

  return {
    data,
    item: (id) => data.items[id],
    recipe: (id) => data.recipes[id],
    building: (id) => data.buildings[id],
    recipesProducing: (id) => producing.get(id) ?? [],
    recipesConsuming: (id) => consuming.get(id) ?? [],
    buildingsByCategory: (c) => byCategory.get(c) ?? [],
    beltTiers,
    liftTiers,
    pipeTiers,
    fact: (key) => data.facts[key]?.value,
    name: (id) => {
      const n = data.items[id]?.name ?? data.recipes[id]?.name ?? data.buildings[id]?.name;
      return n ? localName(n) : id;
    },
  };
}
