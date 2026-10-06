import { defineRule } from '../validation/registry.ts';

const PLAN = { label: 'Konsistenz der Transportplanung' };
const CAR = { label: 'Satisfactory Wiki – Freight Car (32 Stapel, 2400 m³)', url: 'https://satisfactory.wiki.gg/wiki/Freight_Car' };
const PLATFORM = { label: 'Satisfactory Wiki – Freight Platform (Umschlag 27,08 s)', url: 'https://satisfactory.wiki.gg/wiki/Freight_Platform' };

export const TRN_NO_TRAIN = defineRule({
  id: 'TRN-001',
  title: 'Transportauftrag ohne Zug',
  domain: 'transport',
  kind: 'recommendation',
  certainty: 'static',
  severity: 'warning',
  description: 'Dem Auftrag ist kein Zug zugeordnet. Die Menge wird im Plan erwartet, aber von niemandem befördert.',
  sources: [PLAN],
});

export const TRN_TIMETABLE_MISSES_STATION = defineRule({
  id: 'TRN-002',
  title: 'Zug hält nicht am Lade- oder Entladebahnhof',
  domain: 'transport',
  kind: 'recommendation',
  certainty: 'static',
  severity: 'error',
  description: 'Der Fahrplan des zugeordneten Zuges enthält den Lade- bzw. Entladebahnhof des Auftrags nicht.',
  sources: [PLAN],
});

export const TRN_CAPACITY = defineRule({
  id: 'TRN-003',
  title: 'Geschätzte Zugkapazität reicht nicht',
  domain: 'transport',
  kind: 'recommendation',
  certainty: 'dynamic',
  severity: 'warning',
  description:
    'Kapazität je Umlauf (Wagen × 32 Stapel × Stapelgröße bzw. 2400 m³) geteilt durch die geschätzte Umlaufzeit ergibt weniger als die Auftragsmenge. Die Umlaufzeit ist eine Schätzung aus Streckenlänge, angenommener Durchschnittsgeschwindigkeit, Umschlagzeit und Wartezeiten.',
  sources: [CAR, PLATFORM],
});

export const TRN_STATION_FACTORY = defineRule({
  id: 'TRN-004',
  title: 'Bahnhof gehört nicht zur Fabrik des Auftrags',
  domain: 'transport',
  kind: 'recommendation',
  certainty: 'static',
  severity: 'warning',
  description: 'Der Lade- bzw. Entladebahnhof ist einer anderen Fabrik zugeordnet als der Absender bzw. Empfänger des Auftrags.',
  sources: [PLAN],
});

export const TRN_IMPORT_GAP = defineRule({
  id: 'TRN-005',
  title: 'Importbedarf ohne ausreichenden Transportauftrag',
  domain: 'transport',
  kind: 'recommendation',
  certainty: 'static',
  severity: 'warning',
  description: 'Ein Produktionsplan bezieht einen Gegenstand als Import. Die Transportaufträge an diese Fabrik decken die benötigte Menge nicht.',
  sources: [PLAN],
});

export const TRN_SUPPLIER_SHORT = defineRule({
  id: 'TRN-006',
  title: 'Lieferfabrik erzeugt zu wenig',
  domain: 'transport',
  kind: 'recommendation',
  certainty: 'static',
  severity: 'warning',
  description:
    'Die Fabrik soll mehr liefern, als ihre angelegten Maschinen netto erzeugen (Erzeugung − eigener Verbrauch + eigene Importe). Maßgeblich sind die angelegten Maschinen mit Takt.',
  sources: [PLAN],
});

export const TRN_WRONG_WAGON = defineRule({
  id: 'TRN-007',
  title: 'Kein passender Wagen für den Gegenstand',
  domain: 'transport',
  kind: 'game-rule',
  certainty: 'static',
  severity: 'error',
  description: 'Feststoffe fahren in Güterwagen, Flüssigkeiten und Gase in Flüssigkeitswagen. Der zugeordnete Zug hat keinen passenden Wagen.',
  sources: [CAR],
});

export const TRN_ESTIMATE = defineRule({
  id: 'TRN-008',
  title: 'Zugdurchsatz ist eine Schätzung',
  domain: 'transport',
  kind: 'unchecked',
  certainty: 'dynamic',
  severity: 'info',
  description:
    'Umlaufzeiten beruhen auf Annahmen: konstante Durchschnittsgeschwindigkeit, Umschlag 27,08 s je Halt, Wartezeiten laut Fahrplan, keine Wartezeiten an Signalen, volle Beladung. Ladebedingungen, Beschleunigung, Steigungen und Belegung durch andere Züge sind nicht berücksichtigt. Die Simulation im Schienennetz kann gemessene Umlaufzeiten liefern.',
  sources: [{ label: 'Annahmen des Planers (Einstellungen → Transport)' }],
});

export const TRN_NO_PLATFORM = defineRule({
  id: 'TRN-009',
  title: 'Keine passende Frachtplattform im Grundriss',
  domain: 'transport',
  kind: 'recommendation',
  certainty: 'static',
  severity: 'info',
  description:
    'Für den Auftrag gibt es in der Fabrik keine Frachtplattform im passenden Modus (Beladen beim Absender, Entladen beim Empfänger). Im Durchsatzmodell der Fabrik fehlt damit die Schnittstelle zum Zug.',
  sources: [PLAN],
});
