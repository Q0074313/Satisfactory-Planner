/**
 * Geführte Touren durch die Oberfläche. Texte sind deutsch und werden über
 * t() übersetzt. Schritte mit `until` gehen automatisch weiter, sobald die
 * Aufgabe erledigt ist (z. B. ein Gebäude platziert wurde).
 */
import type { Project } from '@satis/core';
import { N_ } from '../../i18n';
import type { Mode } from '../../state/uiStore';
import { useUiStore } from '../../state/uiStore';

type Ui = ReturnType<typeof useUiStore.getState>;

export interface Counts {
  buildings: number;
  links: number;
  plans: number;
  targets: number;
  networks: number;
  segments: number;
  stations: number;
  signals: number;
  trains: number;
  orders: number;
}

export function counts(p: Project | null): Counts {
  const v = (o: object | undefined) => (o ? Object.keys(o).length : 0);
  return {
    buildings: v(p?.buildings),
    links: v(p?.links),
    plans: v(p?.productionPlans),
    targets: p ? Object.values(p.productionPlans).reduce((s, x) => s + x.targets.length, 0) : 0,
    networks: v(p?.railNetworks),
    segments: v(p?.railSegments),
    stations: v(p?.stations),
    signals: v(p?.railSignals),
    trains: v(p?.trains),
    orders: v(p?.transportOrders),
  };
}

export interface TourStep {
  title: string;
  body: string;
  /** CSS-Selektor des hervorgehobenen Elements; ohne = Fenstermitte. */
  target?: string;
  /** Ansicht, die beim Schritt aktiv sein soll. */
  mode?: Mode;
  /** Aufgabe: Schritt gilt als erledigt, sobald die Bedingung erfüllt ist. */
  until?: (s: { p: Project | null; ui: Ui; base: Counts }) => boolean;
}

export interface Tour {
  id: string;
  title: string;
  steps: TourStep[];
}

export const TOURS: Tour[] = [
  {
    id: 'intro',
    title: N_('Einführung'),
    steps: [
      {
        title: N_('Willkommen beim Satis Planner'),
        body: N_(
          'Der Planer verbindet Produktionsberechnung, maßstabsgetreue Fabrikgrundrisse und Schienennetze in einem Projekt. Alle Maße, Rezepte und Mengen stammen aus den Spieldaten von Satisfactory. Diese Einführung zeigt in wenigen Schritten, wo was zu finden ist.',
        ),
      },
      {
        title: N_('Vier Ansichten'),
        body: N_(
          'Oben wechselst du zwischen Fabrikgrundriss, Produktion, Schienennetz und Transport. Alle Ansichten arbeiten auf denselben Daten: Eine Maschine aus dem Produktionsplan ist dieselbe, die du im Grundriss platzierst. Die Zahlen an den Reitern zeigen Fehler und Warnungen der jeweiligen Ansicht.',
        ),
        target: '[data-tour="modes"]',
      },
      {
        title: N_('Werkzeuge und Katalog'),
        body: N_('Links stehen Werkzeuge, Stockwerke, noch nicht platzierte Maschinen und der Gebäudekatalog mit Suche. Die Taste neben einem Werkzeug ist sein Tastenkürzel.'),
        target: '[data-tour="left-panel"]',
        mode: 'factory',
      },
      {
        title: N_('Zeichenfläche'),
        body: N_(
          'In der Mitte liegt der maßstabsgetreue Grundriss (1 Raster = 8 m, wie ein Fundament). Mausrad zoomt, rechte oder mittlere Maustaste bzw. Leertaste + Ziehen verschiebt die Ansicht, Pos1 passt sie ein.',
        ),
        target: '[data-tour="factory-canvas"]',
        mode: 'factory',
      },
      {
        title: N_('Raster und Ansicht'),
        body: N_('Hier stellst du das Fangraster ein (bis 0,5 m) und wechselst zur Seitenansicht über alle Stockwerke. Beim Förderband-Werkzeug erscheint hier auch der Verlegemodus Normal, Gerade oder Kurve.'),
        target: '[data-tour="editor-toolbar"]',
        mode: 'factory',
      },
      {
        title: N_('Eigenschaften'),
        body: N_('Rechts bearbeitest du das gewählte Objekt: Rezept, Takt, Rohstoff eines Miners, Bandstufe, Verlegemodus und mehr. Ohne Auswahl stehen hier Fabrik- und Rastereinstellungen.'),
        target: '[data-tour="properties"]',
        mode: 'factory',
      },
      {
        title: N_('Befunde und Bilanz'),
        body: N_(
          'Unten zeigt der Planer Befunde der aktuellen Ansicht – jeweils mit Erklärung, Vorschlag und Regelquelle – sowie Bilanz und Flächen. Ein Klick auf einen Befund springt zum betroffenen Objekt.',
        ),
        target: '[data-tour="bottom"]',
        mode: 'factory',
      },
      {
        title: N_('Speichern, Hilfe, Einstellungen'),
        body: N_(
          'Das Projekt wird automatisch im Browser gespeichert. Export und Import sichern es als JSON-Datei. Über „?“ startest du weitere Führungen, über ⚙ stellst du Sprache, Hell/Dunkel und die Tastenbelegung ein.',
        ),
        target: '[data-tour="topbar-actions"]',
      },
      {
        title: N_('Fertig'),
        body: N_('Weitere Führungen zu Fabrikgrundriss, Produktion, Schienennetz und Transport findest du jederzeit im Hilfemenü (?) oben rechts oder mit F1.'),
      },
    ],
  },
  {
    id: 'factory',
    title: N_('Fabrikgrundriss'),
    steps: [
      {
        title: N_('Gebäude suchen'),
        body: N_('Tippe „Konstruktor“ in die Katalogsuche und klicke den Eintrag an – oder wähle direkt ein Rezept wie „Eisenplatte“. Danach hängt das Gebäude am Mauszeiger.'),
        target: '[data-tour="catalog-search"]',
        mode: 'factory',
        until: ({ ui }) => ui.tool.kind === 'place',
      },
      {
        title: N_('Platzieren'),
        body: N_('Klicke in den Grundriss, um das Gebäude abzusetzen. R dreht, Alt platziert ohne Raster, Esc beendet das Werkzeug. Beim Verschieben zeigt der Planer Abstände zu den Nachbarn.'),
        target: '[data-tour="factory-canvas"]',
        mode: 'factory',
        until: ({ p, base }) => counts(p).buildings > base.buildings,
      },
      {
        title: N_('Förderband zeichnen'),
        body: N_('Wähle das Förderband-Werkzeug. Freie Anschlüsse werden hervorgehoben: grün = Eingang, orange = Ausgang. Du kannst beim Ausgang oder beim Eingang beginnen.'),
        target: '[data-tour="tool-belt"]',
        mode: 'factory',
        until: ({ ui }) => ui.tool.kind === 'link',
      },
      {
        title: N_('Verbinden'),
        body: N_(
          'Klicke einen Anschluss an, setze bei Bedarf Zwischenpunkte und klicke den Gegenanschluss. N wechselt den Verlegemodus (Normal, Gerade, Kurve). Pfeile auf dem Band zeigen die Förderrichtung. Ohne zweites Gebäude: Schritt überspringen.',
        ),
        target: '[data-tour="factory-canvas"]',
        mode: 'factory',
        until: ({ p, base }) => counts(p).links > base.links,
      },
      {
        title: N_('Durchsatz'),
        body: N_(
          'Der Planer berechnet, was über die gezeichneten Bänder fließt und wie weit die Maschinen dadurch laufen. Überlastete Bänder werden rot, die Auslastung steht auf den Gebäuden. Die Bilanz unten vergleicht geplant, platziert und tatsächlich erreicht.',
        ),
        target: '[data-tour="bottom"]',
        mode: 'factory',
      },
      {
        title: N_('Stockwerke und Seitenansicht'),
        body: N_('Mit + legst du Stockwerke an, Bild↑/Bild↓ wechselt sie. Zeichnest du ein Band über Stockwerke, entsteht ein Lift. Die Seitenansicht zeigt alle Ebenen, Gebäudehöhen und Lifte.'),
        target: '[data-tour="floors"]',
        mode: 'factory',
      },
    ],
  },
  {
    id: 'production',
    title: N_('Produktion'),
    steps: [
      {
        title: N_('Produktionsplan anlegen'),
        body: N_('Ein Plan berechnet, welche Maschinen und Rohstoffe für ein Ziel nötig sind. Lege mit + einen Plan an.'),
        target: '[data-tour="add-plan"]',
        mode: 'production',
        until: ({ p, base }) => counts(p).plans > base.plans,
      },
      {
        title: N_('Ziel festlegen'),
        body: N_('Gib im Feld „Zielprodukt hinzufügen“ z. B. „Modularer Rahmen“ ein und lege die Menge pro Minute fest. Die Berechnung löst auch Kreisläufe und Nebenprodukte.'),
        target: '.production-grid',
        mode: 'production',
        until: ({ p, base }) => counts(p).targets > base.targets,
      },
      {
        title: N_('Ergebnis lesen'),
        body: N_(
          'Das Ergebnis zeigt Rezepte, Maschinenzahl, Takt, Leistung, die Mengenbilanz und den Transportbedarf. Über „Diagramm“ siehst du die Kette grafisch; die Sortierung ordnet Gegenstände z. B. von Rohstoff zu Endprodukt.',
        ),
        target: '[data-testid="result-banner"]',
        mode: 'production',
      },
      {
        title: N_('Maschinen in die Fabrik übernehmen'),
        body: N_('„Maschinen in Fabrik anlegen“ erzeugt die Maschinen als noch nicht platziert. Im Grundriss findest du sie links unter „Nicht platziert“. Der Abgleich zeigt Soll, Geplant, Platziert, Angeschlossen und Durchsatz.'),
        target: '[data-testid="balance-table"]',
        mode: 'production',
      },
    ],
  },
  {
    id: 'rail',
    title: N_('Schienennetz'),
    steps: [
      {
        title: N_('Netz anlegen'),
        body: N_('Lege mit + ein Schienennetz an. Mehrere Netze lassen sich später zusammenführen.'),
        target: '[data-tour="add-network"]',
        mode: 'rail',
        until: ({ p, base }) => counts(p).networks > base.networks || counts(p).networks > 0,
      },
      {
        title: N_('Gleise zeichnen'),
        body: N_('Wähle „Gleis“ (G) und klicke Punkte in die Fläche; vom zweiten Punkt an entstehen tangentiale Bögen. Klick auf ein Gleis teilt es für eine Weiche. Esc beendet den Gleiszug.'),
        target: '[data-tour="rail-tools"]',
        mode: 'rail',
        until: ({ p, base }) => counts(p).segments >= base.segments + 2,
      },
      {
        title: N_('Bahnhof setzen'),
        body: N_('Mit „Bahnhof“ (S) setzt du einen Bahnhof; der Pfeil zeigt die Richtung, in der Züge halten. Auf einen freien Gleisknoten geklickt, schließt er direkt an.'),
        target: '[data-tour="rail-canvas"]',
        mode: 'rail',
        until: ({ p, base }) => counts(p).stations > base.stations,
      },
      {
        title: N_('Signale'),
        body: N_(
          'Block- (B) und Pfadsignale (P) setzt du auf ein Gleis oder an einen Knoten. Die Seite, auf die du klickst, bestimmt die Fahrtrichtung: Das Signal steht rechts neben dem Gleis, der Pfeil zeigt die Fahrt, die Querlinie die Haltestelle.',
        ),
        target: '[data-tour="rail-canvas"]',
        mode: 'rail',
      },
      {
        title: N_('Züge und Fahrpläne'),
        body: N_('Lege Fahrpläne mit Halten und Züge mit Loks und Wagen an. Der Planer prüft statisch, ob jeder Halt erreichbar ist, und nennt die Ursache, wenn nicht.'),
        target: '[data-tour="add-train"]',
        mode: 'rail',
      },
      {
        title: N_('Simulation'),
        body: N_(
          '„Züge fahren lassen“ (T) animiert die Züge mit Blockbelegung, Pfadreservierung und Halten. Wartezeiten, Umlaufzeiten und erkannte Deadlocks erscheinen hier. Die Annahmen stehen darunter – ein Lauf ohne Deadlock ist kein Beweis.',
        ),
        target: '[data-tour="sim-controls"]',
        mode: 'rail',
      },
    ],
  },
  {
    id: 'transport',
    title: N_('Transport'),
    steps: [
      {
        title: N_('Transportaufträge'),
        body: N_('Ein Auftrag beschreibt, welche Fabrik wie viel an welche andere liefert. Lege mit + einen Auftrag an (dafür sind zwei Fabriken nötig).'),
        target: '[data-tour="add-order"]',
        mode: 'transport',
      },
      {
        title: N_('Züge zuordnen und schätzen'),
        body: N_(
          'Rechts ordnest du Bahnhöfe und Züge zu. Der Planer schätzt den Durchsatz aus Wagenkapazität und Umlaufzeit. Die Annahmen dafür (Geschwindigkeit, Umschlagzeit) stehen links und sind änderbar; gemessene Werte aus der Simulation ersetzen die Schätzung.',
        ),
        target: '[data-tour="transport-left"]',
        mode: 'transport',
      },
      {
        title: N_('Lokal und extern'),
        body: N_('Die Bilanz je Fabrik zeigt Erzeugung, Verbrauch, Ein- und Ausfuhr und den Importbedarf der Produktionspläne. Lücken erscheinen zusätzlich als Befunde.'),
        target: '[data-testid="trade-table"]',
        mode: 'transport',
      },
    ],
  },
];
