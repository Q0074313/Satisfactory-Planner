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
  /** Ausführliche Erklärung für Einsteiger (Einstellung „ausführliche Erklärungen“). */
  detail?: string;
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
        detail: N_(
          'Du musst nichts vorher wissen. Ein Projekt ist deine ganze Planung: mehrere Fabriken, ein oder mehrere Schienennetze, Züge und Lieferungen zwischen den Fabriken. Du kannst nichts kaputt machen – jede Änderung lässt sich mit Strg+Z rückgängig machen. Mit „Weiter“ gehst du zum nächsten Schritt, mit „Beenden“ hörst du jederzeit auf.',
        ),
      },
      {
        title: N_('Vier Ansichten'),
        body: N_(
          'Oben wechselst du zwischen Fabrikgrundriss, Produktion, Schienennetz und Transport. Alle Ansichten arbeiten auf denselben Daten: Eine Maschine aus dem Produktionsplan ist dieselbe, die du im Grundriss platzierst. Die Zahlen an den Reitern zeigen Fehler und Warnungen der jeweiligen Ansicht.',
        ),
        detail: N_(
          'Ein typischer Ablauf: Zuerst rechnest du unter „Produktion“ aus, was du bauen willst, z. B. 10 Modulare Rahmen pro Minute. Der Planer sagt dir, welche Maschinen du brauchst. Diese Maschinen stellst du dann unter „Fabrikgrundriss“ auf und verbindest sie mit Förderbändern. Unter „Schienennetz“ planst du Gleise und Züge, unter „Transport“ was zwischen Fabriken geliefert wird. Rote Zahlen an einem Reiter bedeuten Fehler, gelbe Warnungen.',
        ),
        target: '[data-tour="modes"]',
      },
      {
        title: N_('Werkzeuge und Katalog'),
        body: N_('Links stehen Werkzeuge, Stockwerke, noch nicht platzierte Maschinen und der Gebäudekatalog mit Suche. Die Taste neben einem Werkzeug ist sein Tastenkürzel.'),
        detail: N_(
          '„Auswahl“ ist das normale Werkzeug zum Anklicken und Verschieben. „Messen“ misst Abstände, „Baufläche“ und „Fundament“ zeichnen Flächen. Im Katalog findest du alle Gebäude des Spiels, z. B. Schmelzofen oder Konstruktor. Tippe einfach einen Namen in die Suche. Wenn du ein Rezept wie „Eisenplatte“ suchst, schlägt der Planer gleich das passende Gebäude mit Rezept vor.',
        ),
        target: '[data-tour="left-panel"]',
        mode: 'factory',
      },
      {
        title: N_('Zeichenfläche'),
        body: N_(
          'In der Mitte liegt der maßstabsgetreue Grundriss (1 Raster = 8 m, wie ein Fundament). Mausrad zoomt, rechte oder mittlere Maustaste bzw. Leertaste + Ziehen verschiebt die Ansicht, Pos1 passt sie ein.',
        ),
        detail: N_(
          'Maßstabsgetreu heißt: Ein Konstruktor ist hier genau so groß wie im Spiel (8 × 10 m). Ein Rasterquadrat entspricht einem Fundament von 8 × 8 m. Hast du dich verirrt, drück Pos1 – dann siehst du wieder alles. Unten links steht immer, wo der Mauszeiger gerade ist (x und y in Metern).',
        ),
        target: '[data-tour="factory-canvas"]',
        mode: 'factory',
      },
      {
        title: N_('Raster und Ansicht'),
        body: N_('Hier stellst du das Fangraster ein (bis 0,5 m) und wechselst zur Seitenansicht über alle Stockwerke. Beim Förderband-Werkzeug erscheinen hier auch der Verlegemodus (Normal, Gerade, Kurve) und die Stufe Mk.1 bis Mk.6.'),
        detail: N_(
          'Das Fangraster sorgt dafür, dass Gebäude sauber ausgerichtet einrasten, z. B. alle 1 m. Mit gedrückter Alt-Taste setzt du ein Gebäude ohne Raster. Die Seitenansicht („Seite x“ bzw. „Seite y“) zeigt die Fabrik von der Seite, wie einen Schnitt durch ein Haus. Dort siehst du die Höhen und kannst Gebäude auch nach oben oder unten schieben.',
        ),
        target: '[data-tour="editor-toolbar"]',
        mode: 'factory',
      },
      {
        title: N_('Eigenschaften'),
        body: N_('Rechts bearbeitest du das gewählte Objekt: Rezept, Takt, Rohstoff eines Miners, Bandstufe, Verlegemodus und mehr. Ohne Auswahl stehen hier Fabrik- und Rastereinstellungen.'),
        detail: N_(
          'Klicke z. B. einen Schmelzofen an. Rechts kannst du dann das Rezept wählen (was er herstellen soll) und den Takt einstellen (100 % = normale Geschwindigkeit). Bei einem Miner wählst du, welches Erz er abbaut und wie rein das Vorkommen ist. Alles, was du hier änderst, rechnet der Planer sofort neu.',
        ),
        target: '[data-tour="properties"]',
        mode: 'factory',
      },
      {
        title: N_('Befunde und Bilanz'),
        body: N_(
          'Unten zeigt der Planer Befunde der aktuellen Ansicht – jeweils mit Erklärung, Vorschlag und Regelquelle – sowie Bilanz und Flächen. Ein Klick auf einen Befund springt zum betroffenen Objekt.',
        ),
        detail: N_(
          'Ein Befund ist ein Hinweis auf ein Problem, zum Beispiel: „Zwei Gebäude überschneiden sich“ oder „Das Band ist zu langsam“. Jeder Befund erklärt in einfachen Worten, was los ist, und schlägt eine Lösung vor. Unter „Regel“ steht, woher die Spielregel stammt. Du kannst einen Befund auch als „bekannt“ markieren, wenn er dich nicht stört.',
        ),
        target: '[data-tour="bottom"]',
        mode: 'factory',
      },
      {
        title: N_('Etwas stimmt nicht?'),
        body: N_(
          'Läuft etwas nicht, obwohl keine Befunde angezeigt werden, hilft „🩺 Etwas stimmt nicht?“: erst eine erweiterte Prüfung mit allen Hinweisen, dann die geführte Suche („Maschine steht“, „Gegenstand kommt nicht an“), die den Fluss bis zur Ursache zurückverfolgt.',
        ),
        detail: N_(
          'Wähle die Maschine, die nicht läuft, oder den Gegenstand, der fehlt. Der Planer geht dann Schritt für Schritt rückwärts: Kommt genug an? Ist ein Band voll? Läuft die Maschine davor selbst nicht voll – und warum? Ein Klick auf eine Zeile zeigt das Objekt im Grundriss. Am Ende stehen Ursachen, die der Planer nicht prüfen kann, etwa ein falsch angeschlossenes Band im Spiel.',
        ),
        target: '[data-testid="diagnose-open"]',
        mode: 'factory',
      },
      {
        title: N_('Speichern, Hilfe, Einstellungen'),
        body: N_(
          'Das Projekt wird automatisch im Browser gespeichert. Export und Import sichern es als JSON-Datei. Über „?“ startest du weitere Führungen, über ⚙ stellst du Sprache, Hell/Dunkel und die Tastenbelegung ein.',
        ),
        detail: N_(
          'Du musst nie selbst speichern – der Planer sichert jede Änderung nach kurzer Zeit. Arbeitest du mit einem Projekt-Link vom Server, kannst du das Projekt auf jedem Gerät mit diesem Link öffnen. Die Adresszeile zeigt den Link nicht, damit ihn z. B. bei einem Stream niemand abschreiben kann: Kopiere ihn über „🔗 Link“ → „Kopieren“ und hebe ihn gut auf (Lesezeichen)! Für Streams gibt es in den Einstellungen den Streamer-Modus, der den Link auch in der Oberfläche verdeckt. Über „Exportieren“ bekommst du eine Datei als Sicherheitskopie.',
        ),
        target: '[data-tour="topbar-actions"]',
      },
      {
        title: N_('Fertig'),
        body: N_('Weitere Führungen zu Fabrikgrundriss, Produktion, Schienennetz und Transport findest du jederzeit im Hilfemenü (?) oben rechts oder mit F1. Dort kannst du auch ein Beispielprojekt öffnen und selbst ausprobieren.'),
        detail: N_(
          'Tipp für den Anfang: Starte mit der Führung „Produktion“. Rechne dort ein kleines Ziel aus, z. B. 30 Eisenplatten pro Minute, übernimm die Maschinen in die Fabrik und stelle sie danach in der Führung „Fabrikgrundriss“ auf.',
        ),
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
        detail: N_(
          'Ein Konstruktor ist die einfachste Maschine im Spiel: Er macht aus einem Gegenstand einen anderen, z. B. aus Eisenbarren Eisenplatten. Klicke links in das Suchfeld, schreibe „Konstruktor“ und klicke dann auf den Eintrag in der Liste. Das Gebäude „hängt“ danach als halb durchsichtige Vorschau am Mauszeiger.',
        ),
        target: '[data-tour="catalog-search"]',
        mode: 'factory',
        until: ({ ui }) => ui.tool.kind === 'place',
      },
      {
        title: N_('Platzieren'),
        body: N_('Klicke in den Grundriss, um das Gebäude abzusetzen. R dreht, Alt platziert ohne Raster, Esc beendet das Werkzeug. Beim Verschieben zeigt der Planer Abstände zu den Nachbarn.'),
        detail: N_(
          'Bewege die Maus in die große Fläche in der Mitte und klicke einmal. Das Gebäude steht dann dort. Das kleine Dreieck zeigt die Vorderseite mit den Ausgängen. Möchtest du es drehen, drück vorher R. Möchtest du mehrere Gebäude aufstellen, klicke einfach mehrmals. Mit Esc legst du das Werkzeug weg.',
        ),
        target: '[data-tour="factory-canvas"]',
        mode: 'factory',
        until: ({ p, base }) => counts(p).buildings > base.buildings,
      },
      {
        title: N_('Förderband zeichnen'),
        body: N_('Wähle das Förderband-Werkzeug. Freie Anschlüsse werden hervorgehoben: grün = Eingang, orange = Ausgang. Du kannst beim Ausgang oder beim Eingang beginnen.'),
        detail: N_(
          'Förderbänder transportieren feste Gegenstände von einer Maschine zur nächsten. Jede Maschine hat Eingänge (grün, dort kommt Material hinein) und Ausgänge (orange, dort kommt das Produkt heraus). Ein Band verbindet immer einen Ausgang mit einem Eingang. Ein pinkfarbener Eingang an LKW- und Tanklaster-Stationen ist nur für Treibstoff.',
        ),
        target: '[data-tour="tool-belt"]',
        mode: 'factory',
        until: ({ ui }) => ui.tool.kind === 'link',
      },
      {
        title: N_('Verbinden'),
        body: N_(
          'Klicke einen Anschluss an, setze bei Bedarf Zwischenpunkte und klicke den Gegenanschluss. B erneut drücken wechselt den Verlegemodus (Normal, Gerade, Kurve), N die Stufe (Mk). Die Auswahl bleibt für das nächste Band erhalten. Pfeile auf dem Band zeigen die Förderrichtung. Ohne zweites Gebäude: Schritt überspringen.',
        ),
        detail: N_(
          'So geht es Schritt für Schritt: 1. Klicke auf den orangen Ausgang des ersten Gebäudes. 2. Klicke, wenn du willst, ein paar Punkte in die Fläche, über die das Band laufen soll. 3. Klicke auf den grünen Eingang des zweiten Gebäudes – fertig. Die Stufe Mk.1 bis Mk.6 bestimmt, wie viel das Band schafft (Mk.1: 60 pro Minute, Mk.6: 1200). Höhere Stufen sind im Plan dicker und farbiger gezeichnet.',
        ),
        target: '[data-tour="factory-canvas"]',
        mode: 'factory',
        until: ({ p, base }) => counts(p).links > base.links,
      },
      {
        title: N_('Durchsatz'),
        body: N_(
          'Der Planer berechnet, was über die gezeichneten Bänder fließt und wie weit die Maschinen dadurch laufen. Überlastete Bänder werden rot, die Auslastung steht auf den Gebäuden. Die Bilanz unten vergleicht geplant, platziert und tatsächlich erreicht. Was in einen AWESOME-Schredder fließt, gilt als abgeführt, zählt aber als Überschuss („davon Schredder“).',
        ),
        detail: N_(
          'Beispiel: Ein Schmelzofen schafft 30 Eisenbarren pro Minute. Hängt er an einem Mk.1-Band (60 pro Minute), passt alles. Laufen aber vier Öfen auf ein Mk.1-Band, kommen 120 pro Minute zusammen, und das Band wird rot. Dann brauchst du ein schnelleres Band oder ein zweites. Die Prozentzahl auf einer Maschine zeigt, wie viel sie wirklich arbeiten kann. Übrig gebliebene Produkte kannst du in einen AWESOME-Schredder leiten: Dann staut sich nichts, und die Bilanz zeigt dir trotzdem, wie viel du übrig hast – vielleicht braucht es eine andere Fabrik.',
        ),
        target: '[data-tour="bottom"]',
        mode: 'factory',
      },
      {
        title: N_('Stockwerke und Seitenansicht'),
        body: N_('Mit „+ Ebene“ (18 m) bzw. „+ Logistik“ (6 m) legst du Stockwerke an, Bild↑/Bild↓ wechselt sie. Zeichnest du ein Band über Stockwerke, entsteht ein Lift. Die Seitenansicht zeigt alle Ebenen, Gebäudehöhen und Lifte. Dort setzt „Pumpe aufs Rohr setzen“ eine Pipeline-Pumpe direkt in ein Rohr.'),
        detail: N_(
          'Große Fabriken baut man im Spiel oft in mehreren Etagen. Eine Produktionsebene ist hier standardmäßig 18 m hoch, eine Logistikebene für Bänder 6 m, dazwischen liegt eine Decke von 2 m. Die Liste zeigt den Bereich jeder Ebene, z. B. „0 m – 18 m“. Du kannst die Höhen jederzeit rechts ändern. Rohre haben eine begrenzte Förderhöhe: Steigt ein Rohr zu hoch, meldet der Planer, dass du eine Pumpe brauchst. Wechsle dann in die Seitenansicht („Seite x“ oder „Seite y“), wähle oben links eine Pumpe und klicke auf das Rohr: Die Pumpe wird in Flussrichtung eingesetzt, auf einem senkrechten Rohrstück auch senkrecht. Ein gelbes Kreuz markiert die Stelle, ab der die Förderhöhe nicht mehr reicht; dort rastet die Pumpe ein.',
        ),
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
        detail: N_(
          'Ein Produktionsplan ist wie ein Rezeptrechner: Du sagst, was am Ende herauskommen soll, und der Planer rechnet rückwärts aus, welche Zwischenprodukte, Maschinen und Rohstoffe du brauchst. Klicke auf das „+“ neben „Produktionspläne“.',
        ),
        target: '[data-tour="add-plan"]',
        mode: 'production',
        until: ({ p, base }) => counts(p).plans > base.plans,
      },
      {
        title: N_('Ziel festlegen'),
        body: N_('Gib im Feld „Zielprodukt hinzufügen“ z. B. „Modularer Rahmen“ ein und lege die Menge pro Minute fest. Die Berechnung löst auch Kreisläufe und Nebenprodukte.'),
        detail: N_(
          'Schreibe z. B. „Eisenplatte“ in das Feld und wähle den Eintrag aus. Trage dann eine Menge ein, z. B. 30 (pro Minute). Der Planer rechnet sofort: Für 30 Eisenplatten brauchst du 45 Eisenbarren, dafür 45 Eisenerz und die passenden Maschinen.',
        ),
        target: '.production-grid',
        mode: 'production',
        until: ({ p, base }) => counts(p).targets > base.targets,
      },
      {
        title: N_('Ergebnis lesen'),
        body: N_(
          'Das Ergebnis zeigt Rezepte, Maschinenzahl, Takt, Leistung, die Mengenbilanz und den Transportbedarf. Über „Diagramm“ siehst du die Kette grafisch; die Sortierung ordnet Gegenstände z. B. von Rohstoff zu Endprodukt.',
        ),
        detail: N_(
          '„2 × 75 %“ bedeutet: zwei Maschinen, die jeweils mit drei Vierteln der normalen Geschwindigkeit laufen. Unter „Leistung“ steht, wie viel Strom alles zusammen braucht (in MW). Das Diagramm zeigt die Produktionskette von links (Rohstoffe) nach rechts (Endprodukt).',
        ),
        target: '[data-testid="result-banner"]',
        mode: 'production',
      },
      {
        title: N_('Strom erzeugen'),
        body: N_(
          'Unter „Kraftwerke“ gibst du an, welche Kraftwerke mit welchem Brennstoff du bauen willst und wie viele. Der Plan berechnet dann Brennstoff und Wasser wie jede andere Zulieferung; Atommüll erscheint als Überschuss. Den Strombedarf der Maschinen rechnet der Plan nicht gegen.',
        ),
        detail: N_(
          'Beispiel: 16 Kohlegeneratoren mit Kohle brauchen 240 Kohle und 720 m³ Wasser pro Minute und liefern 1200 MW. Wählst du verdichtete Kohle oder Treibstoff, plant der Solver auch deren Herstellung. Im Grundriss wählst du beim Kraftwerk den Brennstoff wie ein Rezept; dann rechnet auch das Durchsatzmodell mit seinem Verbrauch.',
        ),
        target: '[data-testid="power-add"]',
        mode: 'production',
      },
      {
        title: N_('Alternativrezepte vorschlagen'),
        body: N_(
          '„Alternativrezepte vorschlagen“ zeigt Alternativen, die Rohstoffe sparen – einzeln und zusammen, mit der Änderung je Rohstoff. „übernehmen“ schaltet sie im Plan frei.',
        ),
        detail: N_(
          'Alternativrezepte schaltest du im Spiel über Festplatten frei. Der Planer rechnet für jede Alternative, wie viel Rohstoff sie spart (gewichtet nach Seltenheit). So siehst du, welche Festplatte sich für deinen Plan lohnt.',
        ),
        target: '[data-tour="production-left"]',
        mode: 'production',
      },
      {
        title: N_('Maschinen in die Fabrik übernehmen'),
        body: N_('„Maschinen in Fabrik anlegen“ erzeugt die Maschinen als noch nicht platziert. Im Grundriss findest du sie links unter „Nicht platziert“. Der Abgleich zeigt Soll, Geplant, Platziert, Angeschlossen und Durchsatz.'),
        detail: N_(
          'Nach dem Klick sind die Maschinen „geplant“, aber noch nirgends aufgestellt. Wechsle in den Fabrikgrundriss: Links unter „Nicht platziert“ stehen sie bereit. Ein Klick darauf hängt die Maschine an den Mauszeiger, ein Klick in den Grundriss stellt sie auf.',
        ),
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
        detail: N_(
          'Ein Schienennetz ist eine zusammenhängende Gleisanlage mit Bahnhöfen, Signalen und Zügen. Für den Anfang reicht ein Netz.',
        ),
        target: '[data-tour="add-network"]',
        mode: 'rail',
        until: ({ p, base }) => counts(p).networks > base.networks || counts(p).networks > 0,
      },
      {
        title: N_('Gleise zeichnen'),
        body: N_('Wähle „Gleis“ (G) und klicke Punkte in die Fläche; vom zweiten Punkt an entstehen tangentiale Bögen. Das Mausrad dreht die Richtung am Gleisende in 15°-Stufen zum Raster. Punkte rasten im Gleisraster (oben links: 4 m oder 1 m). Klick auf ein Gleis teilt es für eine Weiche. Esc beendet den Gleiszug.'),
        detail: N_(
          'Klicke einmal in die Fläche (Startpunkt) und dann ein Stück weiter (Endpunkt) – schon liegt ein gerades Gleis. Klickst du danach weiter, geht das Gleis vom Ende aus weiter, auch in einer Kurve. Ein Gleis endet nie spitz in sich selbst: Auch für eine Kehre läuft der Bogen vom Gleisende nach vorn weiter. Halte Umschalt gedrückt für eine gerade Verlängerung. Wie im Spiel ist ein Gleisstück mindestens 12 m und höchstens 100 m lang, und Kurven brauchen mindestens 17 m Radius; die Vorschau wird sonst rot. Das 4-m-Raster trifft im Fundamentraster Ecken, Kantenmitten und Mitten der Fundamente – so liegen Gleise leicht mittig über einer Fundamentreihe. Mehrere Gleise wählst du mit einem Rahmen aus und ziehst sie gemeinsam an eine neue Stelle.',
        ),
        target: '[data-tour="rail-tools"]',
        mode: 'rail',
        until: ({ p, base }) => counts(p).segments >= base.segments + 2,
      },
      {
        title: N_('Bahnhof setzen'),
        body: N_('Mit „Bahnhof“ (S) setzt du einen Bahnhof; der Pfeil zeigt die Richtung, in der Züge halten. Auf einen freien Gleisknoten geklickt, schließt er direkt an.'),
        detail: N_(
          'Ein Bahnhof besteht aus dem Bahnhofsgebäude (dort hält die Lok) und Bahnsteigen dahinter (dort stehen die Wagen und werden be- oder entladen). Züge halten nur, wenn sie in Pfeilrichtung einfahren. R dreht den Bahnhof vor dem Absetzen.',
        ),
        target: '[data-tour="rail-canvas"]',
        mode: 'rail',
        until: ({ p, base }) => counts(p).stations > base.stations,
      },
      {
        title: N_('Signale setzen'),
        body: N_(
          'Block- (B) und Pfadsignale (P) setzt du auf ein Gleis oder an einen Knoten. Die Seite, auf die du klickst, bestimmt die Fahrtrichtung: Das Signal steht rechts neben dem Gleis, der Pfeil zeigt die Fahrt, die Querlinie die Haltestelle.',
        ),
        detail: N_(
          'Signale teilen das Netz in Abschnitte („Blöcke“), damit mehrere Züge fahren können, ohne zusammenzustoßen. Du musst nicht genau auf das Gleis treffen – bis 3 m daneben reicht. Auf freiem Gleis rastet das Signal in 1-m-Schritten. Ein Signal gilt nur für eine Fahrtrichtung; für Gegenverkehr auf demselben Gleis brauchst du ein zweites Signal in die andere Richtung.',
        ),
        target: '[data-tour="rail-canvas"]',
        mode: 'rail',
      },
      {
        title: N_('Blocksignal oder Pfadsignal?'),
        body: N_(
          'Blocksignal (grün, B): lässt einen Zug erst in den nächsten Block, wenn dieser ganz frei ist – für freie Strecken. Pfadsignal (lila, P): lässt einen Zug in einen belegten Block, solange sein eigener Weg frei ist – für Weichen und Kreuzungen. Merksatz: „Pfad hinein, Block hinaus“.',
        ),
        detail: N_(
          'Blocksignal: Teilt eine lange Strecke in Abschnitte, damit Züge hintereinander fahren können. Im Block dahinter darf immer nur ein Zug sein. Abstand mindestens eine Zuglänge, sonst passt ein wartender Zug nicht hinein. Pfadsignal: Steht vor einer Weiche oder Kreuzung. Zwei Züge dürfen den Bereich gleichzeitig befahren, wenn sich ihre Wege nicht kreuzen. Ein Zug fährt aber nur ein, wenn er hinter der Weiche ganz in einen freien Block passt – deshalb steht nach der Weiche ein Blocksignal. Setze nicht viele Pfadsignale hintereinander: Der Zug reserviert dann die ganze Kette auf einmal, wartet lange und blockiert die Strecke (Befund RAIL-026). Alle Einfahrten in einen Block brauchen denselben Signaltyp.',
        ),
        target: '[data-tour="rail-canvas"]',
        mode: 'rail',
      },
      {
        title: N_('Züge und Fahrpläne'),
        body: N_('Lege Fahrpläne mit Halten und Züge mit Loks und Wagen an. Der Planer prüft statisch, ob jeder Halt erreichbar ist, und nennt die Ursache, wenn nicht.'),
        detail: N_(
          'Ein Zug besteht aus mindestens einer Lok und Wagen. Der Fahrplan legt fest, welche Bahnhöfe der Zug der Reihe nach anfährt. Pro Halt kannst du einstellen, ob alles oder nur bestimmte Gegenstände umgeschlagen werden. Beim Zug zeigt der Planer, ob die Loks für die steilste Steigung reichen und wie lang der Zug höchstens sein darf. Reichen sie nicht, ergänzt „fehlende Loks vorn ergänzen“ weitere Loks hinter der ersten; mit ◀ ▶ ordnest du Loks und Wagen um. Eine rückwärts gerichtete Lok am Ende macht den Zug zum Zweirichtungszug.',
        ),
        target: '[data-tour="add-train"]',
        mode: 'rail',
      },
      {
        title: N_('Simulation'),
        body: N_(
          '„Züge fahren lassen“ (T) animiert die Züge mit Blockbelegung, Pfadreservierung und Halten. Wartezeiten, Umlaufzeiten und erkannte Deadlocks erscheinen hier. Die Annahmen stehen darunter – ein Lauf ohne Deadlock ist kein Beweis.',
        ),
        detail: N_(
          'Die Simulation ist ein Probelauf: Die Züge fahren ihre Fahrpläne ab, warten an roten Signalen und halten an Bahnhöfen. Gibt es mehr Züge als Bahnhöfe, starten die übrigen an einer zufälligen freien Stelle im Netz. Bleiben Züge gegenseitig stecken (Deadlock), meldet die Simulation das.',
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
        body: N_('Ein Auftrag beschreibt, welche Fabrik wie viel an welche andere liefert – per Zug, Fahrzeug (Lkw, Schlepper, Tanklaster), Drohne, Förderband oder Rohr. Lege mit + einen Auftrag an (dafür sind zwei Fabriken nötig).'),
        detail: N_(
          'Beispiel: Fabrik „Erz“ liefert 240 Eisenerz pro Minute an Fabrik „Stahl“. Liegen die Fabriken nah beieinander, reicht oft ein Förderband: Ein Mk.3-Band schafft 270 pro Minute. Für weite Strecken nimmst du Züge oder Lkw. Dafür brauchst du mindestens zwei Fabriken im Projekt.',
        ),
        target: '[data-tour="add-order"]',
        mode: 'transport',
      },
      {
        title: N_('Transportmittel wählen und schätzen'),
        body: N_(
          'Rechts wählst du das Transportmittel. Bei Zügen ordnest du Bahnhöfe und Züge zu, bei Fahrzeugen Typ, Anzahl und Strecke, bei Bändern und Rohren Stufe, Anzahl Leitungen und die Anschlüsse in beiden Fabriken. Der Planer schätzt den Durchsatz aus Laderaum und Umlaufzeit bzw. rechnet die Leitungskapazität aus. Gemessene Werte aus der Simulation ersetzen die Zugschätzung.',
        ),
        detail: N_(
          'Der Planer schätzt, wie viel ein Zug oder Lkw pro Minute schafft: Ladung pro Fahrt geteilt durch die Zeit für eine Runde. Reicht das nicht, siehst du einen Befund. Wichtig: Der Zug muss am Lade- und am Entladebahnhof halten und dort den Gegenstand auch umschlagen. Lkw brauchen in beiden Fabriken eine Lkw-Station (bei Flüssigkeiten eine Tanklaster-Station) mit „Beladen“ bzw. „Entladen“. Drohnen fliegen zwischen Drohnenhäfen; sie tanken am Hafen des Absenders, und der Planer zeigt, wie viele Batterien (oder andere Brennstoffe) sie pro Minute verbrauchen. Ein Förderband oder Rohr zwischen zwei Fabriken beginnt an einem Ausgang der einen und endet an einem Eingang der anderen Fabrik.',
        ),
        target: '[data-tour="transport-left"]',
        mode: 'transport',
      },
      {
        title: N_('Lokal und extern'),
        body: N_('Die Bilanz je Fabrik zeigt Erzeugung, Verbrauch, Ein- und Ausfuhr und den Importbedarf der Produktionspläne. Lücken erscheinen zusätzlich als Befunde.'),
        detail: N_(
          'Hier siehst du auf einen Blick, ob jede Fabrik genug bekommt. Fehlt etwas, steht dort, wie viel – und ob ein Transportauftrag die Lücke schließt.',
        ),
        target: '[data-testid="trade-table"]',
        mode: 'transport',
      },
    ],
  },
  {
    id: 'map',
    title: N_('Karte'),
    steps: [
      {
        title: N_('Die Weltkarte'),
        body: N_(
          'Die Karte zeigt die Spielwelt mit allen Rohstoffvorkommen: Ring = Rohstoff, Punkt in der Mitte = Reinheit (rot unrein, orange normal, grün rein). Mausrad zoomt, rechte Maustaste verschiebt. Ein Klick auf ein Vorkommen zeigt rechts, wie viel jeder Miner dort fördert.',
        ),
        detail: N_(
          'Lage und Reinheit der Vorkommen stammen von satisfactory-calculator.com, ebenso das Kartenbild. Quellen (Stickstoff, Wasser, Öl) bestehen aus mehreren Satelliten um eine Mitte; Geysire sind Dreiecke. Belegte Vorkommen tragen einen Haken.',
        ),
        target: '[data-tour="map-canvas"]',
        mode: 'map',
      },
      {
        title: N_('Kartenbild und Filter'),
        body: N_('Links wählst du Spielkarte oder realistische Ansicht und blendest Rohstoffe, Reinheiten und Ebenen ein oder aus.'),
        target: '[data-tour="map-left"]',
        mode: 'map',
      },
      {
        title: N_('Fabrik auf die Karte setzen'),
        body: N_(
          'Klicke bei einer Fabrik auf „Platzieren“ und dann auf die Karte. Danach kannst du sie ziehen und mit R drehen. Als Grundriss dienen die Bau- und Fundamentflächen der Fabrik.',
        ),
        detail: N_(
          'Mit Standort zeigt der Fabrikgrundriss das Kartenbild und die Vorkommen darunter. Setzt du dort einen Miner auf ein Vorkommen, rastet er ein und übernimmt Rohstoff und Reinheit. Transportaufträge zwischen platzierten Fabriken kennen die Luftlinie, und Schienennetze zeichnest du direkt über der Karte.',
        ),
        target: '[data-testid="map-factories"]',
        mode: 'map',
        until: ({ p }) => !!p && Object.values(p.factories).some((f) => f.map),
      },
      {
        title: N_('Standortvorschlag'),
        body: N_(
          'Wähle einen Produktionsplan und „Standorte suchen“: Der Planer sucht Orte, an denen freie Vorkommen den Rohstoffbedarf möglichst nah beieinander decken. Mit „Fabrik hier platzieren“ übernimmst du einen Vorschlag.',
        ),
        target: '[data-testid="site-run"]',
        mode: 'map',
      },
    ],
  },
];
