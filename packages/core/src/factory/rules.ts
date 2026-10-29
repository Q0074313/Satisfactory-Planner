import { defineRule } from '../validation/registry.ts';

const DOCS = { label: 'Satisfactory Docs (CommunityResources), Feld mClearanceData' };

export const FAB_HARD_OVERLAP = defineRule({
  id: 'FAB-001',
  title: 'Kollisionsboxen überschneiden sich',
  domain: 'factory',
  kind: 'game-rule',
  certainty: 'static',
  severity: 'error',
  description:
    'Gebäude besitzen laut Spieldaten feste Kollisionsboxen (mClearanceData). Überschneiden sich zwei feste Boxen in Grundriss und Höhe, lässt das Spiel das zweite Gebäude nicht bauen.',
  sources: [DOCS],
});

export const FAB_SOFT_OVERLAP = defineRule({
  id: 'FAB-002',
  title: 'Weiche Freihaltezone überschneidet sich',
  domain: 'factory',
  kind: 'unchecked',
  certainty: 'static',
  severity: 'warning',
  description:
    'Einige Kollisionsboxen sind in den Spieldaten als weich (CT_Soft) markiert, z. B. bei Splittern und Rohrkreuzungen. Ob sich weiche Zonen im Spiel überschneiden dürfen, ist nicht verifiziert. Der Planer meldet die Überschneidung deshalb nur als Warnung.',
  sources: [DOCS],
});

export const FAB_OUTSIDE_AREA = defineRule({
  id: 'FAB-003',
  title: 'Gebäude außerhalb der Baufläche',
  domain: 'factory',
  kind: 'recommendation',
  certainty: 'static',
  severity: 'warning',
  description: 'Auf dem Stockwerk ist eine Baufläche festgelegt, das Gebäude liegt aber ganz oder teilweise außerhalb.',
  sources: [{ label: 'Eigene Planungsvorgabe' }],
});

export const FAB_IN_CLEARANCE = defineRule({
  id: 'FAB-004',
  title: 'Gebäude im Planungsabstand',
  domain: 'factory',
  kind: 'recommendation',
  certainty: 'static',
  severity: 'warning',
  description: 'Das Gebäude ragt in einen selbst festgelegten Planungsabstand, z. B. einen Wartungs- oder Laufweg.',
  sources: [{ label: 'Eigene Planungsvorgabe' }],
});

export const FAB_PORTS_UNVERIFIED = defineRule({
  id: 'FAB-005',
  title: 'Anschlusslagen sind schematisch',
  domain: 'factory',
  kind: 'unchecked',
  certainty: 'static',
  severity: 'info',
  description:
    'Die Lage der Anschlüsse stammt aus den Spielpaketen. Für einzelne Gebäude fehlt sie dort; ihre Eingänge werden schematisch hinten, Ausgänge vorn dargestellt. Ob ein Anschluss im Spiel tatsächlich auf dieser Seite liegt, ist für diese Gebäude nicht geprüft.',
  sources: [DOCS, { label: 'Spielpakete (Blueprint-Komponenten), siehe docs/SPIELDATEN.md' }],
});

export const FAB_LINK_UNCHECKED = defineRule({
  id: 'FAB-006',
  title: 'Baubarkeit von Leitungen nicht geprüft',
  domain: 'factory',
  kind: 'unchecked',
  certainty: 'static',
  severity: 'info',
  description:
    'Für Förderbänder und Rohre werden Kurvenradien, Mindestlängen, Steigungen, Kollisionen mit anderen Objekten und Pumpenförderhöhen nicht geprüft. Eine im Editor gezeichnete Verbindung ist daher nicht automatisch im Spiel baubar.',
  sources: [{ label: 'Bekannte Einschränkung des Planers' }],
});

export const FAB_TALLER_THAN_FLOOR = defineRule({
  id: 'FAB-007',
  title: 'Gebäude höher als das Stockwerk',
  domain: 'factory',
  kind: 'recommendation',
  certainty: 'static',
  severity: 'warning',
  description:
    'Die Höhe der Kollisionsbox übersteigt die lichte Höhe des Stockwerks. Das darüberliegende Stockwerk muss an dieser Stelle ausgespart werden.',
  sources: [DOCS],
});

export const FAB_UNPLACED = defineRule({
  id: 'FAB-008',
  title: 'Geplante Maschinen ohne Platz im Grundriss',
  domain: 'factory',
  kind: 'recommendation',
  certainty: 'static',
  severity: 'info',
  description: 'Die Maschinen sind im Produktionsplan angelegt, stehen aber noch nicht im Grundriss.',
  sources: [{ label: 'Planungsstand' }],
});

export const FAB_NO_RECIPE = defineRule({
  id: 'FAB-009',
  title: 'Produktionsgebäude ohne Rezept',
  domain: 'factory',
  kind: 'recommendation',
  certainty: 'static',
  severity: 'warning',
  description: 'Ein Produktionsgebäude ohne Rezept trägt nichts zur Bilanz bei.',
  sources: [{ label: 'Planungsstand' }],
});

export const FAB_UNKNOWN_TYPE = defineRule({
  id: 'FAB-010',
  title: 'Gebäudetyp nicht im Spieldatensatz',
  domain: 'factory',
  kind: 'game-rule',
  certainty: 'static',
  severity: 'error',
  description:
    'Der Gebäudetyp ist im Spieldatensatz des Projekts nicht vorhanden, etwa nach einem Wechsel der Spielversion. Maße und Anschlüsse sind dann unbekannt.',
  sources: [{ label: 'Spieldatensatz des Projekts' }],
});

const FLOW = { label: 'Durchsatzmodell des Planers (lineares Programm über die eingezeichneten Verbindungen)' };
const BELTS = { label: 'Satisfactory Docs: mSpeed der Förderbänder bzw. mFlowLimit der Rohre' };

export const FAB_OVER_CAPACITY = defineRule({
  id: 'FAB-011',
  title: 'Leitung zu klein für den benötigten Durchsatz',
  domain: 'factory',
  kind: 'game-rule',
  certainty: 'static',
  severity: 'warning',
  description:
    'Ohne Kapazitätsgrenzen müsste die Verbindung mehr tragen, als die gezeichnete Band- bzw. Rohrstufe schafft (Förderband = mSpeed / 2 pro Minute, Rohr = mFlowLimit · 60 m³/min). Die angeschlossenen Maschinen laufen dann langsamer.',
  sources: [BELTS, FLOW],
});

export const FAB_UNDERSUPPLIED = defineRule({
  id: 'FAB-012',
  title: 'Maschine wird nicht vollständig versorgt',
  domain: 'factory',
  kind: 'game-rule',
  certainty: 'static',
  severity: 'warning',
  description:
    'Eine Maschine verarbeitet Zutaten in festem Verhältnis. Kommt eine Zutat nicht oder zu wenig an, läuft sie entsprechend langsamer oder steht. Grundlage ist das Durchsatzmodell der eingezeichneten Verbindungen.',
  sources: [{ label: 'Rezepte aus den Satisfactory-Docs' }, FLOW],
});

export const FAB_OUTPUT_BLOCKED = defineRule({
  id: 'FAB-013',
  title: 'Produkt wird nicht abgeführt',
  domain: 'factory',
  kind: 'game-rule',
  certainty: 'static',
  severity: 'warning',
  description:
    'Eine Maschine hält an, sobald ein Ausgang voll ist – auch bei Nebenprodukten. Der Ausgang ist nicht verbunden, oder hinter der Verbindung nimmt niemand diesen Gegenstand ab.',
  sources: [{ label: 'Spielverhalten: Maschinen pausieren bei vollem Ausgangspuffer (nicht aus den Docs belegt)' }, FLOW],
});

export const FAB_WRONG_ITEM = defineRule({
  id: 'FAB-014',
  title: 'Gegenstand wird am Ziel nicht verarbeitet',
  domain: 'factory',
  kind: 'game-rule',
  certainty: 'static',
  severity: 'warning',
  description:
    'Über die Verbindung kann ein Gegenstand ankommen, den das Zielgebäude nicht annimmt (kein Rezeptbestandteil bzw. Flüssigkeit am AWESOME-Schredder). Im Spiel staut sich das Band bzw. Rohr.',
  sources: [FLOW],
});

export const FAB_FLOW_ASSUMPTIONS = defineRule({
  id: 'FAB-015',
  title: 'Durchsatzmodell vereinfacht',
  domain: 'factory',
  kind: 'unchecked',
  certainty: 'static',
  severity: 'info',
  description:
    'Das Durchsatzmodell rechnet mit bestmöglicher Verteilung an Splittern, ohne Filter intelligenter Splitter, mit Rohrfluss in Zeichenrichtung und ohne Förderhöhe. Kraftwerke ohne Brennstoffwahl nehmen Brennstoff ohne modellierten Verbrauch ab. Pufferfüllstände und Anlaufzeiten werden nicht simuliert.',
  sources: [FLOW],
});

export const FAB_SUNK_SURPLUS = defineRule({
  id: 'FAB-020',
  title: 'Überschuss im AWESOME-Schredder',
  domain: 'factory',
  kind: 'recommendation',
  certainty: 'static',
  severity: 'info',
  description:
    'Gegenstände, die in einen AWESOME-Schredder fließen, gelten als ordentlich abgeführt (kein Stau, kein Fehler). Der Planer wertet sie trotzdem als Überschuss: Sie werden nicht weiterverarbeitet und stehen in der Bilanz als „davon Schredder“. So bleibt sichtbar, was eine andere Fabrik oder ein weiteres Rezept noch nutzen könnte.',
  sources: [FLOW],
});

const HEAD_LIFT = { label: 'Satisfactory Wiki – Head lift', url: 'https://satisfactory.wiki.gg/wiki/Head_lift' };

export const FAB_PIPE_HEAD = defineRule({
  id: 'FAB-016',
  title: 'Förderhöhe von Rohren nicht geprüft',
  domain: 'factory',
  kind: 'unchecked',
  certainty: 'static',
  severity: 'info',
  description:
    'Ein Rohr steigt an, und für das einspeisende Gebäude ist keine Förderhöhe bekannt. Das Wiki nennt sie nur für Extraktoren, Raffinerie, Umfüllanlage, Mixer, Flüssigkeits-Frachtplattform, Speicher und Pumpen. Pumpen schaffen laut Docs 20 m (Mk.1) bzw. 50 m (Mk.2) Förderhöhe (mDesignPressure).',
  sources: [{ label: 'Satisfactory Docs: mDesignPressure der Pipeline-Pumpen' }, HEAD_LIFT],
});

export const FAB_PIPE_HEAD_SHORT = defineRule({
  id: 'FAB-019',
  title: 'Förderhöhe reicht nicht',
  domain: 'factory',
  kind: 'game-rule',
  certainty: 'static',
  severity: 'info',
  description:
    'Flüssigkeiten steigen nur so hoch, wie die Förderhöhe der Quelle reicht: Extraktoren, Raffinerie, Umfüllanlage, Mixer und Flüssigkeits-Frachtplattform 10 m, Flüssigkeitsspeicher 8 m, Industrieller Flüssigkeitsspeicher 12 m, Pumpe Mk.1 20 m, Mk.2 50 m (empfohlene Werte laut Wiki, tatsächlich etwas mehr). Rohrkreuzungen geben die höchste ankommende Förderhöhe weiter. Gase sind ausgenommen. Der Planer meldet das nur als Hinweis: Pumpen werden nicht eingeplant, sondern im Spiel gesetzt.',
  sources: [HEAD_LIFT, { label: 'Satisfactory Wiki – Pipeline Pump', url: 'https://satisfactory.wiki.gg/wiki/Pipeline_Pump' }],
});

export const FAB_LIFT_THROUGH_FLOOR = defineRule({
  id: 'FAB-017',
  title: 'Senkrechte Leitung durchquert ein Stockwerk',
  domain: 'factory',
  kind: 'recommendation',
  certainty: 'static',
  severity: 'info',
  description: 'Ein Förderlift oder senkrechtes Rohr führt durch die Ebene eines Stockwerks. Dort ist eine Aussparung im Boden nötig.',
  sources: [{ label: 'Eigene Planungsvorgabe' }],
});

export const FAB_FLOOR_CHANGE_WITHOUT_LIFT = defineRule({
  id: 'FAB-018',
  title: 'Höhenwechsel ohne senkrechten Abschnitt',
  domain: 'factory',
  kind: 'unchecked',
  certainty: 'static',
  severity: 'info',
  description:
    'Die Verbindung überwindet mehr als 1 m Höhe ohne senkrechten Abschnitt (Förderlift bzw. senkrechtes Rohr). Die zulässige Steigung von Bändern steht nicht in den Spieldaten und wird nicht geprüft.',
  sources: [{ label: 'Bekannte Einschränkung des Planers' }],
});

export const FAB_BLACKBOX = defineRule({
  id: 'FAB-021',
  title: 'Fabrik als Blackbox geplant',
  domain: 'factory',
  kind: 'unchecked',
  certainty: 'static',
  severity: 'info',
  description:
    'Die Fabrik wird nur über ihre Produktionspläne geplant. Grundriss, Leitungen, Übergaben und Durchsatz werden nicht geprüft; der Planer nimmt an, dass die Fabrik wie geplant läuft.',
  sources: [{ label: 'Eigene Planungsvorgabe' }],
});
