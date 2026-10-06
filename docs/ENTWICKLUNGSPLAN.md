# Entwicklungsplan

Eine Etappe gilt erst als abgeschlossen, wenn die Funktion **in der Oberfläche bedienbar** ist und ihre **Kernaussagen durch automatisierte Tests geprüft** sind: Vitest für Core-Logik, Playwright für Abläufe in der Oberfläche.

Status: ✅ fertig · 🔶 in Arbeit · ⬜ offen

## Etappe 1 – Architektur, Datenmodell, Spielregeln ✅

**Lieferumfang:** [ARCHITEKTUR.md](ARCHITEKTUR.md), [DATENMODELL.md](DATENMODELL.md), [SPIELREGELN.md](SPIELREGELN.md), [SPIELDATEN.md](SPIELDATEN.md), Spieldaten-Extraktor und Datensatz `sf-1.2.4.0`.

**Abnahmekriterien**
- [x] Module, Stack mit Begründung (inkl. Canvas/WebGL), Ordnerstruktur und Datenfluss sind dokumentiert.
- [x] Das Projektschema ist als zod-Schema umgesetzt; alle Objekte haben stabile IDs, Verbindungen verweisen auf konkrete Anschlüsse.
- [x] Spieldaten stammen aus den offiziellen Docs von Version 1.2.4.0; Quelle, Version, Prüfsumme und Lizenzlage sind dokumentiert.
- [x] Fehlende oder unsichere Daten (Anschlusslagen, weiche Kollisionsboxen) sind gekennzeichnet.
- [x] Signalmechaniken sind mit Quellen belegt, und der Regelkatalog trennt Spielregel / Empfehlung / nicht geprüft sowie statisch / möglich.
- [x] Test: Grundrisse aus Spieldaten (Konstruktor 8 × 10 × 6 m), Anschlusszahlen.

## Etappe 2 – Lauffähiges Grundgerüst ✅

**Lieferumfang:** Web-App mit dreiteiligem Layout, Canvas-Grundrisseditor, IndexedDB-Autosave, Import/Export, Undo/Redo, Befundliste.

**Abnahmekriterien**
- [x] Neues Projekt anlegen; Projektliste mit Öffnen, Export und Löschen.
- [x] Editor: Raster in Spielmaßen, Zoom (Mausrad, +/−), Ansicht verschieben (Leertaste/rechte/mittlere Maustaste), Fangen einstellbar, Alt = frei.
- [x] Gebäude aus dem Katalog (mit Suche) platzieren, verschieben, drehen (R), kopieren (Strg+C/V, Strg+D), Mehrfachauswahl (Umschalt, Rahmen), löschen.
- [x] Undo/Redo für alle Änderungen (Strg+Z / Strg+Y).
- [x] Autosave in IndexedDB; Projekt ist nach Neuladen wieder vorhanden. *(E2E-Test)*
- [x] Export als versioniertes JSON, Import mit Formatmigration, Schemaprüfung und Referenzbereinigung. *(Unit- und E2E-Test)*
- [x] Kollisionsprüfung mit Befund (Objekt, Schwere, Erklärung, Vorschlag, Regel). *(Unit- und E2E-Test)*
- [x] Prüfmotor berechnet nur geänderte Fabriken neu. *(Unit-Test)*

## Etappe 3 – Schieneneditor mit Signalen und Prüfregeln ✅

**Abnahmekriterien**
- [x] Mehrere Schienennetze anlegen, umbenennen, löschen und zusammenführen. *(Unit-Test: Zusammenführen, Löschen mit Verweisbereinigung)*
- [x] Gleise zeichnen: gerade und gekrümmte Segmente (Bezier, tangential an Knoten, Kreisbogen-Näherung), Abzweigungen/Weichen (Klick auf Gleis teilt es), Schleifen, Doppelgleise („Parallelgleis erzeugen“), Höhe je Knoten. *(Unit-Tests: Bogenradius, Teilen erhält Form)*
- [x] Geometrische Kreuzungen werden erkannt, von Gleisverbindungen unterschieden und mit Höhe bewertet (gleiche Höhe = gemeinsamer Block, Überführung nicht). *(Unit-Test)*
- [x] Block- und Pfadsignale an Knoten setzen, Typ wechseln, umdrehen; Bahnhöfe mit Bahnsteigen und Richtung. *(E2E)*
- [x] Blockbildung wird angezeigt (Einfärbung) und in den Eigenschaften erläutert.
- [x] Prüfregeln RAIL-001 … RAIL-014, RAIL-020 … RAIL-024 mit Befund (Objekt, Schwere, Erklärung, Vorschlag, Regel); Neuprüfung nur des geänderten Netzes. *(Unit-Tests je Regel, E2E für Befundanzeige)*
- [x] Züge (Loks vorwärts/rückwärts, Fest-/Flüssigwagen) und Fahrpläne (Wartezeit, Bedingung, Umschlag); Erreichbarkeit der Halte mit Ursachendiagnose (Signalrückseite, Bahnhofsrichtung, fehlende Wendemöglichkeit, fehlende Verbindung). *(Unit- und E2E-Test)*

**Vereinfachungen / bekannte Grenzen**
- Signale stehen an Gleisknoten. Freies Setzen auf einem Segment entspricht im Spiel dem Teilen des Segments; im Editor zuerst das Gleis teilen.
- Bahnhofsgrundfläche (16 × 34 m je Einheit) aus Spieldaten; die Lage des Gleises innerhalb der 34 m Breite ist schematisch mittig.
- RAIL-020 vergleicht mit dem längsten Zug des Netzes, nicht routenbezogen.
- Kreuzungsschwelle 1 m Höhenunterschied ist eine dokumentierte Annahme (Gleis-Hitbox in 1.2 verkleinert, Wert unbekannt).

## Etappe 4 – Produktionsberechnung ✅

**Abnahmekriterien**
- [x] Zielprodukte und Mengen pro Minute vorgeben; LP-Lösung (YALPS) mit Rohstoffen, Vorprodukten, Rezeptwahl (Alternativrezepte freischalten, Standardrezepte abwählen), Maschinen (exakt und als „n × Takt“), Leistung, Nebenprodukten/Überschüssen und Transportbedarf (kleinste Band-/Rohrstufe bzw. Anzahl paralleler Leitungen). *(Unit-Tests)*
- [x] Modus „Maximieren“ mit begrenzten Rohstoffen und Option „nur vorhandene Maschinen“ (inkl. Somersloop-Varianten). *(Unit-Tests)*
- [x] Kreisläufe (Recycelter Gummi ↔ Recycelter Kunststoff) und Mehrfachausgaben (Treibstoff + Polymerharz) werden korrekt gelöst. *(Unit-Tests mit Massenbilanz je Gegenstand)*
- [x] Nicht erreichbare Ziele: Fehlmengen statt Abbruch, Ursache „fehlende Quelle“ (rückverfolgt) bzw. „Engpass“ (Versorgung/Maschinen ausgeschöpft); Befunde PROD-001 … PROD-004. *(Unit- und E2E-Test)*
- [x] „Maschinen in Fabrik anlegen“ erzeugt nicht platzierte Maschinen (vorhandene werden angerechnet, Takt optional angeglichen); Abgleich Soll → Geplant → Platziert → Angeschlossen. *(Unit- und E2E-Test)*

**Vereinfachungen / bekannte Grenzen**
- Rohstoffgewichtung 1000 / weltweites Maximum (Wiki); Wasser kostenlos und unbegrenzt.
- Gewinnung (Miner, Reinheit) und Stromerzeugung (Generatoren, Brennstoffe) sind noch nicht als Maschinen modelliert; Rohstoffe erscheinen als Versorgung.
- Somersloops fließen nur im Modus „nur vorhandene Maschinen“ ein.
- „Angeschlossen“ zählt verbundene Anschlüsse, nicht den tatsächlichen Durchsatz der Bänder (folgt in Etappe 5).

## Verbesserungen nach Etappe 4 ✅

Rückmeldung zu Etappe 1–4, umgesetzt vor Etappe 5:

- [x] **Geführtes Tutorial:** Einführung und Touren für Fabrikgrundriss, Produktion, Schienennetz, Transport; interaktive Schritte gehen automatisch weiter; Begrüßung beim ersten Start; Hilfemenü „?“ und F1. *(E2E)*
- [x] **Eigene Tastenbelegung:** alle Aktionen in Einstellungen → Tastenkürzel änderbar, mehrere Tasten je Aktion, Konfliktanzeige, Zurücksetzen; im Browser gespeichert. *(E2E)*
- [x] **Hell/Dunkel:** Farbschema System/Dunkel/Hell für Oberfläche und Zeichenflächen. *(E2E)*
- [x] **Sprache:** Deutsch und Englisch für Oberfläche, Prüfmeldungen, Regeln, Fehlermeldungen und Spieldatennamen. *(Unit-Test: jeder Text übersetzt, Platzhalter erhalten; E2E)*
- [x] **Befunde je Reiter:** Jede Ansicht zeigt nur ihre Befunde (aktive Fabrik, Pläne der Fabrik, aktives Netz, Transport); Umschalter „Alle Bereiche“; Fehler-/Warnungszahlen an den Reitern. *(E2E)*
- [x] **Fabrik:** Bänder und Rohre auch vom Eingang zum Ausgang zeichnen (Speicherung in Flussrichtung); Fangraster bis 0,5 m mit Auswahl in der Werkzeugleiste; Verlegemodi Normal/Gerade (rechtwinklig)/Kurve (Taste N); Förderrichtung als Pfeile, optional animiert. *(Unit- und E2E-Tests)*
- [x] **Produktion:** Diagramm der Produktionskette (Schichten Rohstoff → Endprodukt, Kantenbreite nach Menge, Kreisläufe gestrichelt); Sortierung alphabetisch, Rohstoff → Endprodukt, umgekehrt, nach Durchsatz. *(Unit- und E2E-Tests)*
- [x] **Schiene:** Signale auch auf freiem Gleis (Segment wird geteilt, Mindestabstand 12 m zum Segmentende); Signaldarstellung mit Haltelinie, Mast und Pfeil in Fahrtrichtung, geschützter Block wird hervorgehoben; animierte Züge über die Simulation (Etappe 7). *(Unit- und E2E-Tests)*

## Etappe 5 – Maßstabsgetreue Fabrikplanung (Ausbau) ✅

**Abnahmekriterien**
- [x] Durchsatz je Verbindung aus den angeschlossenen Maschinen: lineares Programm über die eingezeichneten Verbindungen (Maschinen mit Auslastung, Ausgänge müssen abfließen, Splitter/Zusammenführungen/Rohrkreuzungen/Lager mit Mengenerhalt). Zwei Läufe: ohne Kapazitätsgrenzen (theoretischer Bedarf) und mit den gezeichneten Stufen. *(Unit-Tests)*
- [x] Kapazitätsprüfung gegen die Bandstufe (FAB-011), Unterversorgung mit Ursache (FAB-012), nicht abgeführte Produkte (FAB-013), falscher Gegenstand am Ziel (FAB-014), Annahmen offengelegt (FAB-015). Anzeige im Grundriss (überlastete Leitungen rot, Durchsatz an der Leitung, Auslastung auf dem Gebäude). *(Unit-Tests)*
- [x] Gewinnung: Miner, Öl-, Wasser- und Quellenextraktoren mit Rohstoff und Reinheit; Förderrate aus Docs-Zykluszeit × Reinheit × Takt. *(Unit-Test)*
- [x] Stockwerkübergreifend: Seitenansicht (Blick von Süden bzw. Osten) über alle Ebenen mit Gebäudehöhen und Leitungsverlauf; Lifte durch Stockwerke (FAB-017), Höhenwechsel ohne Lift (FAB-018), Rohrsteigung (FAB-016, nicht geprüft). *(Unit-Test)*
- [x] Gebäudegruppen bearbeiten: Instanz als Vorlage übernehmen, andere Instanzen angleichen (gleiche Lage/Drehung), Gebäude in eine Instanz aufnehmen, Instanz lösen, umbenennen. *(Unit-Test)*
- [x] Raster-/Fundamentausrichtung: Auf Fundamentflächen richtet sich das Fangraster nach der Fundamentecke.
- [x] Abgleich Produktionsplan ↔ Grundriss um „Durchsatz“ erweitert; Test der ganzen Kette Plan → Maschinen anlegen → platzieren → anschließen → Durchsatz. *(Unit- und E2E-Test)*

**Vereinfachungen / bekannte Grenzen**
- Splitter verteilen im Modell bestmöglich, im Spiel gleichmäßig mit Überlauf; Filter intelligenter Splitter werden nicht berücksichtigt.
- Rohre fließen in Zeichenrichtung; Druck, Förderhöhe und Pumpen werden nicht berechnet (nur Hinweis).
- Kraftwerke nehmen Brennstoff ab, ihr Verbrauch ist nicht modelliert (Brennstoffdaten noch nicht extrahiert).
- Produkte werden den Ausgängen in Rezeptreihenfolge zugeordnet; die Anschlusslage bleibt schematisch.
- Kurvenradien, Steigungen und Kollisionen von Bändern werden nicht geprüft.

## Etappe 6 – Fabriken, Produktion und Transport verbinden ✅

**Abnahmekriterien**
- [x] Bahnhöfe Fabriken zuordnen; Transportaufträge zwischen Fabriken (Ansicht „Transport“) mit Lade-/Entladebahnhof und Zügen. *(Unit- und E2E-Test)*
- [x] Frachtplattformen im Grundriss als Schnittstelle: entladende Plattformen liefern die Auftragsmengen ins Durchsatzmodell, beladende nehmen ab. *(Unit-Test)*
- [x] Lokaler Verbrauch vs. externe Lieferung: Bilanz je Fabrik mit Erzeugung, Verbrauch, Ein- und Ausfuhr und Importbedarf der Produktionspläne; Fabrikbilanz mit Ein-/Ausfuhrspalten. *(Unit-Test)*
- [x] Durchsatzschätzung je Zug: Kapazität (Wagen × 32 Stapel × Stapelgröße bzw. 2400 m³) / Umlaufzeit (Strecke / Ø-Geschwindigkeit + Umschlag + Wartezeit); Annahmen editierbar und offengelegt; gemessene Umlaufzeit aus der Simulation oder manueller Wert ersetzen die Schätzung; Kennzeichnung als Schätzung. *(Unit-Test)*
- [x] Befunde TRN-001 … TRN-009: kein Zug, Fahrplan ohne Lade-/Entladebahnhof, Kapazität (Schätzung), Bahnhof der falschen Fabrik, Importlücke, Lieferfabrik erzeugt zu wenig, falscher Wagentyp, Schätzungshinweis, fehlende Frachtplattform. *(Unit-Tests)*

**Vereinfachungen / bekannte Grenzen**
- Mehrere Aufträge auf einem Zug teilen die Kapazität im Verhältnis ihrer Mengen.
- Wartezeiten an Signalen fließen nur über die Simulation ein; die Schätzung kennt sie nicht.
- Ladebedingungen („vollständig beladen“) werden weder geschätzt noch simuliert.

## Etappe 7 – Simulation, Konten, Onlinebetrieb ✅

**Abnahmekriterien**
- [x] Vereinfachte Zugsimulation: konstante Durchschnittsgeschwindigkeit, Blocksignale, Pfadreservierung „path in, block out“, Halte mit Umschlagzeit, Zweirichtungszüge; Ereignisse (Warten, kein Weg, Deadlock als zyklisches Warten, Kollision ohne Signale); Animation im Schieneneditor, Auswertung „+1 h“, Kennzahlen je Zug; Annahmen sichtbar; ausdrücklich kein Beweis der Deadlockfreiheit. *(Unit-Tests: Umlaufzeit, Kollision, Deadlock, kein Deadlock bei genug Blöcken, kein Weg; E2E)*
- [x] Server (Fastify + PostgreSQL + Drizzle) mit Konten (scrypt), Sitzungscookie, serverseitigen Projekten mit Revisionen, schreibgeschützten Freigabelinks (widerrufbar). *(API-Tests gegen PGlite; E2E: registrieren, speichern, Link öffnen, schreibgeschützt, Kopie übernehmen)*
- [x] Datenbankmigrationen versioniert (`apps/server/drizzle/`, Anwendung beim Start); Deployment-Dokumentation, Dockerfile, docker-compose; Zugangsdaten nur über Umgebungsvariablen (`.env.example`). *(Test: Konfiguration verlangt alle Variablen)*
- [x] Spieldaten-Migration zwischen Datensätzen: Trockenlauf mit Bericht, Umbenennungstabelle, Anwenden mit Rückgängig. *(Unit-Test mit verändertem Datensatz)*

**Vereinfachungen / bekannte Grenzen**
- Simulation ohne Beschleunigung, Steigung, Bremsweg; Züge starten am ersten freien Halt; Ladebedingungen nicht simuliert.
- Das Docker-Image wurde mangels Docker auf dem Entwicklungsrechner nicht gebaut; der Server ist mit `npm start` und PGlite bzw. PostgreSQL getestet.
- Keine E-Mail-Bestätigung und kein Zurücksetzen vergessener Passwörter; Anmeldebegrenzung nur im Speicher eines Prozesses.
- Projekte im Konto werden manuell gespeichert („Im Konto speichern“), nicht automatisch synchronisiert; bei gleichzeitigen Änderungen meldet der Server einen Konflikt.
- Es ist nur ein Spieldatensatz (1.2.4.0) enthalten; der Datensatzwechsel ist daher nur mit Testdaten geprüft.
