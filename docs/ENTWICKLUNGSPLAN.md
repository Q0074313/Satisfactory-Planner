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

## Version 0.4 – Feinschliff und Bedienung ✅

Umgesetzt aus „zukünftige Pläne bzw. Änderungen“ (erster Teil des Abschnitts „nächste Version“; Berechnungen folgen in 0.5).

**Allgemein**
- [x] Standardsprache Englisch (unabhängig von der Browsersprache); Sprachauswahl auch in der Begrüßung.
- [x] Projekt-Link nicht mehr in der Adresszeile: Die Adresse bleibt „/“, die ID steht im Verlauf und für Neuladen im sessionStorage des Tabs; Zurück/Vor zwischen Projekten funktioniert weiter. Streamer-Modus (Einstellungen) verdeckt den Link auch in der Leiste, Kopieren geht weiter. *(E2E)*
- [x] Hinweis auf die Entwicklung mit KI-Unterstützung und mögliche Fehler (Einstellungen → Allgemein, Hilfemenü).
- [x] Beschriftungen bleiben innerhalb von Gebäuden und Flächen (Schrift wird verkleinert, notfalls mit „…“ gekürzt; Zeilen nur, soweit sie in die Höhe passen).
- [x] Übersetzungen: neue Texte übersetzt, veraltete Einträge entfernt. *(Abdeckungstests)*
- [x] Tutorial: neue Funktionen aufgenommen; eigener Schritt „Blocksignal oder Pfadsignal?“ mit Erklärung, wann welches Signal passt.

**Fabrikplanung**
- [x] Deutlichere Farben: Band Mk.1 grau statt gelblich, Rohr Mk.1 türkis statt hellblau; ausgewählte Leitungen mit breitem Saum, ausgewählte Gebäude mit leuchtendem Rand.
- [x] Pumpe in der Seitenansicht direkt aufs Rohr setzen: Leitung wird geteilt, Pumpe in Flussrichtung ausgerichtet, auf senkrechten Stücken senkrecht, Stockwerk nach Höhe; rastet an der Stelle ein, ab der die Förderhöhe nicht mehr reicht. *(Unit-Test)*
- [x] AWESOME-Schredder: Zufluss gilt als abgeführt, zählt aber als Überschuss (Spalte „davon Schredder“ in der Bilanz, Hinweis FAB-020). *(Unit-Test)*

**Schienennetz**
- [x] Gleisraster 4 m (Standard; trifft Ecken, Kantenmitten und Mitten der 8-m-Fundamente) oder 1 m. *(Unit- und E2E-Test)*
- [x] Mehrfachauswahl gemeinsam verschieben (Rahmen oder Umschalt-Klick, dann ziehen; rastet im Gleisraster). *(Unit- und E2E-Test)*
- [x] Mausrad dreht beim Gleisbau die Richtung am Gleisende auf Rasterwinkel (Vielfache von 15°, Umschalt 5°; eine Stufe je zwei Rastungen; Strg + Rad zoomt). *(Unit- und E2E-Test)*
- [x] Mindestlänge 12 m, Höchstlänge 100 m und Mindestradius 17 m schon beim Bauen: rote Vorschau mit Grund, Bau nur mit Strg + Klick. *(E2E)*
- [x] Mehrere Loks: „+ Lok vorn“ (hinter den führenden Loks), Loks und Wagen mit ◀ ▶ umordnen, „fehlende Loks vorn ergänzen“ aus der Zugkraftrechnung.
- [x] Befund RAIL-026: ab drei Pfadblöcken hintereinander auf dem Fahrweg eines Zuges (Wegwahl wie in der Simulation). *(Unit-Test)*

**Vereinfachungen / bekannte Grenzen**
- Gleisraster und Streamer-Modus sind Browser-Einstellungen, nicht Teil des Projekts.
- Ohne ID in der Adresszeile öffnet ein Lesezeichen auf „/“ das zuletzt geöffnete Projekt dieses Browsers; für andere Geräte den Link über „Kopieren“ weitergeben.
- Pumpe einsetzen: Bei Leitungen im Verlegemodus „Kurve“ wird die Lage an der Sehne zwischen den Steuerpunkten bestimmt.
- RAIL-026 nutzt eine feste Grenze (3 Pfadblöcke); die Länge der reservierten Strecke steht in der Meldung.

### Hotfix 0.4.1

- Einbaulage-Knöpfe der Pumpe passen in die Seitenleiste (kurze Beschriftung ▲/▼, Umbruch).
- Endpfeil von Rohren zeigt auch an senkrechten Enden (senkrechte Pumpe) in Förderrichtung.
- Helles Farbschema: Leitungsstufen und Gebäudefarben heller.
- „📋 Link kopieren“ in der Kopfleiste und in der Liste „Zuletzt geöffnet“.
- Gleisbau: Mausrad auf Rasterwinkel mit geringerer Empfindlichkeit; Gleisraster nur noch 4 m und 1 m; Pumpenwerkzeug rastet an der Stelle ein, ab der gepumpt werden muss.

### Hotfix 0.4.2

- Rohre: keine stehenden Richtungspfeile mehr (Pfeile nur noch animiert bei Durchfluss); Rohr Mk.1 und Mk.2 haben zur Unterscheidung von Bändern eine helle Mittellinie.

## Version 0.5 – Strom, Fehlersuche, Drohnen, Beispiele ✅

Umgesetzt aus „zukünftige Pläne bzw. Änderungen“ (zweiter Teil des Abschnitts „nächste Version“).

**Allgemein**
- [x] „🩺 Etwas stimmt nicht?“ (Befundliste): erweiterte Prüfung mit allen Befunden der Fabrik und ihrer Pläne (auch Hinweise und ignorierte), danach geführte Suche „Maschine steht / läuft nicht voll“ bzw. „Gegenstand kommt nicht an“. Die Suche verfolgt den Fluss über Splitter, Lager und Rohrkreuzungen zurück: fehlende Zuleitung bzw. Quelle, nicht angeschlossener oder gestauter Ausgang, volle Leitung, zu wenig Quelle für alle Abnehmer, Quelle läuft selbst nicht voll (rekursiv). Klick auf eine Zeile zeigt das Objekt. Dazu eine Liste von Ursachen, die der Planer nicht prüft. *(Unit- und E2E-Test)*
- [x] Beispielprojekte „Eisenwerk“ (einfach) und „Montage mit Transport“ (zwei Fabriken, Lkw und direktes Band): in der Projektliste, im Hilfemenü und in der Begrüßung. Keine Fehler oder Warnungen, alle Maschinen voll ausgelastet. *(Unit- und E2E-Test)*
- [x] Tutorial: Schritte zu „Etwas stimmt nicht?“, Stromerzeugung und Alternativ-Vorschlägen; Drohnen in der Transport-Führung.

**Produktion**
- [x] Stromerzeugung: Kraftwerksrezepte je Kraftwerk und Brennstoff aus den Docs abgeleitet (Kohle-, Biomasse-, Treibstoff-, Atomkraftwerk; Wasser und Atommüll inklusive). Im Plan unter „Kraftwerke“ Kraftwerk, Brennstoff und Anzahl vorgeben; der Plan rechnet die Zulieferung (seit 0.5.1, siehe unten). *(Unit- und E2E-Test)*
- [x] Kraftwerke im Grundriss: Brennstoff wie ein Rezept wählen; Durchsatzmodell rechnet den Verbrauch, Eigenschaften und Bilanz zeigen die erzeugte Leistung. *(Unit-Test)*
- [x] „Alternativrezepte vorschlagen“: einzelne Alternativen und ihre Kombination mit Einsparung in Prozent und je Rohstoff; „übernehmen“ schaltet sie frei. *(Unit- und E2E-Test)*

**Transport**
- [x] Drohnen als Transportmittel: Anzahl, Entfernung, Brennstoff; Laderaum, Umlauf, Brennstoff je Umlauf und pro Minute; Drohnenhafen im Grundriss als Übergabe (Be-/Entladen). Brennstoffbedarf zählt beim Absender (Bilanz, Befund TRN-017). Neue Befunde TRN-016/017. *(Unit- und E2E-Test)*

**Vereinfachungen / bekannte Grenzen**
- Kraftwerke im Plan bei 100 % Takt; der Strombedarf der Maschinen wird bewusst nicht gegengerechnet. Erdwärmekraftwerke fehlen (Geysire kommen mit der Karte).
- Alternativ-Vorschläge nur ohne „Nur vorhandene Maschinen“; Maß ist der gewichtete Rohstoffbedarf, nicht die Maschinenzahl.
- Fehlersuche nur für Fabriken (nicht Schiene); sie liest das idealisierte Durchsatzmodell (bestmögliche Splitter, schematische Anschlüsse).
- Drohnen: Geschwindigkeiten laut Wiki ungefähr; Entfernung beim Brennstoff einfach gezählt (nicht belegt); ein Drohnenhafen ist entweder beladend oder entladend (kein Rücktransport im selben Auftrag).
- Das Projektformat bleibt Version 2: neue Felder haben Standardwerte, alte Dateien laden unverändert.

### Hotfix 0.5.1

- Vorschläge für Alternativrezepte: Die Kombination umfasst höchstens 4 Rezepte (schrittweise aus den besten Ergänzungen statt aller Alternativen auf einmal); höchstens 8 Einzelvorschläge. *(Unit-Test)*
- Kraftwerke planen statt Strom durchrechnen: Im Produktionsplan gibt man unter „Kraftwerke“ Kraftwerk, Brennstoff und Anzahl an (z. B. 16 Kohlegeneratoren); der Plan berechnet Brennstoff und Wasser bzw. deren Herstellung. Kein Gegenrechnen des Maschinenstroms mehr, keine Leistungsvorgabe in MW. Die Kraftwerksrezepte stehen nicht mehr in der Rezeptauswahl. *(Unit- und E2E-Test)*

## Version 0.6 – Karte ✅

Alles rund um die Spielkarte (aus „Sag mir mal …“ im Planungsdokument), in einem Durchgang umgesetzt.

**Abnahmekriterien**
- [x] Neuer Reiter „Karte“: Kartenbild (Spielkarte bzw. realistisch, abschaltbar, Deckkraft) aus den Kacheln von satisfactory-calculator.com, live im Browser geladen; Spielbereich, Weltraster, Schienennetze, Bahnhöfe, Fabrikgrundrisse und Transportaufträge (Linie je Auftrag mit Gegenstand, Menge und Luftlinie). *(E2E)*
- [x] Rohstoffvorkommen aus belegter Quelle (satisfactory-calculator.com, Abrufskript `npm run gamedata:map`): Nodes, Satelliten und Mitten der Quellen, Geysire; Filter nach Rohstoff, Reinheit, Art und „nur freie“; Klick zeigt Lage, Belegung und Förderrate je passendem Gebäude bei 100 % und 250 %. *(Unit-Test: Anzahl wie im Wiki, Förderraten; E2E)*
- [x] Fabrikstandort: Platzieren (Grundrissmitte am Mauszeiger), Ziehen, Drehen (R), Entfernen (Entf), Zahlenfelder; Grundriss aus Bau- und Fundamentflächen, sonst aus den Gebäuden geschätzt. Weltraster (Wiki „World grid“: ein globales 8-m-Raster): Fundamente der Fabrik liegen nach dem Einrasten auf dem Weltraster, für alle Himmelsrichtungen (Kanten auf Vielfachen von 8 m, seit 0.6.1). *(Unit- und E2E-Test)*
- [x] Fabrikgrundriss einer platzierten Fabrik: Kartenbild und Vorkommen darunter (Ebenen „Kartenbild“, „Vorkommen“), Weltkoordinaten in der Statuszeile; Gewinnungsgebäude rasten auf einem passenden freien Vorkommen ein und übernehmen Rohstoff und Reinheit; Auswahl des Vorkommens in den Eigenschaften (nach Entfernung). *(Unit- und E2E-Test)*
- [x] Prüfregeln MAP-001 … MAP-008 (doppelt belegt, neben dem Vorkommen, falscher Rohstoff bzw. Reinheit, unbekanntes Vorkommen, Überschneidung, außerhalb der Welt, nicht verknüpft, Gelände nicht geprüft). Kartenbefunde zu Gebäuden erscheinen auch im Fabrikgrundriss. *(Unit-Tests)*
- [x] Transport: Luftlinie zwischen Drohnenhäfen, Lkw-Stationen bzw. Übergabeanschlüssen (sonst Fabrikmitten); neue Aufträge übernehmen sie als Strecke, „Von Karte übernehmen“ im Auftrag; TRN-018 meldet zu kurze bzw. (Drohne) zu lange Strecken. *(Unit- und E2E-Test)*
- [x] Standortvorschlag aus einem Produktionsplan: Rohstoffbedarf aus eigener Gewinnung (ohne Wasser und Importe), Minerstufe, Takt, Suchradius; bis zu fünf Orte mit Deckung und mittlerer Entfernung, belegte Vorkommen anderer Fabriken ausgelassen; „Fabrik hier platzieren“. *(Unit- und E2E-Test)*
- [x] Schieneneditor: Kartenbild, Vorkommen und Fabrikgrundrisse als Unterlage (Schienennetze liegen in Weltkoordinaten).
- [x] Formatversion 3 mit Migration 2 → 3 (`factories.*.map`, `extraction.nodeId`), Fixture `project-v2.json`. *(API-Test)*
- [x] Hinweis zu Rechten an Spielinhalten und zur Quelle der Kartendaten in Einstellungen → Allgemein; Tutorial-Tour „Karte“; Tastenkürzel Alt+5 und Kartenaktionen einstellbar.

**Vereinfachungen / bekannte Grenzen**
- Kartenbild und Vorkommen kommen von einer Drittseite ohne ausdrückliche Lizenz; das Bild wird nicht gespeichert, sondern live geladen. Ändert die Seite ihre Kachel-URLs, bleibt die Karte ohne Bild.
- Kein Gelände: Hänge, Wasser und Höhen werden nicht geprüft (MAP-008). Entfernungen sind Luftlinien; Straßen- und Bandwege sind länger.
- Gewinnungsgebäude rasten mit ihrem Ursprung auf der Mitte des Vorkommens ein (Annahme); Quellenmitten sind gemittelt; Geothermie (Geysire) und Quellenkompressor werden angezeigt, aber nicht verknüpft.
- Standortvorschlag ist eine Heuristik (nächste freie Vorkommen je Rohstoff, mengengewichtete Entfernung), kein Optimum; Bandkapazitäten zum Standort werden nicht geprüft.
- Bestehende Schienennetze behalten ihre Koordinaten und liegen damit um den Weltursprung; zum Ausrichten das Netz verschieben.

### Hotfix 0.6.1

- Weltraster: Fundamentkanten bzw. Fabrikursprung liegen auf Vielfachen von 8 m, deckungsgleich mit dem gezeichneten Weltraster (vorher um 4 m versetzt). *(Unit- und E2E-Test)*
- Vorkommen von der Karte belegen: Fabrik und Gebäude wählen, „Vorkommen belegen“ legt ein verknüpftes Gewinnungsgebäude an (über dem Vorkommen aufgestellt, wenn die Fabrik auf der Karte steht und das Vorkommen höchstens 150 m außerhalb des Grundrisses liegt; sonst geplant); „Freigeben“ löst die Verknüpfung. *(Unit- und E2E-Test)*
- Rohstoffbedarf je Fabrik gegen belegte Vorkommen (Bedarf aus den Produktionsplänen, Förderung verknüpfter Gebäude, Anzahl Vorkommen, gedeckt / fehlt). *(Unit- und E2E-Test)*
- „Vorkommen in der Nähe“: Überfahren hebt das Vorkommen auf der Karte hervor. *(E2E)*
- Fabrikgrundriss: Bau- und Fundamentflächen rasten im 8-m-Raster ein (Alt: fein), reine Flächen werden im 8-m-Raster verschoben, Ecken einer gewählten Fläche lassen sich ziehen (Rechtecke bleiben Rechtecke). *(E2E)*
- Fabrikgrundriss: Ebene „Gleise“ zeigt die Gleise aller Netze unter einer platzierten Fabrik.
- Bahnhöfe ↔ Grundriss in beide Richtungen: Ein Bahnhof, der einer Fabrik auf der Karte zugeordnet ist, steht mit Bahnhofsgebäude und Bahnsteigen im Grundriss (Be-/Entladen, Bahnhofszuordnung). Änderungen im Schienennetz verschieben bzw. ergänzen die Gebäude; Verschieben, Drehen, Be-/Entladen und Löschen im Grundriss ändern den Bahnhof; ein an Ort und Stelle um 180° gedrehter Bahnsteig wechselt die Anschlussseite; Verschieben der Fabrik auf der Karte nimmt den Bahnhof mit. Vorhandene Bahnsteige mit Bahnhofszuordnung werden übernommen. Der Abgleich läuft nach jeder Änderung im selben Undo-Schritt. *(Unit- und E2E-Test)*
- Standortvorschlag wahlweise auf der ganzen Karte oder im aktuellen Kartenausschnitt. *(Unit-Test)*
- Beispielprojekte: Gebäude in Flussrichtung gedreht, Anschlüsse auf einer Linie, Bänder rechtwinklig verlegt. *(Unit-Test)*

**Grenzen:** Die Höhe der Bahnhofsteile folgt dem vorderen Bahnhofsknoten (Gleishöhe = Grundfläche, Annahme). Löschen des Bahnhofsgebäudes im Grundriss entfernt den ganzen Bahnhof aus dem Netz (rückgängig machbar). Neue Bahnsteige entstehen nur im Schienennetz, nicht durch Bauen im Grundriss.

## Version 0.7 – Automatisches Fabriklayout, Blackbox, Rezepte ✅

Aus dem Planungsdokument „Updates“ (Fabrikplanung: Layout automatisch, verschiedene Versionen, Blackbox; Produktion: Alt-Rezepte nachschlagen) plus die offenen Punkte aus „Hotfixes“.

**Abnahmekriterien**
- [x] Dialog „Layout automatisch erzeugen“ (aus dem Produktionsplan, den Fabrikeigenschaften und der Blackbox-Ansicht): Vorgaben Ort (frei neben dem Bestand oder vorhandene Bau-/Fundamentfläche), Breite und Tiefe höchstens, Etagen höchstens, höchste Band- und Rohrstufe, Abstände (kompakt/breit), Verteilung (Manifold/Splitterbaum), Takt (gleichmäßig/volle Maschinen + Rest), Fundamentfläche. *(E2E)*
- [x] Bis zu drei Varianten: A Reihen (Linien auf einer Seite des Verteilergangs), B kompakt (beidseitig), C Etagen (beidseitig auf mehrere Etagen, Lifte im Gang; ab 2 Etagen). Vorschau je Variante (zoombar, Etagenwahl), Maße, Gebäude, Übergaben, Leitungslängen, Hinweise; Varianten, die die Vorgaben nicht erfüllen, sind markiert. *(Unit- und E2E-Test)*
- [x] Jede Variante wird an einer Projektkopie geprüft: Durchsatzmodell mit voll versorgten Eingängen (kleinste und mittlere Auslastung) und Überschneidungen. Testpläne (verstärkte Eisenplatten, Kunststoff mit Raffinerie und Nebenprodukt, modularer Rahmen; im Belastungstest auch schwere modulare Rahmen mit 151 Maschinen, Computer, Motoren, Treibstoff, Gummi/Kunststoff-Kreislauf, Aluminium) laufen in allen Varianten zu 100 % ohne Überschneidungen. *(Unit-Test)*
- [x] Linien respektieren die höchste Stufe (Durchsatz je Leitung) und die Breite (Maschinen je Linie); Leitungen bekommen die kleinste ausreichende Stufe. *(Unit-Test)*
- [x] Übernahme in einem Undo-Schritt: fehlende Etagen über der obersten (oberste vorhandene Etage wird bei Bedarf erhöht), nicht platzierte Maschinen mit passendem Rezept werden verwendet, Ein- und Ausgänge als beschriftete Lager bzw. Flüssigkeitspuffer, Fundamentfläche je Etage. *(Unit- und E2E-Test)*
- [x] Blackbox-Fabriken (Formatversion 4, Migration 3 → 4, Fixture `project-v3.json`): Ansicht mit Ein- und Ausgängen (eigene Gewinnung/Zulieferung, Transportabdeckung), Maschinen, Strom und geschätzter Fläche; Grundrissprüfungen entfallen (FAB-021), Transport rechnet mit Herstellung und Verbrauch laut Plänen, Übergabegebäude gelten als vorhanden, PROD-003 entfällt; die Karte zeigt eine geschätzte Fläche. *(API-, Unit- und E2E-Test)*
- [x] „Rezepte nachschlagen“: alle Rezepte eines Gegenstands mit Ein- und Ausgängen je Maschine, Zyklusdauer, Strom, Rohstoffen für 60/min, Maschinen und gewichtetem Rohstoffbedarf im Vergleich zum Standardrezept; Vorprodukte und Verwendung anklickbar; Aufruf auch aus der Rezeptauswahl (ⓘ). *(E2E)*
- [x] Hotfix-Punkte: Bauvorschau zeigt Ein- und Ausgänge (Einzelgebäude, Gruppen, Einfügen); Fehlersuche hat den Abschnitt „Auffällige Gebäude“ (ohne Rezept, steht still, läuft nicht voll); FAB-009 ist jetzt eine Warnung, Gebäude ohne Rezept tragen im Grundriss „kein Rezept“. *(E2E)*
- [x] Tutorial-Tour „Auto-Layout und Blackbox“.

**Vereinfachungen / bekannte Grenzen**
- Anschlusslagen sind schematisch (Eingänge hinten, Ausgänge vorn); Leitungen kreuzen sich im Grundriss und müssen im Spiel über Lifte bzw. Höhen geführt werden.
- Ein- und Ausgänge sind Übergabelager, je Leitung eins. Gewinnungsgebäude setzt das Layout nicht (die Vorkommen liegen woanders); nach der Übernahme laufen die Maschinen erst, wenn die Eingänge Zulauf haben (Transportauftrag, Gewinnung).
- Splitterbaum nur mit Teilern 2 und 3; Rohre immer als Sammelleitung; keine Pumpen bei Etagenwechseln (FAB-016/019 melden das nach der Übernahme).
- Variante C verteilt die Linien in Stufenreihenfolge auf die Etagen; ein Layout „um bestehende Gebäude herum“ gibt es nicht (immer freie Fläche bzw. eine gewählte Fläche).
- Blackbox gilt für die ganze Fabrik; die Fläche ist eine Schätzung (Maschinengrundfläche × 3).
- Wie ein Alternativrezept freigeschaltet wird (Festplatte, M.A.M., Meilenstein), steht nicht in den Spieldaten des Planers.

### Hotfix 0.7.1

Aus „Hotfixes“: Layout sah noch nicht schön aus; Bauarten als Standards speichern; mittlere und große Beispielfabrik; Option, ob sich Bänder kreuzen dürfen; Bänder sinnvoll verlegen.

- Neue Bauweise **Hauptbus** (nach Recherche üblicher Bauweisen, Quellen in docs/SPIELREGELN.md): je Gegenstand eine gerade Busspur mit Splittern bzw. Zusammenführungen direkt auf der Spur, Ein- und Ausgänge am Anfang bzw. Ende ihrer Spur, kurze rechtwinklige Abzweige zu den Linien; ersetzt den Verteilergang mit Einzelleitungen. *(Unit-Test)*
- **Fundamentraster:** Maschinen mittig in 4- bzw. 8-m-Rasterfeldern, Linienoberkanten auf dem 4-m-Raster, Layoutmaße in ganzen Fundamenten. *(Unit-Test)*
- **Kreuzungen** als Option: „vermeiden“ (Standard) staffelt Bus, Abzweige und äußere Zuführungen in der Höhe – in allen Testplänen (bis 151 Maschinen, alle Varianten, Manifold und Splitterbaum) 0 Kreuzungen auf gleicher Höhe; „erlauben“ legt alles flach ohne Lifte. Die Prüfung im Dialog zählt Kreuzungen auf gleicher Höhe. *(Unit- und E2E-Test)*
- **Bauarten:** sechs eingebaute (Hauptbus mit Manifolds, Kompakter Block, Mit Laufwegen, Load Balancer, Hochbau, Früh im Spiel) mit Beschreibung; eigene Bauarten speichern und löschen (im Browser gespeichert). *(E2E)*
- **Beispielprojekte** „Computerfabrik“ (mittel, 28 Maschinen) und „Schwere modulare Rahmen“ (groß, 151 Maschinen auf drei Etagen), mit dem Auto-Layout erzeugt; eine Blackbox „Rohstoffversorgung“ beliefert die Eingänge über direkte Leitungen. Ohne Fehler und Warnungen, alle Maschinen laufen (Restabweichung < 0,01 % durch gerundete Takte). Im Hilfemenü und in der Projektliste. *(Unit- und E2E-Test)*
- Kopfzeile bricht bei wenig Platz um, statt die Seite seitlich zu verschieben; langer Projektname überlappt nicht mehr.

### Hotfix 0.7.2

Aus „Hotfixes“: Fundamente sperren; Band- und Rohrhöhen in der Seitenansicht uneinheitlich (Rückfrage: zu viele Höhenstufen); klarer Übergangspunkt zwischen Stockwerken; voll ausgelastete Leitungen ohne eigene Farbe; Pumpen raus, nur noch Hinweise; eigene Farben; Deckkraft der anderen Stockwerke; Quadrate an den Leitungen umfunktionieren.

- **Fundamente sperren:** Flächen haben das Feld „Gesperrt“ (Eigenschaften, optionales Feld `locked`, keine Formatänderung). Gesperrte Flächen lassen sich nicht verschieben (Ziehen, Pfeiltasten), nicht verformen und nicht löschen; Ziehen darauf zieht einen Auswahlrahmen auf, ein Klick wählt sie zum Entsperren aus; im Grundriss mit 🔒 beschriftet. *(Unit- und E2E-Test)*
- **Feste Höhenebenen im Auto-Layout** (statt je 4 m höher pro äußerer Leitung, bisher bis 13 m): Bus, Maschinenanschlüsse und Zuläufe auf 1 m, Zuführungen und Sammelleitungen (bei mehreren Gegenständen je Linie) sowie Abzweige auf 5 m, Abzweige nach rechts bei beidseitigen Linien auf 9 m. Lifte sitzen direkt am Splitter bzw. an der Zusammenführung. Weiterhin 0 Kreuzungen auf gleicher Höhe in allen Testplänen; die Beispielprojekte nutzen nur noch 1, 5 und 9 m. *(Unit-Test)*
- **Stockwerkswechsel:** Das Quadrat mit ▲/▼ erscheint nur noch, wo eine Leitung das Stockwerk wechselt (nicht mehr bei jedem Höhenwechsel innerhalb einer Etage), beschriftet mit „nach …“, „von …“ bzw. „durchquert“. Leitungsstücke auf anderen Stockwerken sind blass, das Stück auf dem gewählten kräftig. Die Seitenansicht markiert die Stelle, an der eine Leitung einen Stockwerksboden kreuzt, mit einer Raute.
- **Volllast ohne eigene Farbe:** Nur Überlastung färbt eine Leitung rot; ab 98 % gab es bisher die Warnfarbe (ähnlich Band Mk.2).
- **Pumpen:** Das Werkzeug „Pumpe aufs Rohr setzen“ in der Seitenansicht ist entfernt; FAB-019 „Förderhöhe reicht nicht“ ist nur noch ein Hinweis. Pumpen lassen sich weiter von Hand aus dem Katalog setzen.
- **Animierte Pfeile:** Der Fluss wird für die Animation auch ohne die Ebene „Durchsatz und Auslastung“ berechnet; die Pfeile laufen auch auf Rohren und in der Seitenansicht.
- **Einstellungen → Darstellung:** Deckkraft der nicht gewählten Stockwerke (auch im Menü „Ebenen“), eigene Farben für Förderbänder Mk.1–6, Rohre Mk.1–2, Ein-/Ausgänge, Treibstoffanschluss, Gebäudekategorien, Auswahl und Überlastung (im Browser gespeichert, einzeln oder alle zurücksetzbar). *(E2E)*

**Grenzen:** Eigene Farben gelten für helles und dunkles Farbschema gleichermaßen. Bestehende, mit 0.7.1 erzeugte Layouts behalten ihre Höhen; neu erzeugen übernimmt die festen Ebenen.

### Hotfix 0.7.3

Aus „Hotfixes“: Rohstoffaufträge passen nicht zur Zahl der Eingänge (Menge je Eingang anzeigen); Absender und Empfänger bei zwei Fabriken nicht tauschbar; Förderbänder liegen im Grundriss über lange Strecken übereinander; Logistikebenen im Auto-Layout und in den Beispielen; Standard-Deckkraft anderer Stockwerke 15 %, 0 möglich.

- **Bedarf je Eingang:** Neuer Abschnitt „Eingänge der Fabriken“ im Transport: je Eingangslager Gegenstand, Bedarf der Maschinen dahinter (Durchsatzmodell mit unbegrenzt versorgten Eingängen), direkte Leitungen mit bestellter Menge, Status (gedeckt / fehlt / ohne direkte Leitung) und „Menge übernehmen“. Der Bedarf steht auch in der Auswahl des Übergabeanschlusses einer direkten Leitung, als Zeile „Bedarf an diesem Eingang“ im Auftrag und in den Eigenschaften des Lagers. Der Gegenstand kommt aus der angeschlossenen Leitung, dem Etikett des Auto-Layouts („Eingang: Kohle“) oder den Verbrauchern dahinter. *(Unit- und E2E-Test)*
- **Absender/Empfänger tauschen:** Wird bei „Von“ die Fabrik gewählt, die schon bei „Nach“ steht (oder umgekehrt), tauschen beide Seiten samt Bahnhöfen, statt einen Fehler zu melden; zusätzlich Knopf ⇄. Übergabeanschlüsse direkter Leitungen entfallen beim Tausch. *(Unit- und E2E-Test)*
- **Weniger Leitungen übereinander:** Linien auf beiden Seiten des Busses werden beim Anordnen in 4-m-Schritten versetzt, bis ihre Anschlüsse nicht auf denselben Linien liegen wie die der Gegenseite; Abgänge von Verteilketten benachbarter Linien weichen einander aus. In den Testplänen von über 100 auf 5 Stellen (mehr als 4 m übereinander), weiterhin 0 Kreuzungen. Der Dialog zeigt die Zahl als „n übereinander“. *(Unit-Test)*
- **Logistikebenen:** Option „Logistikebene: darunter“ und Bauart „Mit Logistikebene“ im Auto-Layout: unter jeder Produktionsebene eine Logistikebene mit Bus, Zuführungen, Sammelleitungen, Splittern und Ein-/Ausgängen (1, 3 und 5 m über dem Logistikboden), Lifte durch die Decke zu den Maschinen. Eine leere oberste Etage (z. B. das Erdgeschoss einer neuen Fabrik) wird dabei zur Logistikebene. Mittleres und großes Beispiel gibt es im Hilfemenü und in der Projektliste auch „mit Logistikebene(n)“. *(Unit- und E2E-Test)*
- **Deckkraft anderer Stockwerke:** Standard 15 % (der bisher mitgespeicherte Standard 25 % wird auf 15 % gesetzt), Regler ab 0 %.

**Grenzen:** Teilen sich mehrere Eingänge dieselben Maschinen, ist die Aufteilung des Bedarfs zwischen ihnen eine von mehreren möglichen. Züge, Fahrzeuge und Drohnen liefern an die Fabrik, nicht an einen bestimmten Eingang. Lifte von der Logistikebene erzeugen je einen Hinweis FAB-017 (Aussparung im Boden).

## Version 0.8 – Anschlusslagen wie im Spiel, 3D-Ansicht ✅

Aus dem Planungsdokument „Updates“ (Fabrikplanung: Ein- und Ausgänge an der richtigen Stelle statt schematisch, 3D-Ansicht im Fabrikgrundriss) plus die offenen Punkte aus „Hotfixes“. Rückfragen: Lagen aus den Spielpaketen statt aus Bildern; immer echte Lagen (keine Option je Fabrik); Auto-Layout passt sich an; 3D mit three.js als Quader; Produktion „aus Eingangsmengen“ entfällt, der Modus „Maximieren (begrenzte Mittel)“ deckt das ab.

**Abnahmekriterien**
- [x] Anschlusslagen aus den Spielpaketen: .NET-Werkzeug `packages/gamedata-tools/ports` (CUE4Parse) liest Lage, Höhe und Richtung aller Band- und Rohranschlüsse aus den Blueprints der lokalen Installation (`npm run gamedata:ports` → `curated/ports-game.json`); `extract.ts` löst Vererbung auf, ordnet die Komponenten den Anschluss-IDs zu und schreibt `portLayout` in den Datensatz. Alle 43 Gebäude mit Anschlüssen haben Lagen; Anzahl stimmt mit den Spieldaten überein. *(Unit-Test: Konstruktor, Raffinerie, Splitter, Lager Mk.2 mit zwei Höhen, Miner Mk.3 geerbt, Treibstoffeingang der Lkw-Station)*
- [x] Grundriss, Seitenansicht und Durchsatzmodell nutzen die echten Lagen; Eigenschaften zeigen „Lage: wie im Spiel“; FAB-005 nur noch für Gebäude ohne Lage (derzeit keine). *(Unit- und E2E-Test)*
- [x] Auto-Layout mit echten Lagen: Maschinen so gedreht, dass die Eingänge zu den Zuführungen zeigen (Raffinerie um 180°), Umriss gedreht; Splitterbaum, Ein- und Ausgangslager nach ihren Anschlüssen ausgerichtet. Alle bisherigen Prüfungen halten: alle Varianten 100 %, 0 Kreuzungen auf gleicher Höhe, feste Höhenebenen, Logistikebenen. *(Unit-Test)*
- [x] Beispielprojekte neu aufgebaut (Anschlüsse nach Seite statt Nummer gewählt, Lkw-Ladung am Ladungs- statt am Treibstoffeingang); in allen vier Beispielen läuft keine Leitung hinter der Anschlussebene durch ihr eigenes Gebäude zurück. *(Unit-Test)*
- [x] Pumpe in eine Leitung einsetzen richtet die Achse Eingang → Ausgang in Flussrichtung aus (im Spiel liegt sie entlang x). *(Unit-Test)*
- [x] 3D-Ansicht im Fabrikgrundriss (Werkzeugleiste „3D“, nur ansehen): Gebäude als Körper aus den Kollisionsboxen in Kategorienfarbe, Förderbänder und Rohre als Röhren in Stufenfarbe auf ihrer Höhe, Bau- und Fundamentflächen als Platten; Stockwerke einzeln bzw. „bis gewähltes“ ausblendbar, Leitungen und Flächen abschaltbar; Drehen, Verschieben, Zoomen; Klick wählt aus, Überfahren zeigt den Namen. three.js wird erst beim Öffnen geladen. *(E2E)*
- [x] Hotfix-Punkte: keine „−0“ mehr (Zahlen werden auf die angezeigten Stellen gerundet, „Netto lokal“ färbt nach dem gerundeten Wert) *(Unit-Test)*; im Grundriss lassen sich nur Leitungsstücke auf dem gewählten Stockwerk anklicken *(Unit-Test)*; Standortvorschlag mit „Vorschläge ausblenden“ bzw. Esc auf der Karte *(E2E)*; Knoten im Produktionsdiagramm verschiebbar, „Anordnung zurücksetzen“ *(E2E)*.

**Vereinfachungen / bekannte Grenzen**
- Die Anschlusslagen stammen aus Spielversion 1.2.4.1 (Docs identisch mit 1.2.4.0). Nach einem Spiel-Update `npm run gamedata:ports` und `npm run gamedata:extract` erneut ausführen (.NET-SDK 10 nötig).
- Anschlüsse liegen im Spiel innerhalb der Kollisionsbox (z. B. Konstruktor 3 m statt 5 m vor der Mitte); Leitungen beginnen im Grundriss daher innerhalb des Umrisses.
- Bestehende Projekte behalten ihre Verbindungen (gleiche Anschluss-IDs), die Anschlüsse liegen aber jetzt an anderer Stelle. Von Hand gesetzte Zwischenpunkte können Umwege ergeben; mit dem Auto-Layout erzeugte Fabriken ggf. neu erzeugen. Keine Formatänderung (nur Spieldaten), daher keine Migration.
- Auto-Layout: Liegen Ausgänge auf derselben Seite wie die Eingänge (z. B. Kernkraftwerk), führt die Sammelleitung um die Maschine herum (Hinweis im Dialog). Leitungen laufen weiter auf 1/5/9 m; Rohranschlüsse auf 1,75 m bzw. 3,75 m (Verpacker) werden am Ende angehoben.
- 3D-Ansicht: keine Spielmodelle (rechtlich geschützt), sondern die Planungsboxen; Förderbänder als runde Röhren; nur ansehen, kein Bearbeiten. Braucht WebGL.
- Die Verschiebung von Knoten im Produktionsdiagramm gilt nur, solange die Seite offen ist, und nur für denselben Graphen (ändert sich der Plan, ordnet sich das Diagramm neu).

### Hotfix 0.8.1

Aus „Hotfixes“ (alles zur 3D-Ansicht): Splitter und Zusammenführungen fehlten; Rohre und Bänder sahen teils seltsam aus; Stockwerksauswahl mit links abgleichen; Namen auf den Gebäuden; Bänder und Rohre unterscheiden; Infos beim Überfahren bzw. Flussrichtung; einzelne Fundamente anzeigen. Rückfragen: Stockwerk links = Schnitt; Infos beim Überfahren und feste Pfeile; Fundamentkacheln nur in 3D.

- **Splitter, Zusammenführungen, Rohrkreuzungen:** haben in den Spieldaten nur weiche Kollisionsboxen und fehlten deshalb; ohne feste Box wird jetzt die weiche gezeigt. *(Unit-Test)*
- **Bänder und Rohre:** Bänder als flache Bahn (1 m breit, 0,25 m dick, Oberkante auf Leitungshöhe, Lifte als Säule), Rohre als runde, glänzende Rohre mit Gelenken an den Knicken (statt einer verdrehten Röhre um die Ecken). *(Unit-Test: keine ungültigen Punkte, Bahn flach)*
- **Stockwerk = Schnitt:** Das links gewählte Stockwerk ist auch in 3D gewählt und umgekehrt (Klick in der 3D-Liste); Stockwerke darüber sind ausgeblendet, „darüberliegende zeigen“ hebt den Schnitt auf. *(E2E)*
- **Namen** über Maschinen und benannten Gebäuden (nicht an Splittern, Rohrkreuzungen u. Ä.), abschaltbar. *(Unit-Test)*
- **Infos beim Überfahren:** Gebäude mit Name, Rezept, Takt und Auslastung; Leitungen mit Stufe, Gegenständen und Durchsatz/Kapazität. *(Unit- und E2E-Test)*
- **Flussrichtung:** feste Pfeile auf waagrechten Band- und Rohrstücken (alle 8 m), abschaltbar.
- **Fundamentkacheln:** Fundamentflächen wahlweise als einzelne Platten in Fundamentgröße (z. B. 8 × 4 × 1 m) mit Fugen, Raster wie im Grundriss. *(Unit-Test: eine Platte je Fundament)*

**Grenzen:** Bandbreite 1 m ist ein Planungsmaß (nicht belegt). Splitter und Zusammenführungen erscheinen mit ihrer weichen Box (4 × 4 m), also größer als das Modell im Spiel. Namen haben eine feste Größe in der Welt und werden aus der Ferne klein.

### Hotfix 0.8.2

Aus „Hotfixes“: Fundamentkacheln als Einzelteile statt Raster; Bänder unnötig in der Luft; Bandlifte beginnen am Boden; ferne Schrift unscharf; Auswahl durch den Boden; unnötig lange Bandwege; Animation in 3D; Bild hoch/runter in 3D; Materialfluss in den Einstellungen unter „Darstellung“. Rückfragen: lange Wege durch Lifte am Linienrand und bessere Sortierung, bei Logistikebenen Bänder bevorzugt dort; Absenken, wo darunter frei ist.

- **Auto-Layout, kürzere Wege:** Verbindungen zwischen Etagen und Rückführungen gegen die Flussrichtung mit beiden Anschlüssen auf derselben Seite nutzen keine Busspur mehr, sondern eine eigene Spalte am Linienrand (zwischen Verteilketten und Bus, auf Bushöhe – mit Logistikebenen also dort). Die übrigen Busspuren werden bei gleicher Spurzahl so verschoben bzw. getauscht, dass sie nahe an der Seite ihrer Linien liegen. Großes Beispiel: Umweg gegenüber dem direkten Weg 1038 → unter 500 m, längster 203 → unter 80 m. *(Unit-Test)*
- **Lifte:** Verbindungen zwischen Etagen steigen direkt von der Abzweighöhe auf (vorher erst hinunter auf den Bus in 1 m); Lifte zu Maschinen enden auf deren Anschlusshöhe (Rohre 1,75 m bzw. 3,75 m), ohne Senke auf 1 m. *(Unit-Test)*
- **Nur nötige Höhen:** Ein Nacharbeitsschritt senkt hochgelegte Stücke (Lift hoch – waagrecht – Lift runter) auf die Höhe davor ab, wenn darunter weder eine Leitung, ein Lift noch ein Gebäude im Weg ist. Weiterhin 0 Kreuzungen auf gleicher Höhe in allen Testplänen. *(Unit-Test)*
- **3D:** Fundamentraster als 8-m-Gitter auf der Fundamentplatte (statt Einzelplatten); Namen als HTML-Beschriftung (in jeder Entfernung scharf), sich überdeckende Namen werden ausgeblendet (nähere zuerst); Böden und Flächen verdecken beim Anklicken, was darunter liegt; Pfeile laufen animiert auf Leitungen mit Durchsatz (Schalter „animiert“ = Einstellung „Materialfluss animieren“); Bild hoch/runter wechselt das Stockwerk. *(Unit- und E2E-Test)*
- **Einstellungen:** „Materialfluss animieren“ steht unter „Darstellung“ (Abschnitt „Materialfluss“) und gilt für Grundriss, Seitenansicht und 3D. *(E2E)*

**Grenzen:** Die Spalte am Linienrand gibt es nur, wenn beide Anschlüsse auf derselben Seite des Busses liegen; sonst bleibt es bei einer Busspur. Die Busleitung selbst liegt weiter auf 1 m unter den Abzweigen. Die Geschwindigkeit der Pfeile ist eine Darstellung (steigt mit der Stufe), nicht die Spielgeschwindigkeit. Bestehende, mit älteren Versionen erzeugte Layouts ändern sich nicht; neu erzeugen übernimmt die Verbesserungen.

### Hotfix 0.8.3

Aus „Hotfixes“ (Sonstiges): Planer-Version bei den Projekten auf der Startseite anzeigen; „Zum Ausprobieren“ besser gestalten. Rückfragen: Version je Projekt; Auswahlliste mit Öffnen.

- **Version je Projekt:** Neues optionales Projektfeld `appVersion` (Planer-Version beim letzten Speichern; keine Formatänderung, ältere Stände laden unverändert). Es wird beim Speichern im Browser und auf dem Server gesetzt. Die Startseite zeigt es in einer Spalte „Version“ (zuletzt geöffnete Server-Projekte, lokale Projekte, Angebot zum Hochladen); ältere Stände zeigen „älter“, bis sie einmal gespeichert werden. *(API- und E2E-Test)*
- **Zum Ausprobieren:** eigener Abschnitt mit Auswahlliste der vier Beispiele, Beschreibung des gewählten, Haken „mit Logistikebene“ (nur bei den Auto-Layout-Beispielen) und „Beispiel öffnen“. *(E2E)*

