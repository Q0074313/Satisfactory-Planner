import { defineRule } from '../validation/registry.ts';

const SIGNALS = { label: 'Satisfactory Wiki – Train Signals', url: 'https://satisfactory.wiki.gg/wiki/Block_Signal' };
const RAILWAY = { label: 'Satisfactory Wiki – Railway', url: 'https://satisfactory.wiki.gg/wiki/Railway' };
const STATION = { label: 'Satisfactory Wiki – Train Station', url: 'https://satisfactory.wiki.gg/wiki/Train_Station' };
const PLATFORM = { label: 'Satisfactory Wiki – Freight Platform', url: 'https://satisfactory.wiki.gg/wiki/Freight_Platform' };
const FREIGHT_CAR = { label: 'Satisfactory Wiki – Freight Car (Weight)', url: 'https://satisfactory.wiki.gg/wiki/Freight_Car' };
const LOCOMOTIVE = { label: 'Satisfactory Wiki – Electric Locomotive', url: 'https://satisfactory.wiki.gg/wiki/Electric_Locomotive' };

export const RAIL_SIGNAL_DANGLING = defineRule({
  id: 'RAIL-001',
  title: 'Signal ohne Gleis auf einer Seite',
  domain: 'rail',
  kind: 'game-rule',
  certainty: 'static',
  severity: 'error',
  description:
    'Ein Signal am Ende eines Gleises, das ins Leere führt, zeigt im Spiel den Fehler „Signal has missing connections“ und wirkt wie ein rotes Signal.',
  sources: [SIGNALS],
});

export const RAIL_NO_EXIT = defineRule({
  id: 'RAIL-002',
  title: 'Block ohne Ausfahrsignal',
  domain: 'rail',
  kind: 'game-rule',
  certainty: 'static',
  severity: 'error',
  description:
    'Jeder Block braucht mindestens ein Einfahr- und mindestens ein Ausfahrsignal. Ein Block mit Einfahrsignal, aber ohne Ausfahrsignal, führt im Spiel zum Fehler „Block has no exit signal“.',
  sources: [SIGNALS],
});

export const RAIL_MIXED_ENTRY = defineRule({
  id: 'RAIL-003',
  title: 'Widersprüchliche Einfahrsignaltypen',
  domain: 'rail',
  kind: 'game-rule',
  certainty: 'static',
  severity: 'error',
  description:
    'Alle Einfahrsignale eines Blocks müssen vom selben Typ sein (nur Block- oder nur Pfadsignale). Für Ausfahrsignale gilt das nicht. Sonst meldet das Spiel „Block has conflicting entry signal types“.',
  sources: [SIGNALS],
});

export const RAIL_STATION_IN_PATH = defineRule({
  id: 'RAIL-004',
  title: 'Bahnhof in einem Pfadblock',
  domain: 'rail',
  kind: 'game-rule',
  certainty: 'static',
  severity: 'error',
  description: 'Ein Pfadblock darf keinen Bahnhof enthalten. Das Spiel meldet sonst „Path block cannot contain stations“.',
  sources: [SIGNALS],
});

export const RAIL_SIGNAL_SELF_LOOP = defineRule({
  id: 'RAIL-005',
  title: 'Signal teilt den Block nicht',
  domain: 'rail',
  kind: 'game-rule',
  certainty: 'static',
  severity: 'error',
  description:
    'Vor und hinter dem Signal liegt derselbe Block. Das Signal kann ihn deshalb nicht aufteilen („Signal loops into itself“). Ursache ist z. B. eine Schleife ohne weiteres Signal oder eine Gleiskreuzung, die beide Seiten verbindet.',
  sources: [SIGNALS],
});

export const RAIL_SIGNAL_COUNT = defineRule({
  id: 'RAIL-006',
  title: 'Zu viele oder gleichgerichtete Signale an einer Verbindung',
  domain: 'rail',
  kind: 'game-rule',
  certainty: 'static',
  severity: 'error',
  description: 'An einer Gleisverbindung sind höchstens zwei Signale in entgegengesetzte Richtungen möglich.',
  sources: [SIGNALS],
});

export const RAIL_UNREACHABLE = defineRule({
  id: 'RAIL-007',
  title: 'Fahrziel nicht erreichbar',
  domain: 'rail',
  kind: 'game-rule',
  certainty: 'static',
  severity: 'error',
  description:
    'Der Zug findet keinen Weg zum nächsten Halt. Züge fahren nicht an der Rückseite eines Signals vorbei, halten nur in Bahnhofsrichtung und fahren nur mit einer rückwärts gerichteten Lok rückwärts. Weichen führen nur von einer Knotenseite zur anderen.',
  sources: [SIGNALS, STATION],
});

export const RAIL_STATION_DEAD_END = defineRule({
  id: 'RAIL-008',
  title: 'Keine Weiterfahrt hinter dem Bahnhof',
  domain: 'rail',
  kind: 'game-rule',
  certainty: 'static',
  severity: 'warning',
  description:
    'Güterbahnsteige arbeiten laut Wiki nur, wenn der Zug in Vorwärtsrichtung einen gültigen Weg hat. Vor dem Bahnhof endet das Gleis, und kein Zug, der hier hält, kann rückwärts fahren.',
  sources: [PLATFORM],
});

export const RAIL_CROSSING_BLOCK = defineRule({
  id: 'RAIL-009',
  title: 'Kreuzende Gleise bilden einen gemeinsamen Block',
  domain: 'rail',
  kind: 'game-rule',
  certainty: 'static',
  severity: 'info',
  description:
    'Gleise, die sich ohne Verbindung auf gleicher Höhe kreuzen, gehören im Spiel zum selben Block. Als gleiche Höhe gilt hier ein Abstand unter 1 m (Annahme auf Basis der Gleis-Kollisionsbox vor 1.2). Eine solche Kreuzung braucht eine Absicherung durch Signale.',
  sources: [SIGNALS, RAILWAY],
});

export const RAIL_BLOCK_MERGE = defineRule({
  id: 'RAIL-010',
  title: 'Mehrere Blocksignale führen in einen Block',
  domain: 'rail',
  kind: 'recommendation',
  certainty: 'static',
  severity: 'warning',
  description:
    'Laut Wiki können nach einem Spielfehler mehrere Einfahr-Blocksignale gleichzeitig grün werden, wenn der Block frei wird. Kreuzen sich die Wege, kollidieren die Züge. Empfehlung: an Zusammenführungen und eingleisigen Zweirichtungsabschnitten Pfadsignale verwenden („path in, block out“).',
  sources: [SIGNALS],
});

export const RAIL_PATH_NOT_LEVEL = defineRule({
  id: 'RAIL-011',
  title: 'Pfadblock nicht eben',
  domain: 'rail',
  kind: 'recommendation',
  certainty: 'static',
  severity: 'warning',
  description:
    'Laut Wiki teilen Pfadsignale Blöcke nach einem Spielfehler nicht richtig auf, wenn die Gleise darin nicht eben sind. Züge mit sich kreuzenden Wegen könnten dann gleichzeitig einfahren.',
  sources: [SIGNALS],
});

export const RAIL_RADIUS = defineRule({
  id: 'RAIL-012',
  title: 'Kurvenradius unter 17 m',
  domain: 'rail',
  kind: 'game-rule',
  certainty: 'static',
  severity: 'warning',
  description:
    'Laut Wiki beträgt der kleinste Kurvenradius 17 m (gemessen an der Gleismitte einer 90°-Kurve). Engere Kurven sind im Spiel nicht baubar. Der Planer misst den Radius an der Bezierkurve; das ist eine Näherung.',
  sources: [RAILWAY],
});

export const RAIL_SEGMENT_LENGTH = defineRule({
  id: 'RAIL-013',
  title: 'Segmentlänge außerhalb 12–100 m',
  domain: 'rail',
  kind: 'game-rule',
  certainty: 'static',
  severity: 'warning',
  description: 'Ein einzelnes Gleissegment ist im Spiel 12 bis 100 m lang. Längere Strecken bestehen aus mehreren Segmenten.',
  sources: [RAILWAY],
});

export const RAIL_NO_SIGNALS = defineRule({
  id: 'RAIL-014',
  title: 'Mehrere Züge ohne Signale',
  domain: 'rail',
  kind: 'game-rule',
  certainty: 'static',
  severity: 'warning',
  description: 'Laut Wiki sind Signale nötig, damit zwei oder mehr Züge dieselben Gleise ohne Zusammenstöße nutzen können.',
  sources: [SIGNALS],
});

export const RAIL_SHORT_EXIT_BLOCK = defineRule({
  id: 'RAIL-020',
  title: 'Block hinter einem Pfadblock ist kürzer als der Zug',
  domain: 'rail',
  kind: 'recommendation',
  certainty: 'dynamic',
  severity: 'warning',
  description:
    'Ein Pfadsignal lässt einen Zug nur einfahren, wenn der Block hinter der Ausfahrt frei ist. Ist dieser Block kürzer als der Zug und muss der Zug dort halten, ragt sein Ende in die Kreuzung zurück und blockiert andere Wege. Ob das eintritt, hängt von Fahrplan und Belegung ab.',
  sources: [SIGNALS],
});

export const RAIL_TRAIN_LONGER_THAN_STATION = defineRule({
  id: 'RAIL-021',
  title: 'Zug länger als der Bahnhof',
  domain: 'rail',
  kind: 'recommendation',
  certainty: 'dynamic',
  severity: 'warning',
  description:
    'Der Zug ist länger als Bahnhof und Bahnsteige zusammen. Wagen hinter dem letzten Bahnsteig werden nicht be- oder entladen, und das Zugende kann beim Halt den vorherigen Block oder eine Weiche belegen.',
  sources: [STATION, PLATFORM],
});

export const RAIL_WAGON_PLATFORM = defineRule({
  id: 'RAIL-022',
  title: 'Wagen ohne passenden Bahnsteig',
  domain: 'rail',
  kind: 'recommendation',
  certainty: 'static',
  severity: 'info',
  description:
    'Jeder Wagen steht beim Halt an der Position des entsprechenden Bahnsteigs (Lok am Bahnhofsgebäude, Wagen dahinter). Ein Wagen an einem leeren Bahnsteig, an einem Bahnsteig der falschen Art oder hinter dem letzten Bahnsteig wird hier nicht umgeschlagen.',
  sources: [STATION, PLATFORM],
});

export const RAIL_BIDIRECTIONAL_LOOP = defineRule({
  id: 'RAIL-023',
  title: 'Zweirichtungszug in einem Netz mit Wendemöglichkeit',
  domain: 'rail',
  kind: 'recommendation',
  certainty: 'dynamic',
  severity: 'warning',
  description:
    'Laut Wiki kann ein Zweirichtungszug seine Fahrtrichtung über eine Schleife umkehren. Dann stehen die Wagen an den Bahnhöfen in umgekehrter Reihenfolge und falsche Waren werden umgeschlagen.',
  sources: [STATION],
});

export const RAIL_TRACTION = defineRule({
  id: 'RAIL-025',
  title: 'Zu wenige Loks für Steigung und Zuglast',
  domain: 'rail',
  kind: 'recommendation',
  certainty: 'dynamic',
  severity: 'warning',
  description:
    'Laut Wiki zieht eine Lok (300 t) auf einer 1-m-Rampe (12,5 %) einen Zug von höchstens 1644 t, auf einer 2-m-Rampe (25 %) 800 t und auf einer 4-m-Rampe (50 %) 580 t, ohne stark langsamer zu werden. Ein voll beladener Wagen wiegt 100 t, ein leerer 30 t. Geprüft wird der voll beladene Zug auf der steilsten Steigung seiner Fahrwege. Annahme: Mehrere Loks ziehen zusammen entsprechend mehr.',
  sources: [FREIGHT_CAR, LOCOMOTIVE],
});

/** Ab so vielen Pfadblöcken direkt hintereinander auf einem Fahrweg meldet RAIL-026. */
export const PATH_CHAIN_LIMIT = 3;

export const RAIL_PATH_CHAIN = defineRule({
  id: 'RAIL-026',
  title: 'Viele Pfadsignale hintereinander',
  domain: 'rail',
  kind: 'recommendation',
  certainty: 'dynamic',
  severity: 'warning',
  description:
    'Ein Pfadsignal lässt einen Zug erst einfahren, wenn sein ganzer Weg durch die folgenden Pfadblöcke bis in einen Block hinter einem Blocksignal frei ist („path in, block out“). Folgen mehrere Pfadsignale direkt aufeinander, reserviert der Zug die ganze Kette auf einmal: Er wartet länger auf freie Fahrt und hält die Strecke lange für andere Züge belegt. Empfehlung: Pfadsignale nur vor Weichen und Kreuzungen, dazwischen Blocksignale mit mindestens einer Zuglänge Abstand. Der Planer meldet Ketten ab drei Pfadblöcken auf dem Fahrweg eines Zuges.',
  sources: [SIGNALS],
});

export const RAIL_DEADLOCK_UNCHECKED = defineRule({
  id: 'RAIL-024',
  title: 'Deadlocks statisch nicht ausschließbar',
  domain: 'rail',
  kind: 'unchecked',
  certainty: 'dynamic',
  severity: 'info',
  description:
    'Die statische Prüfung erkennt Fehler in Signalaufbau und Erreichbarkeit. Ob sich Züge gegenseitig blockieren, hängt von Zuglängen, Abfahrtszeiten, Wartebedingungen und Belegung ab. Die Prüfung schließt Deadlocks deshalb nicht aus.',
  sources: [{ label: 'Grenze der statischen Prüfung' }],
});
