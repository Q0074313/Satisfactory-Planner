/**
 * Produktionsberechnung als lineares Programm.
 *
 * Variablen (alle ≥ 0):
 *   r_k  Maschinenäquivalente (100 % Takt) je Rezept k
 *   s_i  Versorgung mit Gegenstand i (Rohstoff oder Zulieferung)
 *   x_i  Überschuss von i (Nebenprodukt, nicht verbraucht)
 *   u_i  Fehlmenge von i (Ziel nicht erreichbar) – stark bestraft
 *   t    Skalierung der Ziele (nur Modus „maximieren“)
 *   g_k  Kraftwerke je Kraftwerksrezept: fest vorgegebene Anzahl (Teil von r_k)
 *
 * Bilanz je Gegenstand i:  Σ_k a_ik · r_k + s_i − x_i + u_i = d_i
 *   a_ik = Nettomenge pro Minute einer Maschine (Ausgabe − Eingabe)
 *   d_i  = Zielmenge (Modus „target“) bzw. t · Verhältnis (Modus „maximize“)
 *
 * Kraftwerke werden nicht nach Strombedarf berechnet: Der Plan gibt Kraftwerk,
 * Brennstoff und Anzahl vor (g_k = Anzahl), der Solver plant die Zulieferung.
 *
 * Das Gleichungssystem löst Kreisläufe und Mehrfachausgaben direkt. Es gibt
 * keinen Rezeptbaum, der Kreisläufe abbrechen müsste.
 */
import { solve, type Coefficients, type Constraint } from 'yalps';
import type { GameDataIndex, GdRecipe } from '../gamedata/index.ts';
import { formatNumber, getLanguage, tr } from '../i18n/index.ts';
import type { Building, ProductionPlan } from '../model/schema.ts';
import { boostFactor, machinePower } from './machine.ts';

export interface SolveOptions {
  /** Vorhandene Maschinen (für `limitToExistingMachines`). */
  existingMachines?: Building[];
}

export interface RecipeResult {
  recipeId: string;
  building: string;
  /** Somersloop-Verstärkung dieser Variante (0 = ohne). */
  boost: number;
  /** Maschinenäquivalente bei 100 % Takt. */
  machines: number;
  /** Ganzzahlige Maschinenzahl. */
  machinesCeil: number;
  /** Gleichmäßiger Takt bei `machinesCeil` Maschinen (Faktor). */
  clockEven: number;
  /** Leistung bei gleichmäßigem Takt. */
  powerMW: number;
  /** Erzeugte Leistung (Kraftwerke). */
  generatedMW: number;
  inputs: { item: string; perMin: number }[];
  outputs: { item: string; perMin: number }[];
}

export interface ItemResult {
  itemId: string;
  produced: number;
  consumed: number;
  supplied: number;
  surplus: number;
  shortfall: number;
  target: number;
  /** Gesamtdurchsatz, der transportiert werden muss. */
  throughput: number;
}

export interface Bottleneck {
  kind: 'supply' | 'machines' | 'no-source';
  id: string;
  message: string;
}

export interface SolveResult {
  status: 'optimal' | 'infeasible' | 'unbounded' | 'error';
  message: string;
  /** Skalierung (Modus „maximize“). */
  scale: number | null;
  recipes: RecipeResult[];
  items: ItemResult[];
  powerMW: number;
  /** Erzeugte Leistung der Kraftwerke im Plan. */
  generatedMW: number;
  machineCount: number;
  bottlenecks: Bottleneck[];
  /** Offengelegte Annahmen der Berechnung. */
  assumptions: string[];
}

const EPS = 1e-7;
const BIG = 1e5;
const clean = (v: number) => (Math.abs(v) < EPS ? 0 : v);

/** Gewicht eines Rohstoffs: 1000 / weltweites Maximum (Wiki); Wasser 0. */
export function resourceWeight(gd: GameDataIndex, itemId: string): number {
  if (itemId === 'Desc_Water_C') return 0;
  const max = gd.fact(`resource.worldMaxPerMin.${itemId}`);
  return max ? 1000 / max : 0.1;
}

/** Rezepte, die im Plan zulässig sind. */
export function allowedRecipes(gd: GameDataIndex, plan: ProductionPlan): GdRecipe[] {
  const enabled = new Set(plan.enabledAlternates);
  const disabled = new Set(plan.disabledRecipes);
  // Kraftwerke nur als feste Vorgabe (plan.power.generators), nicht frei wählbar
  return Object.values(gd.data.recipes).filter((r) => !disabled.has(r.id) && (!r.alternate || enabled.has(r.id)) && !r.generator);
}

interface Variant {
  key: string;
  recipe: GdRecipe;
  boost: number;
  capacity: number | null;
  /** Fest vorgegebene Anzahl (Kraftwerke). */
  fixed?: number;
}

export function solveProduction(gd: GameDataIndex, plan: ProductionPlan, opts: SolveOptions = {}): SolveResult {
  const assumptions = [
    tr('Maschinen laufen mit 100 % Takt; Teilmengen werden über den Takt verteilt (gleichmäßiger Takt).'),
    tr('Rohstoffkosten gewichtet mit 1000 / weltweites Maximum laut Wiki; Wasser kostenlos.'),
    tr('Variable Leistung (Teilchenbeschleuniger u. a.) als Mittelwert.'),
    tr('Somersloops nur bei „vorhandene Maschinen“ berücksichtigt.'),
    tr('Wasser gilt als unbegrenzt verfügbar, sofern keine Obergrenze angegeben ist.'),
  ];
  const generators = plan.power.generators.filter((g) => g.count > 0 && gd.recipe(g.recipeId)?.generator);
  if (generators.length) assumptions.push(tr('Kraftwerke mit vorgegebener Anzahl bei 100 % Takt; der Strombedarf der Maschinen wird nicht gegengerechnet.'));
  const maximize = plan.mode === 'maximize';
  const recipes = allowedRecipes(gd, plan);

  // Rezeptvarianten (bei vorhandenen Maschinen je Somersloop-Stufe)
  const variants: Variant[] = [];
  if (plan.limitToExistingMachines) {
    const groups = new Map<string, Variant>();
    for (const b of opts.existingMachines ?? []) {
      if (!b.recipeId) continue;
      const recipe = gd.recipe(b.recipeId);
      if (!recipe || !recipes.includes(recipe)) continue;
      const boost = boostFactor(gd.building(b.type), b.somersloops);
      const key = `r:${recipe.id}|${boost}`;
      const v = groups.get(key) ?? { key, recipe, boost, capacity: 0 };
      v.capacity = (v.capacity ?? 0) + b.clock;
      groups.set(key, v);
    }
    variants.push(...groups.values());
  } else {
    for (const r of recipes) variants.push({ key: `r:${r.id}|0`, recipe: r, boost: 0, capacity: null });
  }
  const fixed = new Map<string, number>();
  for (const g of generators) fixed.set(g.recipeId, (fixed.get(g.recipeId) ?? 0) + g.count);
  for (const [id, count] of fixed) variants.push({ key: `g:${id}`, recipe: gd.recipe(id)!, boost: 0, capacity: null, fixed: count });
  const limits = new Map(plan.machineLimits.map((l) => [l.recipeId, l.maxMachines]));

  const perMachine = (r: GdRecipe) => {
    const def = gd.building(r.producedIn[0]!);
    const cycles = (60 / r.durationS) * (def?.manufacturingSpeed ?? 1);
    return { cycles, def };
  };

  const items = new Set<string>();
  for (const v of variants) for (const a of [...v.recipe.inputs, ...v.recipe.outputs]) items.add(a.item);
  for (const t of plan.targets) items.add(t.itemId);
  for (const s of plan.supplies) items.add(s.itemId);

  const targetOf = new Map<string, number>();
  for (const t of plan.targets) targetOf.set(t.itemId, (targetOf.get(t.itemId) ?? 0) + t.ratePerMin);
  if (maximize && [...targetOf.values()].every((v) => v <= 0)) {
    return empty('error', tr('Für „Maximieren“ mindestens ein Zielprodukt mit Verhältnis > 0 angeben.'), assumptions);
  }
  if (!maximize && targetOf.size === 0 && generators.length === 0) return empty('optimal', tr('Keine Ziele angegeben.'), assumptions);

  const supplyOf = new Map<string, { max: number | null; origin: 'local' | 'import' }>();
  for (const s of plan.supplies) supplyOf.set(s.itemId, { max: s.maxPerMin, origin: s.origin });

  const weights = {
    resources: plan.optimize === 'resources' ? 1 : 1e-3,
    power: plan.optimize === 'power' ? 1e-2 : 1e-6,
    machines: plan.optimize === 'machines' ? 1 : 1e-4,
  };

  const constraints = new Map<string, Constraint>();
  const variables = new Map<string, Coefficients>();
  for (const i of items) constraints.set(`i:${i}`, maximize ? { equal: 0 } : { equal: targetOf.get(i) ?? 0 });

  for (const v of variants) {
    const { cycles, def } = perMachine(v.recipe);
    const coef = new Map<string, number>();
    for (const a of v.recipe.outputs) coef.set(`i:${a.item}`, (coef.get(`i:${a.item}`) ?? 0) + a.amount * cycles * (1 + v.boost));
    for (const a of v.recipe.inputs) coef.set(`i:${a.item}`, (coef.get(`i:${a.item}`) ?? 0) - a.amount * cycles);
    const use = def ? machinePower(def, v.recipe, 1, v.boost).avg : 0;
    coef.set('cost', weights.power * use + weights.machines);
    if (v.fixed !== undefined) {
      // Vorgabe; nicht versorgbare Kraftwerke (begrenzter Brennstoff) als stark bestrafte Lücke
      constraints.set(`fix:${v.key}`, { equal: v.fixed });
      coef.set(`fix:${v.key}`, 1);
      variables.set(`gs:${v.key}`, new Map([[`fix:${v.key}`, 1], ['cost', BIG * 10]]));
    }
    const cap = v.capacity ?? limits.get(v.recipe.id);
    if (cap !== undefined && cap !== null) {
      constraints.set(`cap:${v.key}`, { max: cap });
      coef.set(`cap:${v.key}`, 1);
    }
    variables.set(v.key, coef);
  }

  for (const i of items) {
    const item = gd.item(i);
    const sup = supplyOf.get(i);
    const isResource = item?.isResource ?? false;
    // Versorgung: Rohstoffe (target: unbegrenzt, maximize: nur angegebene; Wasser immer) und angegebene Zulieferungen
    if (sup || (isResource && (!maximize || i === 'Desc_Water_C'))) {
      const coef = new Map<string, number>([[`i:${i}`, 1]]);
      const w = sup?.origin === 'import' ? 0.01 : isResource ? resourceWeight(gd, i) : 0.01;
      coef.set('cost', weights.resources * w);
      if (sup && sup.max !== null) {
        constraints.set(`sup:${i}`, { max: sup.max });
        coef.set(`sup:${i}`, 1);
      }
      variables.set(`s:${i}`, coef);
    }
    variables.set(`x:${i}`, new Map([[`i:${i}`, -1], ['cost', 1e-3]]));
    if (!maximize && (targetOf.get(i) ?? 0) > 0) variables.set(`u:${i}`, new Map([[`i:${i}`, 1], ['cost', BIG]]));
  }
  if (maximize) {
    const coef = new Map<string, number>([['cost', -BIG]]);
    for (const [i, w] of targetOf) if (w > 0) coef.set(`i:${i}`, -w);
    variables.set('t', coef);
  }

  const sol = solve({ direction: 'minimize', objective: 'cost', constraints, variables }, { checkCycles: true, maxPivots: 20000 });
  if (sol.status === 'infeasible') return empty('infeasible', tr('Das Problem ist unlösbar (Widerspruch in den Vorgaben).'), assumptions);
  if (sol.status === 'unbounded')
    return empty('unbounded', tr('Die Maximierung ist unbeschränkt: Mindestens ein benötigter Rohstoff hat keine Obergrenze.'), assumptions);
  if (sol.status !== 'optimal') return empty('error', tr('Solver-Status: {status}', { status: sol.status }), assumptions);

  const val = new Map(sol.variables.map(([k, v]) => [k, clean(v)]));
  const get = (k: string) => val.get(k) ?? 0;
  const scale = maximize ? get('t') : null;

  const itemRes = new Map<string, ItemResult>();
  const row = (i: string) => {
    let r = itemRes.get(i);
    if (!r) {
      r = { itemId: i, produced: 0, consumed: 0, supplied: 0, surplus: 0, shortfall: 0, target: 0, throughput: 0 };
      itemRes.set(i, r);
    }
    return r;
  };
  const recipeRes: RecipeResult[] = [];
  let powerMW = 0;
  let generatedMW = 0;
  let machineCount = 0;
  for (const v of variants) {
    const m = get(v.key);
    if (m <= EPS) continue;
    const { cycles, def } = perMachine(v.recipe);
    const ceil = Math.max(1, Math.ceil(m - 1e-6));
    const clockEven = Math.round((m / ceil) * 1e6) / 1e6;
    const use = def ? machinePower(def, v.recipe, clockEven, v.boost).avg * ceil : 0;
    const gen = (v.recipe.generator?.powerMW ?? 0) * m;
    const res: RecipeResult = {
      recipeId: v.recipe.id,
      building: v.recipe.producedIn[0]!,
      boost: v.boost,
      machines: m,
      machinesCeil: ceil,
      clockEven,
      powerMW: use,
      generatedMW: gen,
      inputs: v.recipe.inputs.map((a) => ({ item: a.item, perMin: a.amount * cycles * m })),
      outputs: v.recipe.outputs.map((a) => ({ item: a.item, perMin: a.amount * cycles * m * (1 + v.boost) })),
    };
    for (const o of res.outputs) row(o.item).produced += o.perMin;
    for (const i of res.inputs) row(i.item).consumed += i.perMin;
    recipeRes.push(res);
    powerMW += use;
    generatedMW += gen;
    machineCount += ceil;
  }
  for (const i of items) {
    const supplied = get(`s:${i}`);
    const surplus = get(`x:${i}`);
    const shortfall = get(`u:${i}`);
    const target = maximize ? (targetOf.get(i) ?? 0) * (scale ?? 0) : (targetOf.get(i) ?? 0);
    if (supplied || surplus || shortfall || target || itemRes.has(i)) {
      const r = row(i);
      r.supplied = supplied;
      r.surplus = surplus;
      r.shortfall = shortfall;
      r.target = target;
    }
  }
  for (const r of itemRes.values()) r.throughput = Math.max(r.produced + r.supplied, r.consumed + r.target + r.surplus);

  // Engpässe und fehlende Versorgung
  const bottlenecks: Bottleneck[] = [];
  // Fehlende Quellen: von jeder Fehlmenge aus die Vorprodukte zurückverfolgen
  const producers = (item: string) => variants.filter((v) => v.recipe.outputs.some((o) => o.item === item));
  const hasSource = (item: string) =>
    supplyOf.has(item) || (gd.item(item)?.isResource && (!maximize || item === 'Desc_Water_C')) || producers(item).length > 0;
  const visited = new Set<string>();
  const queue = [...itemRes.values()].filter((r) => r.shortfall > EPS).map((r) => r.itemId);
  while (queue.length) {
    const it = queue.shift()!;
    if (visited.has(it)) continue;
    visited.add(it);
    if (!hasSource(it)) {
      bottlenecks.push({ kind: 'no-source', id: it, message: tr('{item}: kein zulässiges Rezept und keine Zulieferung.', { item: gd.name(it) }) });
      continue;
    }
    for (const v of producers(it)) for (const a of v.recipe.inputs) queue.push(a.item);
  }
  for (const [i, s] of supplyOf) {
    if (s.max !== null && s.max > 0 && get(`s:${i}`) >= s.max - 1e-6 && (maximize || [...itemRes.values()].some((r) => r.shortfall > EPS)))
      bottlenecks.push({ kind: 'supply', id: i, message: tr('{item}: Versorgung voll ausgeschöpft ({max}/min).', { item: gd.name(i), max: formatNumber(s.max, 3) }) });
  }
  for (const v of variants) {
    const cap = v.capacity ?? limits.get(v.recipe.id);
    if (cap !== undefined && cap !== null && cap > 0 && get(v.key) >= cap - 1e-6 && (maximize || [...itemRes.values()].some((r) => r.shortfall > EPS)))
      bottlenecks.push({ kind: 'machines', id: v.recipe.id, message: tr('{recipe}: Maschinengrenze erreicht ({cap}).', { recipe: gd.name(v.recipe.id), cap: formatNumber(cap, 4) }) });
  }
  for (const v of variants) {
    const gap = v.fixed !== undefined ? get(`gs:${v.key}`) : 0;
    if (gap > EPS)
      bottlenecks.push({
        kind: 'supply',
        id: v.recipe.id,
        message: tr('{recipe}: nur {n} von {total} Kraftwerken versorgbar (Brennstoff bzw. Wasser begrenzt).', {
          recipe: gd.name(v.recipe.id),
          n: formatNumber(v.fixed! - gap, 3),
          total: formatNumber(v.fixed!, 3),
        }),
      });
  }
  const unmet = [...itemRes.values()].filter((r) => r.shortfall > EPS);
  const message = maximize
    ? tr('Maximale Skalierung: {scale} × Zielverhältnis.', { scale: formatNumber(scale ?? 0, 4) })
    : unmet.length
      ? tr('Ziele nicht vollständig erreichbar: {list}.', {
          list: unmet.map((r) => tr('{item} fehlt {n}/min', { item: gd.name(r.itemId), n: formatNumber(r.shortfall, 3) })).join(', '),
        })
      : tr('Alle Ziele erreichbar.');
  return {
    status: 'optimal',
    message,
    scale,
    recipes: recipeRes.sort((a, b) => b.machines - a.machines),
    items: [...itemRes.values()].sort((a, b) => gd.name(a.itemId).localeCompare(gd.name(b.itemId), getLanguage())),
    powerMW,
    generatedMW,
    machineCount,
    bottlenecks,
    assumptions,
  };
}

function empty(status: SolveResult['status'], message: string, assumptions: string[]): SolveResult {
  return { status, message, scale: null, recipes: [], items: [], powerMW: 0, generatedMW: 0, machineCount: 0, bottlenecks: [], assumptions };
}

/** Kleinste Band- bzw. Rohrstufe für einen Durchsatz und Anzahl paralleler Leitungen der höchsten Stufe. */
export function transportNeed(gd: GameDataIndex, itemId: string, perMin: number) {
  const fluid = gd.item(itemId)?.form !== 'solid';
  const tiers = fluid ? gd.pipeTiers.map((t) => ({ id: t.id, cap: t.pipe!.m3PerMin })) : gd.beltTiers.map((t) => ({ id: t.id, cap: t.conveyor!.itemsPerMin }));
  const fit = tiers.find((t) => t.cap >= perMin - 1e-9);
  const top = tiers.at(-1);
  return {
    kind: fluid ? ('pipe' as const) : ('belt' as const),
    tier: fit?.id ?? null,
    parallelAtTop: top ? Math.ceil(perMin / top.cap - 1e-9) : 0,
    topTier: top?.id ?? null,
  };
}
