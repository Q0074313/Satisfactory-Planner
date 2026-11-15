/**
 * Kennzahlen einzelner Maschinen: Ein-/Ausgangsraten und Leistung.
 *
 * Formeln:
 * - Zyklen pro Minute = 60 / Rezeptdauer · Takt (· Fertigungsgeschwindigkeit)
 * - Ausgabe = Menge · Zyklen · (1 + Somersloops · Verstärkung je Slot)
 *   (Verstärkung je Slot = Docs mProductionShardBoostMultiplier;
 *   alle Slots belegt = +100 % laut Wiki „Somersloop“)
 * - Leistung = Grundleistung · Takt^Exponent · (1 + Verstärkung)^Verstärkungsexponent
 *   (Exponenten aus Docs: mPowerConsumptionExponent, mProductionBoostPowerConsumptionExponent)
 * - Variable Leistung (Teilchenbeschleuniger u. a.): Mittelwert
 *   constant + factor / 2 – Annahme, siehe docs/SPIELREGELN.md.
 * - Kraftwerke: abgeleitete Rezepte (ein Zyklus = 1 min), erzeugte Leistung = Nennleistung · Takt
 * - Gewinnung: Menge je Zyklus · 60 / Zykluszeit · Takt · Reinheitsfaktor
 *   (Docs mItemsPerCycle, mExtractCycleTime; Flüssigkeiten in Litern → m³;
 *   Reinheit unrein ×0,5 / normal ×1 / rein ×2 laut Wiki „Resource node“;
 *   Wasserextraktoren ohne Reinheit)
 */
import type { GameDataIndex, GdBuilding, GdRecipe } from '../gamedata/index.ts';
import type { Extraction } from '../model/schema.ts';

export interface MachineSetup {
  type: string;
  recipeId: string | null;
  clock: number;
  somersloops: number;
  extraction?: Pick<Extraction, 'itemId' | 'purity'> | null;
}

export interface Rate {
  item: string;
  perMin: number;
}

export interface MachineRates {
  inputs: Rate[];
  outputs: Rate[];
  powerMW: number;
  /** Erzeugte Leistung (Kraftwerke). */
  generatedMW?: number;
  /** Leistung schwankt (variable Gebäude): Spanne. */
  powerRangeMW?: [number, number];
}

/**
 * Produktionsverstärkung (0 … 1) für die angegebene Zahl Somersloops.
 * In den Docs gilt für alle Gebäude mProductionShardBoostMultiplier = 1 / Slotzahl
 * (Konstruktor 1 · 1,0; Fabrikator 2 · 0,5; Manufaktor 4 · 0,25).
 */
export function boostFactor(def: GdBuilding | undefined, somersloops: number): number {
  if (!def?.somersloopSlots || somersloops <= 0) return 0;
  return Math.min(somersloops, def.somersloopSlots) / def.somersloopSlots;
}

export function cyclesPerMin(recipe: GdRecipe, def: GdBuilding | undefined, clock: number): number {
  return (60 / recipe.durationS) * clock * (def?.manufacturingSpeed ?? 1);
}

export function machinePower(def: GdBuilding, recipe: GdRecipe | undefined, clock: number, boost: number): { avg: number; range?: [number, number] } {
  const clockFactor = Math.pow(clock, def.powerExponent ?? 1);
  const boostFactorPow = Math.pow(1 + boost, def.boostPowerExponent ?? 2);
  if (def.variablePower && recipe?.variablePower) {
    const { constantMW, factorMW } = recipe.variablePower;
    const f = clockFactor * boostFactorPow;
    return { avg: (constantMW + factorMW / 2) * f, range: [constantMW * f, (constantMW + factorMW) * f] };
  }
  return { avg: def.powerConsumptionMW * clockFactor * boostFactorPow };
}

/** Förderrate eines Gewinnungsgebäudes pro Minute (Feststoffe Stück, Flüssigkeiten m³). */
/** Benötigte Energiesplitter für einen Takt (je Splitter +50 %, Wiki „Power Shard“). */
export function shardsForClock(clock: number): number {
  return Math.max(0, Math.ceil((clock - 1) / 0.5 - 1e-9));
}

export function extractionRate(gd: GameDataIndex, def: GdBuilding, extraction: Pick<Extraction, 'itemId' | 'purity'>, clock: number): number {
  const ex = def.extractor;
  if (!ex) return 0;
  const item = gd.item(extraction.itemId);
  const fluid = item ? item.form !== 'solid' : false;
  const perCycle = fluid ? ex.itemsPerCycle / 1000 : ex.itemsPerCycle;
  const purity = def.nativeClass === 'FGBuildableWaterPump' ? 1 : (gd.fact(`extraction.purity.${extraction.purity}`) ?? 1);
  return (perCycle * 60 * clock * purity) / ex.cycleTimeS;
}

export function machineRates(gd: GameDataIndex, m: MachineSetup): MachineRates {
  const def = gd.building(m.type);
  const recipe = m.recipeId ? gd.recipe(m.recipeId) : undefined;
  if (!def) return { inputs: [], outputs: [], powerMW: 0 };
  const boost = boostFactor(def, m.somersloops);
  const power = machinePower(def, recipe, m.clock, boost);
  if (def.extractor) {
    const outputs = m.extraction ? [{ item: m.extraction.itemId, perMin: extractionRate(gd, def, m.extraction, m.clock) }] : [];
    return { inputs: [], outputs, powerMW: power.avg };
  }
  if (!recipe) return { inputs: [], outputs: [], powerMW: def.category === 'production' ? 0 : power.avg };
  const cycles = cyclesPerMin(recipe, def, m.clock);
  const res: MachineRates = {
    inputs: recipe.inputs.map((a) => ({ item: a.item, perMin: a.amount * cycles })),
    outputs: recipe.outputs.map((a) => ({ item: a.item, perMin: a.amount * cycles * (1 + boost) })),
    powerMW: power.avg,
  };
  // Kraftwerke: Leistung und Brennstoffverbrauch linear zum Takt (Wiki „Clock speed“)
  if (recipe.generator) res.generatedMW = recipe.generator.powerMW * m.clock;
  if (power.range) res.powerRangeMW = power.range;
  return res;
}

/** Rate eines Rezepts pro Maschine bei 100 % Takt ohne Verstärkung. */
export function recipeRatesPerMachine(recipe: GdRecipe, def: GdBuilding | undefined) {
  const cycles = cyclesPerMin(recipe, def, 1);
  return {
    inputs: recipe.inputs.map((a) => ({ item: a.item, perMin: a.amount * cycles })),
    outputs: recipe.outputs.map((a) => ({ item: a.item, perMin: a.amount * cycles })),
  };
}
