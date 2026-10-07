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

## Etappe 8 – Betrieb auf dem Heimserver ✅

Ersetzt Konten, PostgreSQL und Freigabelinks aus Etappe 7 durch Projekt-Links ohne Login (Stand vorher: Git-Commit „Stand vor dem Umbau“).

**Abnahmekriterien**
- [x] Jedes Projekt bekommt beim Anlegen eine zufällige ID (128 Bit, base64url) und ist unter `/f/<id>` erreichbar; keine Übersicht aller Projekte. *(API- und E2E-Tests)*
- [x] API `POST /api/factory`, `GET`/`PUT /api/factory/:id`, `/api/health`; Server liefert `dist/` mit SPA-Fallback. *(API-Tests)*
- [x] Eine JSON-Datei pro Projekt, atomar geschrieben (tmp + fsync + rename), Sperre je ID; Konflikterkennung zwischen Geräten über Revisionen (409 + Rückfrage). *(API-Test mit 20 parallelen Speichervorgängen; E2E mit zwei Browser-Kontexten)*
- [x] Größenlimit, Gesamtzahl, Rate-Limit pro IP (Anlegen 10/h), ID-Prüfung gegen Path Traversal, JSON-Prüfung, Sicherheitsköpfe. *(API-Tests)*
- [x] `formatVersion` und Migration beim Laden vom Server; v1-Fixture wird als v2 geladen und so gespeichert. *(API-Test, E2E: lokales v1-Projekt hochladen)*
- [x] Lokale IndexedDB-Projekte werden zum Hochladen angeboten; Projekt-Link mit „Kopieren“ und Lesezeichen-Hinweis sichtbar. *(E2E)*
- [x] Docker Compose (nicht root, read-only, Port nur auf 127.0.0.1), `update.sh` mit Sicherung, Health-Check; README und CLAUDE.md.

**Vereinfachungen / bekannte Grenzen**
- Wer den Link hat, kann das Projekt bearbeiten; es gibt keinen schreibgeschützten Link und kein Löschen über die Oberfläche (Datei auf dem Server löschen).
- Rate-Limit nur im Speicher des Prozesses (nach Neustart zurückgesetzt).
- Keine Live-Synchronisation: Ein anderes Gerät sieht Änderungen nach dem Neuladen; gleichzeitige Änderungen führen zu einer Rückfrage.

## Version 0.3 – Rückmeldung nach Etappe 8 ✅

Umgesetzt aus „zukünftige Pläne bzw. Änderungen“ (Abschnitt „nächste Version“; die Ideen sind bewusst noch offen).

**Schienennetz**
- [x] Signale lassen sich per Klick auf Pfeil oder Mast auswählen; Zeichnung und Trefferprüfung nutzen dieselbe Geometrie (vorher traf ein Klick den Knoten darunter). *(E2E)*
- [x] Mehr Züge als Bahnhöfe: Züge ohne freien Halt starten an einer zufälligen freien Stelle (kein Bahnhofsgleis, möglichst freier Block, erster Halt erreichbar); je Zug reproduzierbar. *(Unit-Test)*
- [x] Züge mit Abstand in Hintergrundfarbe, heller Kontur, dunklem Mittelstreifen, Wagengrenzen und Pfeilspitze; neue Züge bekommen Farben, die sich von Netz- und Blockfarben abheben.
- [x] Fahrpläne: „nur bestimmte Gegenstände“ mit Suchfeld, Auswahl als Chips, Vorschlägen aus Transportaufträgen und Filter nach Bahnsteigart; Transportschätzung und Befund TRN-010 berücksichtigen die Auswahl. *(Unit- und E2E-Test)*
- [x] Keine spitzen Rückläufe beim Gleisbau: Vom Gleisende aus geht es auf der freien Seite weiter, auch für eine Kehre; Zusammenführungen bleiben möglich. *(Unit-Test)*
- [x] Signale auf freiem Gleis rasten in 1-m-Schritten (Alt: stufenlos); Anzeige der Abstände zu beiden Segmentenden. *(Unit-Test)*
- [x] Fangbereich des Signalwerkzeugs bis 3 m neben dem Gleis.
- [x] Zugkraft und Zuglänge: Masse, steilste Steigung der Fahrwege, nötige Loks, volle Wagen je Lok und Maximallänge am kürzesten Bahnhof; Befund RAIL-025. *(Unit-Test)*
- [x] Wegwahl wie im Spiel: kürzester Weg, Aufschlag nur für fremde Bahnhöfe in Fahrtrichtung, bei Gleichstand weniger Gleisteile, dann links vor rechts. *(Unit-Tests)*

**Fabrikplanung**
- [x] LKW- und Tanklaster-Station: Treibstoffeingang farbig (pink) und in der Anschlussliste benannt. *(Unit-Test)*
- [x] Weltraumlift: je drei Eingänge auf gegenüberliegenden Seiten. *(Unit-Test)*
- [x] Förderband-/Rohrwerkzeug: erneutes B bzw. P wechselt den Verlegemodus, N die Stufe (Mk.1–Mk.6 bzw. Mk.1–Mk.2); Auswahl bleibt bis zur Änderung gespeichert. *(E2E)*
- [x] Stockwerke: neue Produktionsebene 18 m, Logistikebene 6 m, 2 m Decke dazwischen; Liste zeigt den Bereich (z. B. „0 m – 18 m“); Höhen bleiben frei änderbar. *(Unit- und E2E-Test)*
- [x] Förderhöhe von Flüssigkeiten: erreichbare Höhe je Rohr aus Quelle bzw. Pumpe, Weitergabe über Rohrkreuzungen und Ventile; Befund FAB-019, Anzeige an der Leitung. *(Unit-Test)*
- [x] Pipeline-Pumpen senkrecht (▲/▼) einbaubar (Taste O, Eigenschaften); in den Seitenansichten x und y lassen sich Gebäude seitlich und in der Höhe verschieben. *(Unit-Test)*
- [x] Stufen optisch unterscheidbar: Bänder Mk.1–Mk.6 mit eigener Farbe und Breite, Rohr Mk.2 breiter mit Mittellinie; Stufe an der Leitung beschriftet.
- [x] Animation der Förderrichtung korrigiert: Pfeile wandern jetzt in Förderrichtung.

**Transport zwischen Fabriken**
- [x] Transportaufträge per Zug, Fahrzeug (Schlepper, Lkw, Tanklaster, Explorer), Förderband oder Rohr; Fahrzeugdaten aus den Docs bzw. Wiki im Datensatz. *(Unit-Test)*
- [x] Fahrzeuge: Typ, Anzahl, Strecke, Geschwindigkeit; Schätzung aus Laderaum und Umlauf (2 × 8 s Andocken); Lkw- und Tanklaster-Stationen mit Be-/Entladen als Übergabe im Durchsatzmodell. *(Unit- und E2E-Test)*
- [x] Direkte Bänder und Rohre: Stufe, parallele Leitungen, Länge, Übergabeanschluss in beiden Fabriken; im Durchsatzmodell beider Fabriken wirksam, im Grundriss als Stummel „→ Fabrik“ dargestellt; Anschlüsse werden beim Löschen bzw. Fabrikwechsel gelöst. *(Unit- und E2E-Test)*
- [x] Befunde TRN-011 … TRN-015 (falsches Transportmittel, kein Fahrzeug, Fahrzeugkapazität, Leitung zu klein, keine Übergabe). *(Unit-Tests)*

**Allgemein**
- [x] Softwareversion (package.json, Commit, Build-Datum) in Kopfzeile, Startseite, Hilfemenü und Einstellungen; im Docker-Build über `GIT_COMMIT` (setzt `update.sh`). *(E2E)*
- [x] Tutorial-Schalter „ausführliche Erklärungen für Einsteiger“ (Hilfemenü, Einstellungen, Begrüßung, in jeder Tour umschaltbar): zu jedem Schritt eine Erklärung in einfacher Sprache mit Beispiel. *(E2E)*

**Vereinfachungen / bekannte Grenzen**
- Zugkraft: Grenzwerte nur für die drei Rampenklassen der Wiki-Tabelle; Steigungen dazwischen werden der nächststeileren Klasse zugeordnet. Mehrere Loks werden linear addiert (Annahme).
- Förderhöhe mit empfohlenen Wiki-Werten (vorsichtig); unbekannte Quellen (z. B. Kraftwerke, Konverter) melden weiterhin nur FAB-016. Druck und Durchfluss werden nicht simuliert.
- Lage des Treibstoffeingangs schematisch (erster Bandeingang); die Docs enthalten keine Anschlusspositionen.
- Wegwahl: Bogenlängen sind Näherungen; Längenunterschiede unter 5 cm gelten als gleich.
- Fahrzeuge: keine Wegplanung und keine Simulation; Strecke und Durchschnittsgeschwindigkeit sind Angaben des Nutzers. Treibstoffverbrauch wird nicht geschätzt.
- Direkte Leitungen: Förderhöhe zwischen Fabriken und Baubarkeit der Strecke werden nicht geprüft.
