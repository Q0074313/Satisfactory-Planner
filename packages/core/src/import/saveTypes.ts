/**
 * Auszug aus einem Satisfactory-Spielstand (.sav) im neutralen Format des
 * Planers. Erzeugt wird er im Browser (Web-App, Web Worker) aus dem
 * gelesenen Spielstand; der Kern baut daraus Fabriken, Produktionspläne und
 * das Schienennetz (`fromSave.ts`). So bleibt das Binärformat außerhalb des
 * Kerns, und der Import ist ohne Spielstand testbar.
 *
 * Koordinaten: Spielwelt in Metern (Spiel: Zentimeter), x nach Osten, y nach
 * Süden, z nach oben – wie die Weltkarte des Planers. Drehung (`yawDeg`) wie
 * im Spiel, im Uhrzeigersinn der Draufsicht.
 */
import type { Vec3 } from '../model/schema.ts';

/** Verweis auf eine Komponente eines Objekts im Spielstand, z. B. `{ id: 'Build_ConstructorMk1_C_2147…', comp: 'Input0' }`. */
export interface SaveRef {
  id: string;
  comp: string;
}

export interface SaveBuilding {
  /** Objektname im Spielstand (eindeutig). */
  id: string;
  /** Klasse, z. B. `Build_ConstructorMk1_C`. */
  type: string;
  x: number;
  y: number;
  z: number;
  yawDeg: number;
  /** Senkrecht eingebaut (z. B. Pumpe in einem senkrechten Rohr): Vorderseite nach oben bzw. unten. */
  vertical?: 'up' | 'down';
  recipe: string | null;
  /** Takt (1 = 100 %). */
  clock: number;
  somersloops: number;
  /** Rohstoffvorkommen (Objektname, wie `MapNode.id`); `null` bei Wasser oder ohne Vorkommen. */
  node: string | null;
  /** Kraftwerke: gewählter Brennstoff (Gegenstand). */
  fuel: string | null;
  /** Frachtplattformen und Lkw-Stationen: Beladen (`true`) bzw. Entladen. */
  loadMode: boolean | null;
  /** Band- und Rohranschlüsse: Komponentenname → verbundene Komponente. */
  conns: Record<string, SaveRef | null>;
  /** Bahnhof bzw. Bahnsteig: eingebautes Gleisstück. */
  track: string | null;
  /** Bahnsteig-Anschlüsse (PlatformConnection0/1) → verbundener Bahnsteig bzw. Bahnhof. */
  platformConns: Record<string, SaveRef | null>;
  /**
   * Smart- und programmierbare Splitter: Filterregeln (`mSortRules`). `output` = Index des Ausgangs
   * (0–2 = Output1–3; am Förderlift 0 = weiterführender Lift, 1 = Output1, 2 = Output2), `item` =
   * Klasse, z. B. `Desc_Wildcard_C` (alles), `Desc_None_C`, `Desc_Overflow_C`, `Desc_AnyUndefined_C` oder ein Gegenstand.
   */
  sortRules?: { output: number; item: string }[];
}

/** Förderband, Förderlift oder Rohr (ein Abschnitt). */
export interface SaveConveyor {
  id: string;
  type: string;
  kind: 'belt' | 'pipe';
  lift: boolean;
  /** Verlauf in Weltkoordinaten (Kurven als je eine Ecke); bei Bändern von Ende 0 (Eingang) nach Ende 1, bei Liften unten → oben. */
  points: Vec3[];
  /** Verbindungen an Ende 0 und Ende 1 (Bänder: ConveyorAny0/1, Rohre: PipelineConnection0/1). */
  conns: [SaveRef | null, SaveRef | null];
  /** Lage der beiden Enden (für die Ausrichtung von Liften). */
  ends: [Vec3, Vec3];
}

export interface SaveTrackPoint {
  p: Vec3;
  /** Tangenten der Spline (Meter, Weltkoordinaten). */
  arrive: Vec3;
  leave: Vec3;
}

export interface SaveTrack {
  id: string;
  /** Gleisstück eines Bahnhofs bzw. Bahnsteigs. */
  integrated: boolean;
  points: SaveTrackPoint[];
  /** Verbundene Gleisenden an Ende 0 (TrackConnection0) und Ende 1. */
  conns: [SaveRef[], SaveRef[]];
}

export interface SaveSignal {
  id: string;
  kind: 'block' | 'path';
  /** Gleisenden, die das Signal schützt (Gleis + TrackConnection0/1). */
  guarded: SaveRef[];
}

export interface SaveTrainStop {
  /** Bahnhofsgebäude (Objektname). */
  station: string;
  waitS: number;
  /** z. B. `TDD_LoadUnloadOnce`, `TDD_FullyLoadUnload`. */
  rule: string;
}

export interface SaveTrain {
  id: string;
  name: string;
  vehicles: { kind: 'locomotive' | 'wagon'; type: string; reversed: boolean }[];
  stops: SaveTrainStop[];
}

export interface SaveExtract {
  meta: {
    sessionName: string;
    saveName: string;
    /** Spielbuild (Changelist), z. B. 517554. */
    buildVersion: number;
    saveVersion: number;
    playSeconds: number;
    /** ISO-Zeitpunkt des Speicherns. */
    savedAt: string | null;
    modded: boolean;
  };
  /** Gekaufte Schaltpläne (Klassennamen). */
  schematics: string[];
  /** Abgeschlossene Phasen des Weltraumlifts (`null` = unbekannt). */
  phase: number | null;
  buildings: SaveBuilding[];
  conveyors: SaveConveyor[];
  tracks: SaveTrack[];
  signals: SaveSignal[];
  /** Bahnhofsnamen je Bahnhofsgebäude. */
  stations: { building: string; name: string }[];
  trains: SaveTrain[];
  /** Fundamente (Mittelpunkt; Oberkante = z + halbe Höhe laut Spieldaten). */
  foundations?: { type: string; x: number; y: number; z: number; yawDeg: number }[];
  /** Nicht übernommene Objekte je Klasse (z. B. Fundamente, Stromleitungen). */
  skipped: Record<string, number>;
}
