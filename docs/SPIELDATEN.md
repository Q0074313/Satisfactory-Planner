# Spieldaten

## Unterstützte Version

| Datensatz | Spielversion | Engine | Quelle |
|---|---|---|---|
| `sf-1.2.4.0` | **1.2.4.0** (Branch `rel-main-anniversary-2026`, Changelist 502094); Docs von 1.2.4.1 und 1.2.5.0 inhaltlich identisch | UE 5.6.1 | Lokale Steam-Installation, `CommunityResources/Docs` |

Entscheidung: Unterstützt wird die **aktuell installierte stabile Version 1.2.4.0**. Ältere Datensätze (1.0, 1.1) werden nicht mitgeliefert. Der Aufbau unterstützt aber mehrere Datensätze nebeneinander (`data/gamedata/<version>/`), und jedes Projekt merkt sich seinen Datensatz.

## Quellen

1. **Satisfactory Docs** (`CommunityResources/Docs/en-US.json`, `de.json`). Coffee Stain Studios legt diese Dateien jeder Spielinstallation für Community-Werkzeuge bei.
   - Inhalt: Gegenstände, Rezepte, Gebäude (Leistung, Takt, Somersloop-Slots, Kollisionsboxen, Fördergeschwindigkeiten, Pumpenhöhen, Fundamentmaße, Bahnsteig-Ladezeiten) und deutsche Namen.
   - Lizenz: **kein ausdrücklicher Lizenztext.** Alle Rechte liegen bei Coffee Stain Studios. Die Nutzung in Community-Werkzeugen ist üblich und vom Hersteller vorgesehen. Für eine öffentliche Weiterverteilung der extrahierten Daten sollte die Lage vor dem Onlinebetrieb noch einmal geprüft werden (siehe offene Punkte).
   - Prüfsumme der verwendeten `en-US.json` steht in `EXTRAKTION.md`.
2. **Satisfactory Wiki** (satisfactory.wiki.gg), Lizenz **CC BY-NC-SA 3.0**. Übernommen werden nur einzelne Faktenangaben mit Seitenverweis, keine Texte:
   - Anschlusszahlen aus Infoboxen (`curated/wiki-infobox.json`, automatisch abgerufen),
   - kuratierte Einzelwerte (`curated/facts.json`): Zuglängen, Kapazitäten, Kurvenradius, Reinheitsfaktoren, Rohstoffmaxima, Zugmassen und Zugkraft je Steigung (Wiki „Freight Car“, „Electric Locomotive“), Förderhöhen ohne Pumpe (Wiki „Head lift“), Fahrzeuggeschwindigkeiten, Tanklaster-Inhalt und Andockzeit an Lkw-Stationen (Wiki „Truck“, „Tractor“, „Explorer“, „Truck Station“).
   - Drohnen: Geschwindigkeit je Brennstoff und Dauer von Start bzw. Landung (Wiki „Drone“) in `curated/facts.json`; Laderaum und Energiebedarf je Umlauf aus den Docs (Fakten `drone.*`).
   - Straßenfahrzeuge (`vehicles` im Datensatz): Laderaum aus den Docs (`FGVehicleDescriptor.mInventorySize`, `mIsFluidStorageInventory`), deutsche Namen aus `de.json`; aufgenommen werden nur Fahrzeuge mit kuratierter Geschwindigkeit (Schlepper, Lkw, Tanklaster, Explorer).
3. **Abgeleitete Kraftwerksrezepte** (`Power_<Kraftwerk>_<Brennstoff>`): aus `mFuel`, `mPowerProduction`, `mSupplementalToPowerRatio` und dem Energiewert des Brennstoffs berechnet (ein Zyklus = 1 min bei 100 % Takt). Erdwärmekraftwerk nicht (kein Brennstoff).
4. **Kartendaten** (`data/gamedata/<version>/map.json`, Skript `npm run gamedata:map`): Lage, Rohstoff und Reinheit aller Rohstoffvorkommen (Nodes, Satelliten der Rohstoffquellen, Geysire) aus der interaktiven Karte von **satisfactory-calculator.com** (Datei `mapData/en-Stable.json`, Datenstand und Spielbuild der Quelle in `meta`, SHA-256 der Rohdaten in `meta.notes`). Übernommen werden nur diese Fakten über die Spielwelt; Koordinaten in Metern (Spiel: Zentimeter). Die Mitte einer Rohstoffquelle nennt die Quelle nicht – sie ist aus den Satelliten gemittelt. Anzahl je Rohstoff und Reinheit stimmt mit dem Wiki überein (z. B. Eisenerz 39/42/46), im Test geprüft.
   - Lizenz: kein ausdrücklicher Lizenztext. Die Spielwelt liegt nicht in den Docs-Dateien, sondern nur in den Spielpaketen; eine eigene Extraktion daraus ist aufwendig (UE-5.6-IoStore). Die Quelle wurde auf ausdrücklichen Wunsch des Nutzers gewählt.
   - **Kartenbild:** Die Kacheln (Spielkarte und realistische Ansicht) liegen **nicht** im Repository und nicht auf dem Server. Der Browser lädt sie zur Laufzeit direkt von `static.satisfactory-calculator.com` (ohne Referrer, CSP erlaubt nur diesen Bildhost). Kachelraster laut Kartencode der Quelle: Spielbereich West −3247 m, Ost 4253 m, Nord −3750 m, Süd 3750 m; Gesamtbild 32 768 px plus 4096 px Rand je Seite bei Zoomstufe 8, Kacheln 256 px, Zoomstufen 3–8. Ohne Internet zeigt die Karte nur Raster und Vorkommen.
5. **Spielpakete der lokalen Installation** (seit 0.8, `curated/ports-game.json`, Werkzeug `packages/gamedata-tools/ports`): Lage, Höhe und Austrittsrichtung der Band- und Rohranschlüsse aller Gebäude, ausgelesen aus den Komponentenvorlagen der Blueprints (`FGFactoryConnectionComponent`, `FGPipeConnectionComponent`, `FGPipeConnectionFactory`; `RelativeLocation`, `RelativeRotation.Yaw`, `mDirection`, `mPipeConnectionType`). Vererbte Komponenten (z. B. Miner Mk.3 von Mk.2) werden über die Oberklasse aufgelöst.
   - Werkzeug: kleines .NET-Programm mit [CUE4Parse](https://github.com/FabianFG/CUE4Parse) (Lizenz Apache 2.0), liest `FactoryGame-Windows.utoc/.ucas` mit der mitgelieferten `CommunityResources/FactoryGame.usmap`. Diese speichert `OptionalProperty` ohne inneren Typ; das Werkzeug ergänzt ihn vor dem Laden (betrifft keine Gebäude). Oodle für die Entpackung lädt CUE4Parse beim ersten Lauf herunter.
   - Übernommen werden nur Lage und Richtung der Anschlüsse (cm → m), keine Modelle, Texturen oder sonstigen Inhalte. Lizenz wie die Docs: Bestandteil der Spielinstallation, alle Rechte bei Coffee Stain Studios.
   - Zuordnung zu den Anschluss-IDs des Planers: je Art und Richtung nach Komponentennamen sortiert (`Input0`, `Input1` …). Richtungsfreie Rohranschlüsse von Flüssigkeitspuffern füllen deren Ein- und Ausgang. Weicht die Anzahl von der Anschlusszahl ab, bleibt das Gebäude schematisch (Eintrag im Extraktionsbericht). Derzeit haben alle 43 Gebäude mit Anschlüssen Lagen.
   - Stand: ausgelesen aus Spielversion 1.2.4.1 (Changelist 513885). Die Docs dieser Version sind mit 1.2.4.0 identisch (gleiche Prüfsumme), der Datensatz heißt weiter `sf-1.2.4.0`.
6. **Manuelle Ergänzung** (`curated/ports-overrides.json`): nur dort, wo keine Quelle verfügbar war. Immer als `unverified` gekennzeichnet. Der dort ergänzte Rohreingang am Treibstoffgenerator ist inzwischen durch die Spielpakete bestätigt.

6. **Schaltpläne** (seit 0.9, `schematics` im Datensatz): aus den Docs (`FGSchematic`: `mType`, `mTechTier`, `mUnlocks` mit `BP_UnlockRecipe_C` bzw. `BP_UnlockSchematic_C`, `mSchematicDependencies`). Gebäude über ihre Baurezepte (Produkt `Desc_X` → Gebäude `Build_X`). M.A.M.-Bäume aus dem Ordnernamen (`Research/<Baum>_RS/`); die saisonale FICSMAS-Forschung entfällt. Phase des Weltraumlifts → höchstes Tier aus dem Wiki („Space Elevator“, „Milestones“) als kuratierte Fakten `progress.phase.<n>.maxTier`.
7. **Spielstände** (seit 0.9, nur beim Import im Browser): gelesen mit [@etothepii/satisfactory-file-parser](https://github.com/etothepii4/satisfactory-file-parser) (MIT), Version 4.1.2, unterstützt Spielstände ab Update 8 bis 1.2. Weltraster aus Spielständen nachgemessen: Fundament-Mitten liegen auf Vielfachen von 8 m (≈ 1400 von 1700 Fundamenten eines Testspielstands genau dort). Ursprung eines Fundaments ist seine Mitte; Gebäude stehen auf Mitte + halber Fundamenthöhe.

## Was fehlt bzw. unsicher ist

| Thema | Status | Umgang im Planer |
|---|---|---|
| Gelände, Höhenlinien als Daten | nur als Bild der Quelle | nicht geprüft (MAP-008) |
| Lage der Quellenmitten | nicht in der Quelle | aus den Satelliten gemittelt |
| Ursprung von Minern relativ zum Vorkommen | nicht dokumentiert | Annahme: Gebäudeursprung über der Mitte des Vorkommens (MAP-002 mit 8 m Toleranz) |
| Lage der Anschlüsse an Gebäuden | nicht in Docs, nicht im Wiki; seit 0.8 aus den Spielpaketen | `portLayout` je Gebäude; ohne Angabe schematisch (FAB-005) |
| Verhalten weicher Kollisionsboxen | unbekannt | Warnung FAB-002 statt Fehler |
| Gleis-Hitbox seit 1.2 | Wert nicht dokumentiert | Kreuzungsprüfung mit vorsichtiger Höhenschwelle, als Annahme markiert |
| Signal-Kollisionsboxen | in Docs leer | Signale ohne Grundfläche |
| Variable Leistung | nur Spanne bekannt | Mittelwert als Annahme |
| Phase ↔ Tier | nicht in den Docs | Wiki „Space Elevator“ (kuratiert) |
| Wirkrichtung von Signalen im Spielstand | `mGuardedConnections` ohne Doku | gilt für Züge, die das geschützte Gleis verlassen (am Spielstand geprüft: nur so findet der Zug seinen Fahrweg) |
| Maße Bahnhof / Bahnsteig | Docs: 16 × 34 m (Gleisachse = lokale x-Achse, 16 m = Wagenlänge laut Wiki) | Gleisachse aus Wiki „Freight Car“ abgeleitet |

## Aktualisierung bei einem Spiel-Update

```bash
# 1. Docs neu einlesen (Pfad zur Installation ggf. anpassen)
npm run gamedata:extract -- --game "~/.steam/steam/steamapps/common/Satisfactory"
# 2. Anschlusszahlen aus dem Wiki aktualisieren (Netzwerk nötig)
npm run gamedata:wiki -- --data data/gamedata/<version>/gamedata.json
# 3. Erneut extrahieren, damit die Wiki-Daten einfließen
npm run gamedata:extract
# 2a. Anschlusslagen aus den Spielpaketen (.NET-SDK 10 nötig, z. B. in ~/.local/share/dotnet)
npm run gamedata:ports
# 3a. Rohstoffvorkommen der Karte abrufen (Netzwerk nötig)
npm run gamedata:map -- --version <version>
# 4. EXTRAKTION.md prüfen (Abweichungen, abgeleitete Anschlüsse), Tests ausführen
npm test
```

Dabei entsteht ein **neuer** Ordner `data/gamedata/<neue version>/`. Bestehende Projekte behalten ihren Datensatz, bis sie bewusst migriert werden. Der Wechsel des Datensatzes ist für Etappe 7 vorgesehen: Abgleich der Klassennamen, Bericht über entfernte oder geänderte Rezepte und Gebäude als Befunde.

## Format

Typdefinition: [`packages/core/src/gamedata/types.ts`](../packages/core/src/gamedata/types.ts) (`GAMEDATA_SCHEMA_VERSION = 1`). Einheiten: Meter, Sekunden, m³, MW. IDs sind die Klassennamen der Docs.

## Demonstrationsdaten

Es werden **keine** Demonstrationsdaten verwendet. Der Datensatz enthält dafür das Feld `meta.isDemo`. Ein Demo-Datensatz müsste es auf `true` setzen, und die Oberfläche würde ihn dann deutlich kennzeichnen.
