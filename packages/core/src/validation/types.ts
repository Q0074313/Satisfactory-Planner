import type { ObjectRef } from '../model/schema.ts';

export type Severity = 'error' | 'warning' | 'info';

/**
 * Art der Aussage:
 * - `game-rule`: Spielbeschränkung bzw. Spielmechanik, durch Quelle belegt.
 * - `recommendation`: persönliche Planungsempfehlung, im Spiel trotzdem baubar.
 * - `unchecked`: Aspekt wird ausdrücklich NICHT geprüft bzw. ist nicht verifiziert.
 */
export type FindingKind = 'game-rule' | 'recommendation' | 'unchecked';

/**
 * - `static`: allein aus dem Plan nachweisbar.
 * - `dynamic`: mögliches Problem, das erst durch Zuglängen, Belegung,
 *   Fahrpläne oder zeitliche Abläufe entsteht. Kein Nachweis.
 */
export type Certainty = 'static' | 'dynamic';

export type Domain = 'project' | 'factory' | 'production' | 'rail' | 'transport' | 'map';

export interface RuleSource {
  label: string;
  url?: string;
}

export interface RuleDef {
  id: string;
  title: string;
  domain: Domain;
  kind: FindingKind;
  certainty: Certainty;
  severity: Severity;
  /** Beschreibung der zugrunde liegenden Spielmechanik bzw. Empfehlung. */
  description: string;
  sources: RuleSource[];
}

export interface FindingLocation {
  x: number;
  y: number;
  z?: number;
  factoryId?: string;
  floorId?: string;
  networkId?: string;
}

export interface Finding {
  /** Stabiler Schlüssel aus Regel und betroffenen Objekten. */
  key: string;
  ruleId: string;
  severity: Severity;
  kind: FindingKind;
  certainty: Certainty;
  domain: Domain;
  /** Betroffene Objekte; das erste ist das Hauptobjekt. */
  objects: ObjectRef[];
  /** Kurze Meldung. */
  message: string;
  /** Verständliche Erklärung. */
  explanation: string;
  /** Konkreter Korrekturvorschlag. */
  suggestion: string;
  location?: FindingLocation;
}

export function findingKey(ruleId: string, objects: ObjectRef[], extra = ''): string {
  return [ruleId, ...objects.map((o) => `${o.table}:${o.id}`).sort(), extra].filter(Boolean).join('|');
}
