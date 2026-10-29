/**
 * Normalisiertes Spieldatenformat des Planers.
 *
 * Die Daten werden von `@satis/gamedata-tools` aus den offiziellen
 * Satisfactory-Docs (CommunityResources/Docs/*.json) erzeugt und unter
 * `data/gamedata/<version>/gamedata.json` abgelegt. Einheiten:
 *   Länge: Meter, Zeit: Sekunden, Flüssigkeiten: m³, Leistung: MW.
 */

export const GAMEDATA_SCHEMA_VERSION = 1;

export type ItemId = string;
export type RecipeId = string;
export type BuildingId = string;

export interface LocalizedName {
  en: string;
  de: string;
}

/** Wie verlässlich ein Wert ist. Wird in der Oberfläche angezeigt. */
export type Confidence =
  /** Direkt aus den offiziellen Docs-Dateien des Spiels gelesen. */
  | 'game-data'
  /** Mit dokumentierter Formel aus Spieldaten abgeleitet. */
  | 'derived'
  /** Aus einer dokumentierten Sekundärquelle (z. B. Wiki) übernommen. */
  | 'documented'
  /** Nicht verifiziert – nur schematisch bzw. Platzhalter. */
  | 'unverified';

export interface SourceRef {
  /** Verweis auf `GameDataMeta.sources[].id`. */
  source: string;
  /** Genauere Stelle, z. B. Wiki-Seite oder Docs-Feld. */
  detail?: string;
  confidence: Confidence;
}

export interface GameDataSource {
  id: string;
  title: string;
  url?: string;
  license: string;
  retrievedAt?: string;
  notes?: string;
}

export interface GameDataMeta {
  schemaVersion: number;
  /** Stabiler Bezeichner des Datensatzes, z. B. `sf-1.2.4.0`. */
  datasetId: string;
  gameVersion: string;
  gameBuild: { engineChangelist?: string; branch?: string };
  generatedAt: string;
  generator: string;
  sources: GameDataSource[];
  /** Markiert Demonstrationsdaten. Echte Datensätze: false. */
  isDemo: boolean;
  notes: string[];
}

export type ItemForm = 'solid' | 'liquid' | 'gas';

export interface GdItem {
  id: ItemId;
  name: LocalizedName;
  form: ItemForm;
  /** Stapelgröße (bei Flüssigkeiten in Litern laut Docs, für Planung irrelevant). */
  stackSize: number;
  sinkPoints: number | null;
  /** Energiewert in MJ (Brennstoffe). Für Flüssigkeiten pro m³. */
  energyMJ: number;
  /** Rohstoff (FGResourceDescriptor). */
  isResource: boolean;
}

export interface GdAmount {
  item: ItemId;
  /** Menge pro Zyklus. Feststoffe in Stück, Flüssigkeiten/Gase in m³. */
  amount: number;
}

export interface GdRecipe {
  id: RecipeId;
  name: LocalizedName;
  alternate: boolean;
  durationS: number;
  inputs: GdAmount[];
  outputs: GdAmount[];
  producedIn: BuildingId[];
  /**
   * Rezeptabhängige variable Leistung (Teilchenbeschleuniger, Konverter,
   * Quantenkodierer): Leistung schwankt zwischen constant und constant+factor.
   */
  variablePower?: { constantMW: number; factorMW: number };
  /**
   * Nur abgeleitete Kraftwerksrezepte (Kraftwerk + Brennstoff): erzeugte
   * Leistung bei 100 % Takt. Ein Zyklus dauert 60 s.
   */
  generator?: { powerMW: number };
}

export interface GdVec3 {
  x: number;
  y: number;
  z: number;
}

/** Kollisionsbox aus `mClearanceData`, in Metern, lokal zum Gebäudeursprung. */
export interface GdClearanceBox {
  min: GdVec3;
  max: GdVec3;
  translation: GdVec3;
  /** Quaternion (x, y, z, w), falls die Box gedreht ist. */
  rotation?: [number, number, number, number];
  /** CT_Soft: weiche Freihaltezone. */
  soft: boolean;
}

export interface GdBounds {
  minX: number;
  maxX: number;
  minY: number;
  maxY: number;
  minZ: number;
  maxZ: number;
}

export type BuildingCategory =
  | 'production'
  | 'extraction'
  | 'power'
  | 'logistics'
  | 'storage'
  | 'rail'
  | 'foundation'
  | 'other';

export type PortKind = 'belt' | 'pipe';

export interface GdPortCounts {
  beltIn: number;
  beltOut: number;
  pipeIn: number;
  pipeOut: number;
  /** Richtungsunabhängige Rohranschlüsse (Rohrkreuzungen). */
  pipeAny: number;
}

/** Anschluss laut Spielpaketen, in Metern relativ zum Gebäudeursprung. */
export interface GdPortPosition {
  kind: 'belt' | 'pipe';
  direction: 'in' | 'out' | 'any';
  /** Laufende Nummer je Art und Richtung (wie die Anschluss-ID). */
  index: number;
  x: number;
  y: number;
  z: number;
  /** Austrittsrichtung (Grad, 0 = +x, 90 = +y). */
  yawDeg: number;
  /** Name der Komponente im Spiel, z. B. „Input0“. */
  component: string;
}

export interface GdBuilding {
  id: BuildingId;
  name: LocalizedName;
  nativeClass: string;
  category: BuildingCategory;
  powerConsumptionMW: number;
  powerProductionMW?: number;
  /** Exponent für Leistung bei Taktänderung (P = P0 · Takt^exp). */
  powerExponent?: number;
  /** Exponent für Leistung bei Produktionsverstärkung (Somersloop). */
  boostPowerExponent?: number;
  /** Gebäude mit rezeptabhängiger variabler Leistung. */
  variablePower?: boolean;
  manufacturingSpeed?: number;
  clock?: { min: number; max: number };
  /** Anzahl Somersloop-Plätze. */
  somersloopSlots?: number;
  clearance: GdClearanceBox[];
  /** Achsparallele Hülle aller festen Kollisionsboxen (oder weicher, falls keine feste existiert). */
  bounds: GdBounds | null;
  boundsSource: SourceRef | null;
  ports: GdPortCounts | null;
  portsSource: SourceRef | null;
  /** Lage der Anschlüsse laut Spielpaketen (fehlt: schematisch). */
  portLayout?: GdPortPosition[];
  extractor?: {
    cycleTimeS: number;
    itemsPerCycle: number;
    allowedForms: ItemForm[];
    allowedResources: ItemId[];
  };
  /** Förderband / Förderlift. */
  conveyor?: { itemsPerMin: number; isLift: boolean };
  /** Rohrleitung. */
  pipe?: { m3PerMin: number };
  /** Pumpe: Förderhöhe in Metern. */
  pump?: { designHeadM: number; maxHeadM: number };
  /** Fundament-Maße laut Docs (mWidth/mDepth/mHeight). */
  foundation?: { widthM: number; depthM: number; heightM: number };
  /** Güterbahnsteig: Ladezeit laut Docs. */
  freightPlatform?: { cargo: 'solid' | 'liquid'; loadTimeS: number; unloadTimeS: number };
}

/**
 * Straßenfahrzeug für LKW-Stationen (Traktor, LKW, Tanklaster, Explorer).
 * Laderaum aus den Docs (`mInventorySize`), Geschwindigkeit und
 * Tankinhalt aus dem Wiki (kuratierte Fakten).
 */
export interface GdVehicle {
  id: string;
  name: LocalizedName;
  /** Laderaum: Inventarplätze (Feststoffe) bzw. m³ (Tank). */
  cargo: { kind: 'solid'; slots: number } | { kind: 'liquid'; m3: number };
  /** Höchstgeschwindigkeit auf ebener Strecke (km/h). */
  maxSpeedKmh: number;
  sourceRef: SourceRef;
}

/** Kuratierter Einzelwert mit Quelle (z. B. Zuglängen, Kurvenradien). */
export interface GdFact {
  value: number;
  unit: string;
  description: string;
  sourceRef: SourceRef;
}

export interface GameData {
  meta: GameDataMeta;
  items: Record<ItemId, GdItem>;
  recipes: Record<RecipeId, GdRecipe>;
  buildings: Record<BuildingId, GdBuilding>;
  facts: Record<string, GdFact>;
  /** Straßenfahrzeuge (ab Datensätzen mit Fahrzeugdaten; fehlt in älteren). */
  vehicles?: Record<string, GdVehicle>;
}
