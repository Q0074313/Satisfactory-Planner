/**
 * Projektschema (Dateiformat-Version 1).
 *
 * Alle Objekte liegen normalisiert in ID-Tabellen auf Projektebene und
 * verweisen über IDs aufeinander. Koordinaten sind Weltkoordinaten in Metern:
 * x nach rechts, y nach unten (Draufsicht), z nach oben. Drehungen in Grad,
 * im Uhrzeigersinn in der Draufsicht.
 */
import { z } from 'zod';

export const PROJECT_FORMAT_VERSION = 2;

const id = z.string().min(1);
const finite = z.number().finite();

export const Vec2Schema = z.object({ x: finite, y: finite });
export const Vec3Schema = z.object({ x: finite, y: finite, z: finite });
export type Vec2 = z.infer<typeof Vec2Schema>;
export type Vec3 = z.infer<typeof Vec3Schema>;

// ---------------------------------------------------------------------------
// Fabrik, Stockwerke, Flächen
// ---------------------------------------------------------------------------

export const FactorySchema = z.object({
  id,
  name: z.string(),
  color: z.string(),
  /** Reihenfolge der Stockwerke von unten nach oben. */
  floorIds: z.array(id),
  notes: z.string().default(''),
});
export type Factory = z.infer<typeof FactorySchema>;

export const FloorKindSchema = z.enum(['production', 'logistics', 'other']);
export type FloorKind = z.infer<typeof FloorKindSchema>;

export const FloorSchema = z.object({
  id,
  factoryId: id,
  name: z.string(),
  kind: FloorKindSchema,
  /** Oberkante des Bodens in Metern (Weltkoordinate z). */
  elevationM: finite,
  /** Lichte Höhe bis zum nächsten Stockwerk – Planungsangabe. */
  heightM: finite.positive(),
});
export type Floor = z.infer<typeof FloorSchema>;

export const AreaKindSchema = z.enum([
  /** Selbst festgelegte Baufläche. */
  'build-area',
  /** Fundamentfläche (Kachelung nach Fundamentgröße). */
  'foundation',
  /** Frei definierbarer Planungsabstand, z. B. Wartungs- oder Laufweg. */
  'clearance',
]);
export type AreaKind = z.infer<typeof AreaKindSchema>;

export const PlanAreaSchema = z.object({
  id,
  factoryId: id,
  floorId: id,
  kind: AreaKindSchema,
  name: z.string(),
  /** Polygon in Weltkoordinaten (x/y), im oder gegen den Uhrzeigersinn. */
  polygon: z.array(Vec2Schema).min(3),
  /** Für Fundamente: Gebäude-ID des Fundamenttyps aus den Spieldaten. */
  foundationType: z.string().optional(),
});
export type PlanArea = z.infer<typeof PlanAreaSchema>;

// ---------------------------------------------------------------------------
// Gebäude und Verbindungen
// ---------------------------------------------------------------------------

export const PlacementSchema = z.object({
  floorId: id,
  /** Mittelpunkt des Gebäudeursprungs (Docs-Ursprung) in Weltkoordinaten. */
  x: finite,
  y: finite,
  /** Höhe relativ zur Oberkante des Stockwerks. */
  zOffsetM: finite.default(0),
  rotationDeg: finite,
});
export type Placement = z.infer<typeof PlacementSchema>;

export const PuritySchema = z.enum(['impure', 'normal', 'pure']);
export type Purity = z.infer<typeof PuritySchema>;

export const ExtractionSchema = z.object({
  itemId: z.string(),
  /** Reinheit; bei Wasserextraktoren ohne Bedeutung („normal“). */
  purity: PuritySchema,
});
export type Extraction = z.infer<typeof ExtractionSchema>;

export const TransferSchema = z.object({
  mode: z.enum(['load', 'unload']),
  stationId: id.nullable(),
});
export type Transfer = z.infer<typeof TransferSchema>;

export const BuildingSchema = z.object({
  id,
  factoryId: id,
  /** Gebäudetyp aus den Spieldaten (z. B. `Build_ConstructorMk1_C`). */
  type: z.string(),
  label: z.string().default(''),
  recipeId: z.string().nullable().default(null),
  /** Takt als Faktor (1 = 100 %). */
  clock: finite.positive().default(1),
  somersloops: z.number().int().min(0).default(0),
  /** `null` = geplant, aber noch nicht im Grundriss aufgestellt. */
  placement: PlacementSchema.nullable(),
  /** Herkunft aus einer Gebäudegruppe (Vorlage). */
  groupInstance: z
    .object({
      groupId: id,
      instanceId: id,
      /** Mitglied der Vorlage, aus dem das Gebäude entstand (für Aktualisierungen). */
      memberKey: z.string().nullable().default(null),
    })
    .nullable()
    .default(null),
  /**
   * Nur Gewinnungsgebäude (Miner, Extraktoren): geförderter Rohstoff und
   * Reinheit des Vorkommens. `null` = noch nicht festgelegt.
   */
  extraction: ExtractionSchema.nullable().default(null),
  /**
   * Nur Frachtplattformen: Be- oder Entladen und zugehöriger Bahnhof. Bildet
   * die Schnittstelle zwischen Fabrik und Transportaufträgen.
   */
  transfer: TransferSchema.nullable().default(null),
  notes: z.string().default(''),
});
export type Building = z.infer<typeof BuildingSchema>;

/** Verweis auf einen konkreten Anschluss eines Gebäudes. */
export const PortRefSchema = z.object({
  buildingId: id,
  /** Stabile Anschluss-ID, z. B. `belt-in-0`, `pipe-out-1`, `pipe-any-2`. */
  portId: z.string(),
});
export type PortRef = z.infer<typeof PortRefSchema>;

export const LinkKindSchema = z.enum(['belt', 'pipe']);
export type LinkKind = z.infer<typeof LinkKindSchema>;

/**
 * Verlegemodus einer Leitung:
 * - `direct`: gerade Abschnitte zwischen den Zwischenpunkten (Polylinie)
 * - `straight`: rechtwinklig (achsparallele Abschnitte)
 * - `curved`: weiche Kurve durch die Zwischenpunkte
 */
export const LinkRoutingSchema = z.enum(['direct', 'straight', 'curved']);
export type LinkRouting = z.infer<typeof LinkRoutingSchema>;

export const LogisticsLinkSchema = z.object({
  id,
  factoryId: id,
  kind: LinkKindSchema,
  /** Band- bzw. Rohrstufe als Gebäudetyp (z. B. `Build_ConveyorBeltMk3_C`). */
  tier: z.string(),
  from: PortRefSchema,
  to: PortRefSchema,
  /**
   * Zwischenpunkte in Weltkoordinaten. Aufeinanderfolgende Punkte mit gleicher
   * x/y-Lage und unterschiedlicher Höhe bilden einen Förderlift bzw. ein
   * senkrechtes Rohr.
   */
  waypoints: z.array(Vec3Schema).default([]),
  routing: LinkRoutingSchema.default('direct'),
});
export type LogisticsLink = z.infer<typeof LogisticsLinkSchema>;

/** Wiederverwendbare Gebäudegruppe (Vorlage). Instanzen sind Kopien. */
export const BuildingGroupSchema = z.object({
  id,
  name: z.string(),
  members: z.array(
    z.object({
      key: z.string(),
      type: z.string(),
      recipeId: z.string().nullable(),
      clock: finite.positive(),
      somersloops: z.number().int().min(0),
      /** Lage relativ zum Gruppenursprung. */
      x: finite,
      y: finite,
      zOffsetM: finite,
      rotationDeg: finite,
      extraction: ExtractionSchema.nullable().default(null),
    }),
  ),
  links: z.array(
    z.object({
      kind: LinkKindSchema,
      tier: z.string(),
      from: z.object({ memberKey: z.string(), portId: z.string() }),
      to: z.object({ memberKey: z.string(), portId: z.string() }),
      waypoints: z.array(Vec3Schema),
      routing: LinkRoutingSchema.default('direct'),
    }),
  ),
});
export type BuildingGroup = z.infer<typeof BuildingGroupSchema>;

// ---------------------------------------------------------------------------
// Produktion
// ---------------------------------------------------------------------------

export const ProductionPlanSchema = z.object({
  id,
  factoryId: id,
  name: z.string(),
  /**
   * `target`: Zielmengen vorgeben, Rohstoffbedarf minimieren.
   * `maximize`: bei begrenzten Rohstoffen bzw. Maschinen die Zielprodukte
   * im angegebenen Verhältnis maximieren.
   */
  mode: z.enum(['target', 'maximize']),
  targets: z.array(z.object({ itemId: z.string(), ratePerMin: finite.nonnegative() })),
  /** Verfügbare Rohstoffe/Zulieferungen. Ohne Eintrag: unbegrenzt (target) bzw. 0 (maximize). */
  supplies: z.array(
    z.object({
      itemId: z.string(),
      maxPerMin: finite.nonnegative().nullable(),
      origin: z.enum(['local', 'import']),
    }),
  ),
  /** Rezeptauswahl: freigeschaltete Alternativrezepte und ausgeschlossene Rezepte. */
  enabledAlternates: z.array(z.string()),
  disabledRecipes: z.array(z.string()),
  /** Obergrenzen je Rezept (Maschinenäquivalente bei 100 %). */
  machineLimits: z.array(z.object({ recipeId: z.string(), maxMachines: finite.nonnegative() })),
  /** Vorhandene Maschinen der Fabrik als Obergrenze verwenden. */
  limitToExistingMachines: z.boolean(),
  /** Gewichtung der Zielfunktion. */
  optimize: z.enum(['resources', 'power', 'machines']),
});
export type ProductionPlan = z.infer<typeof ProductionPlanSchema>;

// ---------------------------------------------------------------------------
// Schiene
// ---------------------------------------------------------------------------

export const RailNetworkSchema = z.object({
  id,
  name: z.string(),
  color: z.string(),
  notes: z.string().default(''),
});
export type RailNetwork = z.infer<typeof RailNetworkSchema>;

/**
 * Gleisverbindungspunkt („Joint“). Ein Knoten hat eine Fahrtachse `headingDeg`
 * und zwei Seiten: Seite A liegt entgegen, Seite B in Richtung der Achse.
 * Ein Zug fährt immer von einem A-Segment zu einem B-Segment oder umgekehrt.
 * Mehrere Segmente auf derselben Seite bilden eine Weiche.
 */
export const RailNodeSchema = z.object({
  id,
  networkId: id,
  position: Vec3Schema,
  headingDeg: finite,
});
export type RailNode = z.infer<typeof RailNodeSchema>;

export const NodeSideSchema = z.enum(['A', 'B']);
export type NodeSide = z.infer<typeof NodeSideSchema>;

export const SegmentEndSchema = z.object({ nodeId: id, side: NodeSideSchema });
export type SegmentEnd = z.infer<typeof SegmentEndSchema>;

export const RailSegmentSchema = z.object({
  id,
  networkId: id,
  a: SegmentEndSchema,
  b: SegmentEndSchema,
  /**
   * Kubische Bezierkurve zwischen den Knoten. Die Tangenten folgen aus den
   * Knotenachsen; `handleA`/`handleB` sind die Längen der Kontrollarme in
   * Metern. `null` = automatisch (Abstand/3).
   */
  handleA: finite.nullable().default(null),
  handleB: finite.nullable().default(null),
  /** Gleis gehört zu einem Bahnhof bzw. Bahnsteig. */
  stationId: id.nullable().default(null),
  /** Geplante Fahrtrichtung (Planungsangabe, keine Spielmechanik). */
  intendedDirection: z.enum(['both', 'a-to-b', 'b-to-a']).default('both'),
});
export type RailSegment = z.infer<typeof RailSegmentSchema>;

export const SignalKindSchema = z.enum(['block', 'path']);
export type SignalKind = z.infer<typeof SignalKindSchema>;

export const RailSignalSchema = z.object({
  id,
  networkId: id,
  nodeId: id,
  kind: SignalKindSchema,
  /**
   * `forward`: gilt für Züge, die den Knoten in Achsrichtung (A → B) passieren.
   * `backward`: gilt für Züge in Gegenrichtung (B → A).
   */
  facing: z.enum(['forward', 'backward']),
});
export type RailSignal = z.infer<typeof RailSignalSchema>;

export const PlatformSchema = z.object({
  id,
  type: z.enum(['freight', 'fluid', 'empty']),
  mode: z.enum(['load', 'unload']),
  /** Linke oder rechte Ausrichtung der Anschlüsse (Planungsangabe). */
  flipped: z.boolean().default(false),
});
export type Platform = z.infer<typeof PlatformSchema>;

/**
 * Bahnhof mit angehängten Bahnsteigen. Der Bahnhof besitzt ein eigenes, gerades
 * Gleisstück von `backNodeId` nach `frontNodeId`. Züge halten nur, wenn sie in
 * Richtung back → front einfahren; die Lok steht am Bahnhofsgebäude (vorn),
 * die Wagen an den Bahnsteigen dahinter.
 */
export const StationSchema = z.object({
  id,
  networkId: id,
  name: z.string(),
  factoryId: id.nullable().default(null),
  platforms: z.array(PlatformSchema),
  backNodeId: id,
  frontNodeId: id,
  segmentId: id,
});
export type Station = z.infer<typeof StationSchema>;

export const VehicleSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('locomotive'), reversed: z.boolean() }),
  z.object({ kind: z.literal('wagon'), cargo: z.enum(['solid', 'liquid']) }),
]);
export type Vehicle = z.infer<typeof VehicleSchema>;

export const TrainSchema = z.object({
  id,
  networkId: id,
  name: z.string(),
  color: z.string(),
  /** Reihenfolge von vorn nach hinten. */
  consist: z.array(VehicleSchema).min(1),
  timetableId: id.nullable(),
  /** Startposition für die Simulation (Segment), optional. */
  startSegmentId: id.nullable().default(null),
});
export type Train = z.infer<typeof TrainSchema>;

export const TimetableStopSchema = z.object({
  id,
  stationId: id,
  /** Wartezeit in Sekunden nach dem Andocken. */
  waitS: finite.nonnegative().default(0),
  /** Abfahrtsbedingung zusätzlich zur Wartezeit. */
  condition: z.enum(['none', 'fully-loaded', 'fully-unloaded']).default('none'),
  /** Umschlag: alles, nichts oder nur bestimmte Gegenstände. */
  transfer: z.enum(['all', 'none', 'items']).default('all'),
  itemIds: z.array(z.string()).default([]),
});
export type TimetableStop = z.infer<typeof TimetableStopSchema>;

export const TimetableSchema = z.object({
  id,
  networkId: id,
  name: z.string(),
  stops: z.array(TimetableStopSchema),
});
export type Timetable = z.infer<typeof TimetableSchema>;

export const TransportOrderSchema = z.object({
  id,
  name: z.string(),
  itemId: z.string(),
  ratePerMin: finite.nonnegative(),
  fromFactoryId: id,
  toFactoryId: id,
  fromStationId: id.nullable().default(null),
  toStationId: id.nullable().default(null),
  trainIds: z.array(id).default([]),
  /** Geschätzte Umlaufzeit, solange nicht simuliert (Sekunden). */
  roundTripEstimateS: finite.positive().nullable().default(null),
});
export type TransportOrder = z.infer<typeof TransportOrderSchema>;

// ---------------------------------------------------------------------------
// Sonstiges
// ---------------------------------------------------------------------------

export const MeasurementSchema = z.object({
  id,
  factoryId: id.nullable(),
  floorId: id.nullable(),
  from: Vec3Schema,
  to: Vec3Schema,
  label: z.string().default(''),
});
export type Measurement = z.infer<typeof MeasurementSchema>;

export const FindingStateSchema = z.object({
  status: z.enum(['acknowledged', 'ignored']),
  note: z.string().default(''),
});
export type FindingState = z.infer<typeof FindingStateSchema>;

export const SimulationSettingsSchema = z.object({
  /**
   * Angenommene Durchschnittsgeschwindigkeit (inkl. Anfahren und Bremsen) für
   * Fahrzeitschätzungen und die vereinfachte Simulation.
   */
  trainAverageSpeedKmh: finite.positive().default(80),
  /** Dauer des Umschlags je Halt (Wiki: 27,08 s). */
  dockingS: finite.nonnegative().default(27.08),
  /** Simulationsschritt in Sekunden. */
  timeStepS: finite.positive().default(0.5),
  /** Simulationsdauer in Sekunden (Auswertung). */
  durationS: finite.positive().default(3600),
});
export type SimulationSettings = z.infer<typeof SimulationSettingsSchema>;

export const ProjectSettingsSchema = z.object({
  /** Rasterweite in Metern (Fundament = 8 m). */
  gridM: finite.positive().default(8),
  /** Fangweite in Metern (0 = aus). */
  snapM: finite.nonnegative().default(1),
  /** Fangwinkel in Grad. */
  snapAngleDeg: finite.positive().default(90),
  simulation: SimulationSettingsSchema.default(SimulationSettingsSchema.parse({})),
});
export type ProjectSettings = z.infer<typeof ProjectSettingsSchema>;

const table = <T extends z.ZodTypeAny>(schema: T) => z.record(z.string(), schema).default({});

export const ProjectSchema = z.object({
  formatVersion: z.literal(PROJECT_FORMAT_VERSION),
  id,
  name: z.string(),
  description: z.string().default(''),
  createdAt: z.string(),
  updatedAt: z.string(),
  gameData: z.object({ datasetId: z.string(), gameVersion: z.string() }),
  settings: ProjectSettingsSchema,
  factories: table(FactorySchema),
  floors: table(FloorSchema),
  areas: table(PlanAreaSchema),
  buildings: table(BuildingSchema),
  links: table(LogisticsLinkSchema),
  groups: table(BuildingGroupSchema),
  productionPlans: table(ProductionPlanSchema),
  railNetworks: table(RailNetworkSchema),
  railNodes: table(RailNodeSchema),
  railSegments: table(RailSegmentSchema),
  railSignals: table(RailSignalSchema),
  stations: table(StationSchema),
  trains: table(TrainSchema),
  timetables: table(TimetableSchema),
  transportOrders: table(TransportOrderSchema),
  measurements: table(MeasurementSchema),
  findingStates: table(FindingStateSchema),
});
export type Project = z.infer<typeof ProjectSchema>;

/** Namen aller ID-Tabellen eines Projekts. */
export type EntityTable =
  | 'factories'
  | 'floors'
  | 'areas'
  | 'buildings'
  | 'links'
  | 'groups'
  | 'productionPlans'
  | 'railNetworks'
  | 'railNodes'
  | 'railSegments'
  | 'railSignals'
  | 'stations'
  | 'trains'
  | 'timetables'
  | 'transportOrders'
  | 'measurements';

/** Typisierter Verweis auf ein Objekt im Projekt. */
export interface ObjectRef {
  table: EntityTable;
  id: string;
}
