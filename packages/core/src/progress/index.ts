/**
 * Freischaltung: Welche Rezepte und Gebäude sind beim gewählten
 * Spielfortschritt verfügbar?
 *
 * Grundlage sind die Schaltpläne der Spieldaten (Docs `FGSchematic.mUnlocks`).
 * Ein Rezept bzw. Gebäude ist frei, wenn einer der Schaltpläne, die es
 * freischalten, erreicht ist. Steht es in keinem Schaltplan (z. B. Fundamente,
 * AWESOME-Shop), gilt es als frei. Schaltpläne, die ein anderer erreichter
 * Schaltplan freischaltet (`unlocks`), sind ebenfalls erreicht. Ein Rezept ist
 * außerdem gesperrt, wenn sein Herstellungsgebäude gesperrt ist.
 *
 * Phasen des Weltraumlifts → höchstes Tier: kuratierte Wiki-Fakten
 * `progress.phase.<n>.maxTier`.
 */
import type { GameDataIndex, GdSchematic } from '../gamedata/index.ts';
import { tr } from '../i18n/index.ts';
import type { Progress } from '../model/schema.ts';

export const MAX_TIER = 9;

/** Anzeigenamen der M.A.M.-Forschungsbäume (Ordnernamen im Spiel). */
const TREE_NAMES: Record<string, string> = {
  AlienOrganisms: 'Alien-Organismen',
  AlienTech: 'Alien-Technologie',
  Caterium: 'Caterium',
  Mycelia: 'Myzel',
  Nutrients: 'Nährstoffe',
  PowerSlugs: 'Energieschnecken',
  Quartz: 'Quarz',
  Sulfur: 'Schwefel',
};

export function mamTreeName(tree: string): string {
  const n = TREE_NAMES[tree];
  return n ? tr(n) : tree;
}

/** Höchstes Tier nach `phase` abgeschlossenen Phasen des Weltraumlifts. */
export function maxTierForPhase(gd: GameDataIndex, phase: number): number {
  return gd.fact(`progress.phase.${Math.min(4, Math.max(0, phase))}.maxTier`) ?? MAX_TIER;
}

/** Nötige Phasen für ein Tier (kleinste Phase, deren Tierbereich es enthält). */
export function phaseForTier(gd: GameDataIndex, tier: number): number {
  for (let ph = 0; ph <= 4; ph++) if (tier <= maxTierForPhase(gd, ph)) return ph;
  return 4;
}

export interface UnlockState {
  /** Freischaltung aktiv (sonst ist alles frei). */
  active: boolean;
  lockedRecipes: ReadonlySet<string>;
  lockedBuildings: ReadonlySet<string>;
  recipeLocked(id: string): boolean;
  buildingLocked(id: string): boolean;
  /** Kurzer Hinweis, was zum Freischalten fehlt (z. B. „ab Tier 5“); `null`, wenn frei. */
  requirement(id: string): string | null;
}

const NONE: UnlockState = {
  active: false,
  lockedRecipes: new Set(),
  lockedBuildings: new Set(),
  recipeLocked: () => false,
  buildingLocked: () => false,
  requirement: () => null,
};

const cache = new WeakMap<GameDataIndex, Map<string, UnlockState>>();

interface SchematicIndex {
  /** Schaltpläne je Rezept bzw. Gebäude. */
  unlockers: Map<string, GdSchematic[]>;
  /** Schaltpläne, die einen Schaltplan freischalten. */
  parents: Map<string, GdSchematic[]>;
}
const indexCache = new WeakMap<GameDataIndex, SchematicIndex>();

function schematicIndex(gd: GameDataIndex): SchematicIndex {
  const hit = indexCache.get(gd);
  if (hit) return hit;
  const unlockers = new Map<string, GdSchematic[]>();
  const parents = new Map<string, GdSchematic[]>();
  for (const s of Object.values(gd.data.schematics ?? {})) {
    for (const id of [...s.recipes, ...s.buildings]) unlockers.set(id, [...(unlockers.get(id) ?? []), s]);
    for (const id of s.unlocks) parents.set(id, [...(parents.get(id) ?? []), s]);
  }
  const idx = { unlockers, parents };
  indexCache.set(gd, idx);
  return idx;
}

/** Bedingung eines Schaltplans als Text (bei „other“ über den freischaltenden). */
function needOf(idx: SchematicIndex, s: GdSchematic, depth = 0): string {
  switch (s.kind) {
    case 'hub':
      return tr('HUB-Upgrade');
    case 'milestone':
      return tr('ab Tier {n}', { n: s.tier });
    case 'mam':
      return tr('M.A.M.: {tree}', { tree: s.tree ? mamTreeName(s.tree) : '?' });
    case 'alternate':
      return tr('Festplatte');
    case 'start':
      return tr('von Anfang an');
    default: {
      const p = idx.parents.get(s.id)?.[0];
      return p && depth < 4 ? needOf(idx, p, depth + 1) : s.name.de;
    }
  }
}

function rankOf(idx: SchematicIndex, s: GdSchematic, depth = 0): number {
  if (s.kind === 'other') {
    const p = idx.parents.get(s.id)?.[0];
    return p && depth < 4 ? rankOf(idx, p, depth + 1) : 30;
  }
  return s.kind === 'start' ? -1 : s.kind === 'milestone' || s.kind === 'hub' ? s.tier : s.kind === 'mam' ? 20 : 25;
}

/**
 * Wie ein Rezept bzw. Gebäude im Spiel freigeschaltet wird, unabhängig vom
 * Spielfortschritt: bis zu zwei Wege, der früheste zuerst (z. B. „ab Tier 5 /
 * M.A.M.: Caterium“); `null` = in keinem Schaltplan (gilt als frei).
 */
export function unlockSource(gd: GameDataIndex, id: string): string | null {
  const idx = schematicIndex(gd);
  const list = [...(idx.unlockers.get(id) ?? [])].sort((a, b) => rankOf(idx, a) - rankOf(idx, b));
  const texts = [...new Set(list.map((s) => needOf(idx, s)))];
  return texts.length ? texts.slice(0, 2).join(' / ') : null;
}

/** Erreichte Schaltpläne (inkl. der durch sie freigeschalteten). */
export function ownedSchematics(gd: GameDataIndex, progress: Progress): Set<string> {
  const all = Object.values(gd.data.schematics ?? {});
  const picked = new Set(progress.schematics);
  const owned = new Set<string>();
  for (const s of all) {
    const own =
      s.kind === 'start' ||
      (progress.source === 'save'
        ? picked.has(s.id)
        : s.kind === 'hub' || (s.kind === 'milestone' && s.tier <= progress.maxTier) || s.kind === 'alternate' || (s.kind === 'mam' && picked.has(s.id)));
    if (own) owned.add(s.id);
  }
  const queue = [...owned];
  while (queue.length) {
    for (const next of gd.data.schematics?.[queue.pop()!]?.unlocks ?? []) {
      if (!owned.has(next)) {
        owned.add(next);
        queue.push(next);
      }
    }
  }
  return owned;
}

export function unlockState(gd: GameDataIndex, progress: Progress | null | undefined): UnlockState {
  if (!progress || !gd.data.schematics) return NONE;
  const key = JSON.stringify(progress);
  const byGd = cache.get(gd) ?? new Map<string, UnlockState>();
  cache.set(gd, byGd);
  const hit = byGd.get(key);
  if (hit) return hit;

  const owned = ownedSchematics(gd, progress);
  const { unlockers } = schematicIndex(gd);
  const free = (id: string) => {
    const list = unlockers.get(id);
    return !list || list.some((s) => owned.has(s.id));
  };
  const lockedBuildings = new Set(Object.keys(gd.data.buildings).filter((id) => !free(id)));
  const lockedRecipes = new Set(
    Object.values(gd.data.recipes)
      .filter((r) => (r.generator ? false : !free(r.id)) || r.producedIn.every((b) => lockedBuildings.has(b)))
      .map((r) => r.id),
  );

  const requirement = (id: string): string | null => {
    const recipe = gd.recipe(id);
    if (recipe && !lockedRecipes.has(id)) return null;
    if (!recipe && !lockedBuildings.has(id)) return null;
    if (recipe && free(id)) {
      const b = recipe.producedIn.find((x) => lockedBuildings.has(x));
      return b ? requirement(b) : null;
    }
    return unlockSource(gd, id);
  };

  const state: UnlockState = {
    active: true,
    lockedRecipes,
    lockedBuildings,
    recipeLocked: (id) => lockedRecipes.has(id),
    buildingLocked: (id) => lockedBuildings.has(id),
    requirement,
  };
  byGd.set(key, state);
  return state;
}

/** Standard für die manuelle Auswahl: alles bis Tier 9, keine M.A.M.-Forschung. */
export function defaultProgress(): Progress {
  return { source: 'manual', maxTier: MAX_TIER, schematics: [], phase: null };
}

/** Gesperrte Rezepte eines Projekts (für `solveProduction(…, { locked })`). */
export function lockedRecipesOf(p: { settings: { progress?: Progress | null } }, gd: GameDataIndex): ReadonlySet<string> {
  return unlockState(gd, p.settings.progress).lockedRecipes;
}
