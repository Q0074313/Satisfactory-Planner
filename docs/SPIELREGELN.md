# Spielregeln und Prüfregeln

Dieses Dokument listet die Spielmechaniken, auf denen Berechnungen und Prüfungen beruhen, jeweils **mit Quelle**. Stand: Satisfactory **1.2.4.0** (Engine-Changelist 502094), Wiki-Abruf am 05.10.2026.

Kennzeichnung der Verlässlichkeit:

| Kennung | Bedeutung |
|---|---|
| **Spieldaten** | Direkt aus den offiziellen Docs-Dateien (`CommunityResources/Docs/en-US.json`) der Spielinstallation. |
| **abgeleitet** | Mit einer hier dokumentierten Formel aus Spieldaten berechnet. |
| **Wiki** | Aus dem Satisfactory-Wiki (satisfactory.wiki.gg) übernommen, Seite angegeben. |
| **Annahme** | Vom Planer getroffene, nicht verifizierte Annahme. Wird in der Oberfläche angezeigt. |

## 1. Produktion

| Mechanik | Wert / Formel | Quelle |
|---|---|---|
| Rezepte (Zutaten, Produkte, Dauer, Gebäude) | `mIngredients`, `mProduct`, `mManufactoringDuration`, `mProducedIn` | Spieldaten |
| Flüssigkeitsmengen | Docs in Litern → Planer in m³ (÷ 1000) | abgeleitet |
| Zyklen pro Minute | 60 / Dauer · Takt | abgeleitet |
| Takt | 1 % bis 250 %; über 100 % mit bis zu 3 Energiesplittern (+50 % je Splitter, `mExtraPotential = 0.5`) | Wiki „Clock speed“, „Power Shard“; Spieldaten |
| Leistung bei Takt | P = P₀ · Takt^`mPowerConsumptionExponent` (meist 1,321929) | Spieldaten |
| Somersloop-Verstärkung | Ausgabe × (1 + n / Slots); Zutaten unverändert; Slots = `mProductionShardSlotSize`; alle Slots = +100 % | Spieldaten, Wiki „Somersloop“ |
| Leistung mit Verstärkung | × (1 + Verstärkung)^`mProductionBoostPowerConsumptionExponent` (2) → bis ×4 | Spieldaten, Wiki „Somersloop“ („bis zu 4x“) |
| Variable Leistung (Teilchenbeschleuniger, Konverter, Quantenkodierer) | schwankt zwischen `constant` und `constant + factor` (rezeptabhängig). **Mittelwert constant + factor/2** | Spieldaten; Mittelwert = **Annahme** |
| Vorkommensreinheit | unrein ×0,5, normal ×1, rein ×2 | Wiki „Resource node“ |
| Weltweite Rohstoffmaxima | z. B. Eisenerz 92.100/min | Wiki „Resource node“ (Standardgewichtung im Solver) |
| Förderrate Gewinnung | Menge je Zyklus · 60 / Zykluszeit · Takt · Reinheit (Miner Mk.1/2/3 normal: 60/120/240 /min; Wasser- und Ölextraktor 120 m³/min; Quellenextraktor 60 m³/min) | Spieldaten (`mItemsPerCycle`, `mExtractCycleTime`, Flüssigkeiten Liter → m³), Reinheit Wiki |
| Maschine bei vollem Ausgang | hält an, auch wenn nur ein Nebenprodukt nicht abfließt | Spielverhalten (nicht aus den Docs belegt) – Grundlage von FAB-013 |

## 2. Logistik

| Mechanik | Wert | Quelle |
|---|---|---|
| Förderband Mk.1–6 | 60, 120, 270, 480, 780, 1200 /min = `mSpeed` / 2 | Spieldaten, abgeleitet (abgeglichen mit Wiki: Mk.1 = 60/min) |
| Förderlift Mk.1–6 | wie Bänder | Spieldaten, abgeleitet |
| Rohr Mk.1 / Mk.2 | 300 / 600 m³/min = `mFlowLimit` · 60 | Spieldaten, abgeleitet |
| Pumpe Mk.1 / Mk.2 | Förderhöhe 20 / 50 m (`mDesignPressure`); auch senkrecht einbaubar, Förderhöhe zählt ab dem Eingang | Spieldaten; Wiki „Pipeline Pump“ |
| Förderhöhe ohne Pumpe | Wasser-, Öl- und Quellenextraktor, Raffinerie, Umfüllanlage, Mixer, Flüssigkeits-Frachtplattform 10 m; Flüssigkeitsspeicher 8 m; Industrieller Flüssigkeitsspeicher 12 m (empfohlene Werte, tatsächlich etwas mehr); Rohrkreuzungen geben die höchste ankommende Förderhöhe weiter; Gase brauchen keine | Wiki „Head lift“ |
| LKW- und Tanklaster-Station | äußerster Bandeingang nur für Treibstoff | Wiki „Truck Station“ |
| Splitter / Zusammenführung | 1 → 3 bzw. 3 → 1 Bandanschlüsse | Wiki-Infobox |
| Rohrkreuzung | 4 (Kreuz) bzw. 3 (T) richtungsfreie Anschlüsse | Wiki „Pipeline Junction“ |
| Anschlusszahlen der Maschinen | z. B. Fabrikator 2/1, Manufaktor 4/1, Raffinerie 1+1 / 1+1 | Wiki-Infobox; zur Kontrolle aus Rezepten abgeleitet |
| **Anschlusspositionen** | **nicht verfügbar** → schematisch (Eingänge hinten, Ausgänge vorn) | **Annahme**, in der Oberfläche als „schematisch“ markiert |

## 3. Fabrikgrundriss

| Mechanik | Quelle |
|---|---|
| Gebäudemaße = Hülle der festen Kollisionsboxen aus `mClearanceData` (in cm, auch gedrehte Boxen) | Spieldaten |
| Feste Kollisionsboxen dürfen sich nicht überschneiden, sonst ist der Bau nicht möglich | Spieldaten (Kollisionsdaten) + Spielverhalten |
| Weiche Boxen (`CT_Soft`): Verhalten bei Überschneidung | **nicht verifiziert** → nur Warnung |
| Fundamentraster 8 m × 8 m; Höhen 1/2/4 m | Spieldaten (`mWidth`, `mDepth`, `mHeight`) |

Abweichungen zwischen Docs-Kollisionsbox und Wiki-Maßangaben stehen im Extraktionsbericht [`data/gamedata/1.2.4.0/EXTRAKTION.md`](../data/gamedata/1.2.4.0/EXTRAKTION.md). Der Planer verwendet die Docs-Werte.

## 4. Schiene

Quellen: Wiki „[Train Signals](https://satisfactory.wiki.gg/wiki/Block_Signal)“, „[Railway](https://satisfactory.wiki.gg/wiki/Railway)“, „[Train Station](https://satisfactory.wiki.gg/wiki/Train_Station)“, „[Freight Platform](https://satisfactory.wiki.gg/wiki/Freight_Platform)“, „[Electric Locomotive](https://satisfactory.wiki.gg/wiki/Electric_Locomotive)“, „[Freight Car](https://satisfactory.wiki.gg/wiki/Freight_Car)“.

### Verifizierte Mechaniken

1. **Blöcke:** Ein Block ist der Gleisbereich zwischen Signalen. Ein Block mit einem beliebigen Teil eines Zuges ist belegt.
2. **Signalrichtung:** Ein Signal gilt für die Fahrtrichtung, in die es zeigt. *Ist an einer Verbindung nur ein Signal vorhanden, können Züge in Gegenrichtung dort nicht durchfahren.* Für Zweirichtungsbetrieb sind Signale in beiden Richtungen nötig.
3. **Höchstens zwei Signale je Gleisverbindung**, in entgegengesetzte Richtungen.
4. **Ein- und Ausfahrsignale:** Jeder Block braucht mindestens ein Einfahrsignal und mindestens ein Ausfahrsignal. Das Ausfahrsignal ist zugleich das Einfahrsignal des nächsten Blocks. **Alle Einfahrsignale eines Blocks müssen denselben Typ haben** (alle Block- oder alle Pfadsignale). Für Ausfahrsignale gilt das nicht.
5. **Fehlerzustände** der Signale im Spiel: „Signal hat fehlende Verbindungen“ (am Gleisende), „Block hat kein Ausfahrsignal“, „Block hat widersprüchliche Einfahrsignaltypen“, „Pfadblock darf keine Bahnhöfe enthalten“, „Signal läuft in sich selbst“ (teilt den Block nicht).
6. **Blocksignal:** Grün, wenn der folgende Block frei ist. Nach einem Fehler im Spiel können bei mehreren Einfahrsignalen mehrere Züge gleichzeitig einfahren und kollidieren. Das Wiki empfiehlt deshalb Pfadsignale an Zusammenführungen.
7. **Pfadsignal:** Reserviert einen Pfad durch den Block. Mehrere Züge können einfahren, wenn sich ihre Pfade nicht kreuzen. Ein Zug fährt nur ein, wenn er den Block auch wieder verlassen kann („Path in, block out“). Pfadblöcke sollten wegen eines Fehlers im Spiel eben sein.
8. **Geometrische Kreuzungen:** Gleise, die sich berühren oder durchdringen, gehören zum selben Block, auch ohne Verbindung an den Enden. Seit 1.2 ist die Gleis-Hitbox kleiner (genauer Wert nicht dokumentiert).
9. **Wegfindung** (Wiki „Electric Locomotive – Pathfinding“): Kürzester Weg zum nächsten Halt, keine Umleitung bei Belegung. Ein durchfahrener Bahnhof, der nicht im Fahrplan steht, kostet +100 m, wenn er in Fahrtrichtung zeigt. Bei gleicher Länge gewinnt der Weg mit weniger Gleisteilen; führt er durch einen solchen Bahnhof, zählen seine Gleisteile als 0. Danach entscheidet die Weiche: links vor Mitte vor rechts. Bauweise und Signale ändern die Wegwahl nicht, nur die Durchfahrbarkeit: Züge fahren nicht an der Rückseite eines Signals vorbei, falsch gesetzte Signale können ein Ziel unerreichbar machen. *Umsetzung:* Längen bis 5 cm Unterschied gelten als gleich (Bogenlängen sind Näherungen).
10. **Bahnhöfe** sind gerichtet: Züge halten nur in Fahrtrichtung des Bahnhofs, abfahren können sie in beide Richtungen. Bahnsteige liegen *hinter* dem Bahnhofsgebäude; jeder Wagen steht an einem Bahnsteig (Länge 16 m).
11. **Zweirichtungszüge:** Nur mit einer rückwärts gerichteten Lok. Sie wird nur genutzt, wenn die vordere Lok das Ziel nicht erreicht. Mit Schleifen im Netz kann sich die Wagenreihenfolge umkehren.
12. **Güterbahnsteige** funktionieren nur, wenn der Zug in Vorwärtsrichtung einen gültigen Weg hat.
13. **Umschlag:** 27,08 s je Halt (Docs: 27 s), alle Wagen gleichzeitig; Bänder am Bahnsteig pausieren währenddessen.
14. **Maße und Grenzen:** Wagen und Lok 16 m; Gleissegment 12–100 m; kleinster Kurvenradius 17 m (90°-Kurve); Lok max. 120 km/h (eben); Wagen 32 Stapel bzw. 2400 m³ (seit 1.2).
15. **Zugkraft** (Wiki „Freight Car – Weight“, „Electric Locomotive“): Lok 300 t, Wagen leer 30 t, voll 100 t. Höchste Zugmasse je Lok (inkl. Lok): 1-m-Rampe (12,5 %) 1644 t, 2-m-Rampe (25 %) 800 t, 4-m-Rampe (50 %) 580 t – also 13 / 5 / 2,8 volle Wagen je Lok. Eben zieht eine Lok etwa 100 leere Wagen. Loks an jeder Stelle des Zuges helfen mit; *Annahme:* die zulässige Masse wächst linear mit der Zahl der Loks.
16. **Halteeinstellungen:** Je Halt wird alles, nichts oder nur eine Auswahl von Gegenständen umgeschlagen (Wiki „Electric Locomotive – Stop settings“).

### Was die statische Prüfung **nicht** leisten kann

- Sie **schließt Deadlocks nicht aus.** Gegenseitiges Blockieren hängt von Zuglängen, Abfahrtszeiten, Wartebedingungen und Belegung ab.
- Bremswege, Steigungsleistung, Beschleunigung und Kurvenverhalten werden nicht physikalisch berechnet.
- Ob eine Kurve im Spiel baubar ist, wird nur über den Mindestradius geprüft. Laut Wiki meldet das Spiel beim Verbinden vorhandener Gleise teils auch bei größeren Radien „zu eng“.

## 5. Regelkatalog

Spalten: **Art** (Spielregel / Empfehlung / nicht geprüft), **Gewissheit** (statisch nachweisbar / möglich, d. h. von Zuglängen, Belegung oder Abläufen abhängig).

### Fabrik (umgesetzt)

| ID | Titel | Art | Gewissheit | Schwere | Quelle |
|---|---|---|---|---|---|
| FAB-001 | Kollisionsboxen überschneiden sich | Spielregel | statisch | Fehler | Spieldaten `mClearanceData` |
| FAB-002 | Weiche Freihaltezone überschneidet sich | nicht geprüft | statisch | Warnung | Spieldaten (`CT_Soft`), Verhalten unbekannt |
| FAB-003 | Gebäude außerhalb der Baufläche | Empfehlung | statisch | Warnung | eigene Vorgabe |
| FAB-004 | Gebäude im Planungsabstand | Empfehlung | statisch | Warnung | eigene Vorgabe |
| FAB-005 | Anschlusslagen sind schematisch | nicht geprüft | statisch | Hinweis | fehlende Spieldaten |
| FAB-006 | Baubarkeit von Leitungen nicht geprüft | nicht geprüft | statisch | Hinweis | Einschränkung des Planers |
| FAB-007 | Gebäude höher als das Stockwerk | Empfehlung | statisch | Warnung | Spieldaten (Höhe) |
| FAB-008 | Geplante Maschinen ohne Platz im Grundriss | Empfehlung | statisch | Hinweis | Planungsstand |
| FAB-009 | Produktionsgebäude ohne Rezept | Empfehlung | statisch | Hinweis | Planungsstand |
| FAB-010 | Gebäudetyp nicht im Spieldatensatz | Spielregel | statisch | Fehler | Datensatz |
| FAB-011 | Leitung zu klein für den benötigten Durchsatz | Spielregel | statisch | Warnung | Spieldaten (Bandstufe), Durchsatzmodell |
| FAB-012 | Maschine wird nicht vollständig versorgt | Spielregel | statisch | Warnung | Rezepte, Durchsatzmodell |
| FAB-013 | Produkt wird nicht abgeführt | Spielregel | statisch | Warnung | Spielverhalten, Durchsatzmodell |
| FAB-014 | Gegenstand wird am Ziel nicht verarbeitet | Spielregel | statisch | Warnung | Durchsatzmodell |
| FAB-015 | Durchsatzmodell vereinfacht | nicht geprüft | statisch | Hinweis | Einschränkung des Planers |
| FAB-016 | Förderhöhe von Rohren nicht geprüft (Quelle ohne bekannte Förderhöhe) | nicht geprüft | statisch | Hinweis | Spieldaten (Pumpen 20/50 m), Wiki „Head lift“ |
| FAB-017 | Senkrechte Leitung durchquert ein Stockwerk | Empfehlung | statisch | Hinweis | eigene Vorgabe |
| FAB-018 | Höhenwechsel ohne senkrechten Abschnitt | nicht geprüft | statisch | Hinweis | Einschränkung des Planers |
| FAB-019 | Förderhöhe reicht nicht | Spielregel | statisch | Warnung | Wiki „Head lift“, „Pipeline Pump“ |

**Durchsatzmodell (Etappe 5):** lineares Programm je Fabrik über die eingezeichneten Verbindungen. Maschinen laufen mit einer Auslastung 0…1; Zutaten fließen im Rezeptverhältnis zu; jeder Ausgang muss vollständig abfließen; Splitter, Zusammenführungen, Rohrkreuzungen, Pumpen, Ventile und Lager mit Abgang erhalten die Menge je Gegenstand. Es wird einmal ohne und einmal mit Kapazitätsgrenzen gerechnet. **Annahmen:** bestmögliche Verteilung an Splittern (im Spiel gleichmäßig mit Überlauf), keine Filter, Rohrfluss in Zeichenrichtung, keine Förderhöhe, Kraftwerksverbrauch nicht modelliert, Zuordnung der Produkte zu Ausgängen in Rezeptreihenfolge.

### Schiene (Etappe 3)

| ID | Titel | Art | Gewissheit | Schwere | Quelle (Mechanik Nr.) |
|---|---|---|---|---|---|
| RAIL-001 | Signal ohne Gleis auf einer Seite | Spielregel | statisch | Fehler | 5 |
| RAIL-002 | Block ohne Ausfahrsignal | Spielregel | statisch | Fehler | 4, 5 |
| RAIL-003 | Widersprüchliche Einfahrsignaltypen | Spielregel | statisch | Fehler | 4, 5 |
| RAIL-004 | Bahnhof in einem Pfadblock | Spielregel | statisch | Fehler | 5, 7 |
| RAIL-005 | Signal teilt den Block nicht | Spielregel | statisch | Fehler | 5 |
| RAIL-006 | Zu viele bzw. gleichgerichtete Signale an einer Verbindung | Spielregel | statisch | Fehler | 3 |
| RAIL-007 | Fahrziel nicht erreichbar | Spielregel | statisch | Fehler | 2, 9, 10, 11 |
| RAIL-008 | Keine Weiterfahrt hinter dem Bahnhof | Spielregel | statisch | Warnung | 12 |
| RAIL-009 | Kreuzende Gleise bilden einen gemeinsamen Block | Spielregel | statisch | Hinweis | 8 |
| RAIL-010 | Blocksignale an einer Zusammenführung | Empfehlung | statisch | Warnung | 6 |
| RAIL-011 | Pfadblock nicht eben | Empfehlung | statisch | Warnung | 7 |
| RAIL-012 | Kurvenradius unter 17 m | Spielregel | statisch | Warnung | 14 |
| RAIL-013 | Segmentlänge außerhalb 12–100 m | Spielregel | statisch | Warnung | 14 |
| RAIL-014 | Mehrere Züge ohne Signale im Netz | Spielregel | statisch | Warnung | 1, 6 |
| RAIL-020 | Block nach Pfadblock kürzer als der Zug | Empfehlung | möglich | Warnung | 7 |
| RAIL-021 | Zug länger als der Bahnhof | Empfehlung | möglich | Warnung | 10 |
| RAIL-022 | Wagen ohne passenden Bahnsteig | Empfehlung | statisch | Hinweis | 10 |
| RAIL-023 | Zweirichtungszug in Netz mit Wendemöglichkeit | Empfehlung | möglich | Warnung | 11 |
| RAIL-024 | Deadlocks statisch nicht ausschließbar | nicht geprüft | möglich | Hinweis | Einschränkung |
| RAIL-025 | Zu wenige Loks für Steigung und Zuglast (voll beladen, steilste Steigung der Fahrwege) | Empfehlung | möglich | Warnung | 15 |

Die Regeln RAIL-020 bis RAIL-024 werden ausdrücklich als **mögliche** Probleme ausgewiesen. Sie sind kein Nachweis eines Fehlers.

**Signale auf freiem Gleis:** Ein Signal auf einem Segment teilt es wie im Spiel; frei gesetzte Signale brauchen laut Wiki mindestens 12 m Abstand zum Segmentende, sonst setzt der Editor das Signal an den nächsten Knoten. Die Seite neben dem Gleis bestimmt die Fahrtrichtung (Signal steht rechts der Fahrtrichtung).

### Simulation (Etappe 7)

Konstante Durchschnittsgeschwindigkeit (Annahme, einstellbar), Blocksignal: Einfahrt nur in freien, nicht reservierten Block; Pfadsignal: Reservierung des Wegs durch die Pfadblöcke bis zum nächsten gewöhnlichen Block, der frei sein muss (Mechanik 7); Halte mit Umschlagzeit (Mechanik 13) plus Wartezeit; Wegwahl wie im Spiel (Mechanik 9); Zweirichtungszüge fahren nur rückwärts ab, wenn vorwärts kein Weg existiert (Mechanik 11). Start: Jeder Zug steht am ersten freien Halt seines Fahrplans; gibt es mehr Züge als freie Halte, beginnt er an einer zufälligen freien Stelle (kein Bahnhofsgleis, möglichst freier Block), von der aus er seinen ersten Halt erreicht. Der Zufall ist je Zug fest, damit Läufe vergleichbar bleiben. Erkannt werden Deadlocks als zyklisches Warten und Kollisionen (nur ohne ausreichende Signale). **Ein Lauf ohne Deadlock ist kein Nachweis**, dass keiner auftreten kann.

### Transport (Etappe 6)

| ID | Titel | Art | Gewissheit | Schwere | Quelle |
|---|---|---|---|---|---|
| TRN-001 | Transportauftrag ohne Zug | Empfehlung | statisch | Warnung | Planungskonsistenz |
| TRN-002 | Zug hält nicht am Lade- oder Entladebahnhof | Empfehlung | statisch | Fehler | Planungskonsistenz |
| TRN-003 | Geschätzte Zugkapazität reicht nicht | Empfehlung | möglich | Warnung | Wiki „Freight Car“, „Freight Platform“ |
| TRN-004 | Bahnhof gehört nicht zur Fabrik des Auftrags | Empfehlung | statisch | Warnung | Planungskonsistenz |
| TRN-005 | Importbedarf ohne ausreichenden Transportauftrag | Empfehlung | statisch | Warnung | Planungskonsistenz |
| TRN-006 | Lieferfabrik erzeugt zu wenig | Empfehlung | statisch | Warnung | Planungskonsistenz |
| TRN-007 | Kein passender Wagen für den Gegenstand | Spielregel | statisch | Fehler | Wiki „Freight Car“ |
| TRN-008 | Zugdurchsatz ist eine Schätzung | nicht geprüft | möglich | Hinweis | Annahmen des Planers |
| TRN-009 | Keine passende Frachtplattform im Grundriss | Empfehlung | statisch | Hinweis | Planungskonsistenz |
| TRN-010 | Halt schließt den Gegenstand vom Umschlag aus | Spielregel | statisch | Fehler | Wiki „Electric Locomotive“ (Stop settings) |

Schätzung: Kapazität je Umlauf = Wagen × 32 Stapel × Stapelgröße (Feststoffe) bzw. Wagen × 2400 m³; Umlaufzeit = Summe der kürzesten Wege des Fahrplans / Ø-Geschwindigkeit + je Halt Umschlag (27,08 s) + Wartezeit. Gemessene Umlaufzeiten aus der Simulation oder ein manueller Wert ersetzen die Schätzung.

**Transportmittel:** Jeder Auftrag fährt per Zug, Fahrzeug oder direkter Leitung. TRN-001 bis TRN-010 gelten für Zugaufträge.

| Mechanik | Wert | Quelle |
|---|---|---|
| Fahrzeug-Laderaum | Schlepper 25, Lkw 48, Explorer 12 Stapel (`mInventorySize`); Tanklaster 3200 m³ | Spieldaten; Tanklaster Wiki „Truck“ |
| Höchstgeschwindigkeit | Schlepper 69, Lkw und Tanklaster 89, Explorer 107 km/h | Wiki „Tractor“, „Truck“, „Explorer“ |
| Andocken an Lkw-/Tanklaster-Station | 8 s je Fahrzeug | Wiki „Truck Station“ |
| Fahrzeugschätzung | Laderaum × Anzahl je Umlauf; Umlauf = 2 × Strecke / Geschwindigkeit + 2 × 8 s; ohne eigene Angabe Höchstgeschwindigkeit (optimistisch) | abgeleitet |
| Direkte Leitung | Kapazität = Stufe × Anzahl paralleler Leitungen; im Durchsatzmodell als Zu- bzw. Abfluss am gewählten Anschluss | Spieldaten (Band-/Rohrstufen) |

| ID | Titel | Art | Gewissheit | Schwere | Quelle |
|---|---|---|---|---|---|
| TRN-011 | Transportmittel passt nicht zum Gegenstand | Spielregel | statisch | Fehler | Spieldaten, Wiki |
| TRN-012 | Fahrzeugauftrag ohne Fahrzeug | Empfehlung | statisch | Warnung | Planungskonsistenz |
| TRN-013 | Geschätzte Fahrzeugkapazität reicht nicht | Empfehlung | möglich | Warnung | Spieldaten, Wiki „Truck Station“ |
| TRN-014 | Leitungen zwischen den Fabriken zu klein | Spielregel | statisch | Warnung | Spieldaten |
| TRN-015 | Keine Übergabe im Grundriss (Lkw-Station bzw. Übergabeanschluss) | Empfehlung | statisch | Hinweis | Planungskonsistenz |

*Nicht berechnet:* Treibstoffverbrauch der Fahrzeuge, Förderhöhe von Rohren zwischen Fabriken, Fahrwege der Fahrzeuge (die Strecke wird angegeben).

### Produktion (umgesetzt)

| ID | Titel | Art | Gewissheit | Schwere | Quelle |
|---|---|---|---|---|---|
| PROD-001 | Produktionsziel nicht erreichbar (mit Ursache) | Spielregel | statisch | Fehler | Rezepte aus Spieldaten |
| PROD-002 | Engpass: Versorgung oder Maschinen ausgeschöpft | Empfehlung | statisch | Warnung | Rezepte aus Spieldaten |
| PROD-003 | Fabrik hat weniger Maschinen als der Plan | Empfehlung | statisch | Hinweis | Abgleich Plan ↔ Fabrik |
| PROD-004 | Produktionsplan nicht lösbar (z. B. unbeschränkte Maximierung) | Spielregel | statisch | Fehler | Vorgaben des Plans |
