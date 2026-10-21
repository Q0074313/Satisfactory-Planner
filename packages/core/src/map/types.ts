/**
 * Kartendaten: Rohstoffvorkommen der Spielwelt (Nodes, Quellen, Geysire).
 *
 * Koordinaten sind Weltkoordinaten des Spiels in Metern (Spiel: Zentimeter),
 * x nach Osten, y nach Süden, z nach oben. Das entspricht der Draufsicht des
 * Planers (x nach rechts, y nach unten).
 */
import type { Purity } from '../model/schema.ts';

export const MAP_SCHEMA_VERSION = 1;

/**
 * - `node`: Rohstoffvorkommen für Miner bzw. Ölpumpe
 * - `well`: Satellit einer Rohstoffquelle (Quellenextraktor)
 * - `well-core`: Mitte einer Rohstoffquelle (Quellenkompressor); Lage aus den Satelliten gemittelt
 * - `geyser`: Geysir (Geothermie-Generator)
 */
export type MapNodeKind = 'node' | 'well' | 'well-core' | 'geyser';

export interface MapNode {
  /** Stabiler Objektname aus der Spielwelt, z. B. `BP_ResourceNode555`. */
  id: string;
  kind: MapNodeKind;
  /** Rohstoff (Gegenstand); bei Geysiren `null`. */
  itemId: string | null;
  /** Reinheit; bei Quellenmitten `null`. */
  purity: Purity | null;
  x: number;
  y: number;
  z: number;
  /** Nur Satelliten: zugehörige Quellenmitte. */
  coreId?: string;
  /** Laut Quelle durch Gelände oder Objekte verdeckt. */
  obstructed?: boolean;
}

export interface MapData {
  schemaVersion: number;
  meta: {
    source: string;
    url: string;
    retrievedAt: string;
    /** Versionskennung der Quelle (z. B. Datenstand der Karte). */
    sourceVersion: string;
    /** Spielbuild, auf den sich die Quelle bezieht. */
    sourceBuild: string;
    license: string;
    notes: string[];
  };
  /** Spielbarer Bereich der Karte (Meter). */
  world: { west: number; east: number; north: number; south: number };
  nodes: MapNode[];
}
