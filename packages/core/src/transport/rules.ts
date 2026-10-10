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

export const TRN_STOP_EXCLUDES_ITEM = defineRule({
  id: 'TRN-010',
  title: 'Halt schließt den Gegenstand vom Umschlag aus',
  domain: 'transport',
  kind: 'game-rule',
  certainty: 'static',
  severity: 'error',
  description:
    'Der Zug hält am Lade- bzw. Entladebahnhof, aber der Halt schlägt dort nichts oder nur andere Gegenstände um (Halteeinstellung „nichts“ bzw. „nur bestimmte Gegenstände“). Der Gegenstand des Auftrags wird dort weder geladen noch entladen.',
  sources: [{ label: 'Satisfactory Wiki – Electric Locomotive (Stop settings)', url: 'https://satisfactory.wiki.gg/wiki/Electric_Locomotive' }],
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

const VEHICLES = { label: 'Satisfactory Docs (mInventorySize) und Wiki „Truck“, „Tractor“, „Explorer“', url: 'https://satisfactory.wiki.gg/wiki/Truck' };
const TRUCK_STATION = { label: 'Satisfactory Wiki – Truck Station', url: 'https://satisfactory.wiki.gg/wiki/Truck_Station' };
const LOGISTICS = { label: 'Spieldaten: Band- und Rohrstufen (mSpeed, mFlowLimit)' };

export const TRN_MODE_MISMATCH = defineRule({
  id: 'TRN-011',
  title: 'Transportmittel passt nicht zum Gegenstand',
  domain: 'transport',
  kind: 'game-rule',
  certainty: 'static',
  severity: 'error',
  description:
    'Feststoffe fahren auf Förderbändern, in Fahrzeugen mit Laderaum (Schlepper, Lkw, Explorer) und mit Drohnen, Flüssigkeiten und Gase in Rohren und im Tanklaster (Drohnen nur abgefüllt).',
  sources: [VEHICLES, LOGISTICS],
});

export const TRN_NO_VEHICLE = defineRule({
  id: 'TRN-012',
  title: 'Fahrzeugauftrag ohne Fahrzeug',
  domain: 'transport',
  kind: 'recommendation',
  certainty: 'static',
  severity: 'warning',
  description: 'Für den Auftrag sind 0 Fahrzeuge bzw. Drohnen eingeplant. Die Menge wird erwartet, aber von niemandem befördert.',
  sources: [PLAN],
});

export const TRN_VEHICLE_CAPACITY = defineRule({
  id: 'TRN-013',
  title: 'Geschätzte Fahrzeugkapazität reicht nicht',
  domain: 'transport',
  kind: 'recommendation',
  certainty: 'dynamic',
  severity: 'warning',
  description:
    'Laderaum je Fahrt × Anzahl Fahrzeuge geteilt durch die Umlaufzeit liegt unter der Auftragsmenge. Umlauf = 2 × Strecke / Geschwindigkeit + 2 × 8 s Andocken; ohne eigene Angabe mit Höchstgeschwindigkeit, also eher zu günstig geschätzt.',
  sources: [VEHICLES, TRUCK_STATION],
});

export const TRN_DIRECT_CAPACITY = defineRule({
  id: 'TRN-014',
  title: 'Leitungen zwischen den Fabriken zu klein',
  domain: 'transport',
  kind: 'game-rule',
  certainty: 'static',
  severity: 'warning',
  description: 'Die Auftragsmenge ist größer als die Kapazität der gewählten Band- bzw. Rohrstufe mal Anzahl paralleler Leitungen.',
  sources: [LOGISTICS],
});

export const TRN_NO_INTERFACE = defineRule({
  id: 'TRN-015',
  title: 'Keine Übergabe im Grundriss',
  domain: 'transport',
  kind: 'recommendation',
  certainty: 'static',
  severity: 'info',
  description:
    'Für Fahrzeug- und Drohnenaufträge fehlt in der Fabrik eine Lkw- bzw. Tanklaster-Station oder ein Drohnenhafen im passenden Modus (Beladen beim Absender, Entladen beim Empfänger). Bei direkten Bändern und Rohren ist kein Übergabeanschluss gewählt. Dem Durchsatzmodell der Fabrik fehlt damit die Schnittstelle.',
  sources: [PLAN],
});

const DRONE = { label: 'Satisfactory Docs (Drohne, Drohnenhafen) und Wiki „Drone“', url: 'https://satisfactory.wiki.gg/wiki/Drone' };

export const TRN_DRONE_CAPACITY = defineRule({
  id: 'TRN-016',
  title: 'Geschätzte Drohnenkapazität reicht nicht',
  domain: 'transport',
  kind: 'recommendation',
  certainty: 'dynamic',
  severity: 'warning',
  description:
    'Neun Stapel je Flug × Anzahl Drohnen geteilt durch die Umlaufzeit liegt unter der Auftragsmenge. Umlauf = 2 × (Entfernung / Geschwindigkeit + 2 × 51 s Start bzw. Landung); die Geschwindigkeit hängt vom Brennstoff ab.',
  sources: [DRONE],
});

export const TRN_DRONE_FUEL = defineRule({
  id: 'TRN-017',
  title: 'Brennstoff für Drohnen fehlt beim Absender',
  domain: 'transport',
  kind: 'recommendation',
  certainty: 'static',
  severity: 'warning',
  description:
    'Drohnen nehmen den Brennstoff für einen Umlauf an ihrem Heimathafen (hier: beim Absender). Die Fabrik erzeugt bzw. erhält davon weniger, als die Drohnen geschätzt verbrauchen.',
  sources: [DRONE],
});
