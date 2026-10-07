# Spieldaten

## Unterstützte Version

| Datensatz | Spielversion | Engine | Quelle |
|---|---|---|---|
| `sf-1.2.4.0` | **1.2.4.0** (Branch `rel-main-anniversary-2026`, Changelist 502094) | UE 5.6.1 | Lokale Steam-Installation, `CommunityResources/Docs` |

Entscheidung: Unterstützt wird die **aktuell installierte stabile Version 1.2.4.0**. Ältere Datensätze (1.0, 1.1) werden nicht mitgeliefert. Der Aufbau unterstützt aber mehrere Datensätze nebeneinander (`data/gamedata/<version>/`), und jedes Projekt merkt sich seinen Datensatz.

## Quellen

1. **Satisfactory Docs** (`CommunityResources/Docs/en-US.json`, `de.json`). Coffee Stain Studios legt diese Dateien jeder Spielinstallation für Community-Werkzeuge bei.
   - Inhalt: Gegenstände, Rezepte, Gebäude (Leistung, Takt, Somersloop-Slots, Kollisionsboxen, Fördergeschwindigkeiten, Pumpenhöhen, Fundamentmaße, Bahnsteig-Ladezeiten) und deutsche Namen.
   - Lizenz: **kein ausdrücklicher Lizenztext.** Alle Rechte liegen bei Coffee Stain Studios. Die Nutzung in Community-Werkzeugen ist üblich und vom Hersteller vorgesehen. Für eine öffentliche Weiterverteilung der extrahierten Daten sollte die Lage vor dem Onlinebetrieb noch einmal geprüft werden (siehe offene Punkte).
   - Prüfsumme der verwendeten `en-US.json` steht in `EXTRAKTION.md`.
2. **Satisfactory Wiki** (satisfactory.wiki.gg), Lizenz **CC BY-NC-SA 3.0**. Übernommen werden nur einzelne Faktenangaben mit Seitenverweis, keine Texte:
   - Anschlusszahlen aus Infoboxen (`curated/wiki-infobox.json`, automatisch abgerufen),
   - kuratierte Einzelwerte (`curated/facts.json`): Zuglängen, Kapazitäten, Kurvenradius, Reinheitsfaktoren, Rohstoffmaxima, Zugmassen und Zugkraft je Steigung (Wiki „Freight Car“, „Electric Locomotive“), Förderhöhen ohne Pumpe (Wiki „Head lift“), Fahrzeuggeschwindigkeiten, Tanklaster-Inhalt und Andockzeit an Lkw-Stationen (Wiki „Truck“, „Tractor“, „Explorer“, „Truck Station“).
   - Straßenfahrzeuge (`vehicles` im Datensatz): Laderaum aus den Docs (`FGVehicleDescriptor.mInventorySize`, `mIsFluidStorageInventory`), deutsche Namen aus `de.json`; aufgenommen werden nur Fahrzeuge mit kuratierter Geschwindigkeit (Schlepper, Lkw, Tanklaster, Explorer).
3. **Manuelle Ergänzung** (`curated/ports-overrides.json`): nur dort, wo keine Quelle verfügbar war. Immer als `unverified` gekennzeichnet (derzeit: ein Rohreingang am Treibstoffgenerator).

## Was fehlt bzw. unsicher ist

| Thema | Status | Umgang im Planer |
|---|---|---|
| Lage der Anschlüsse an Gebäuden | nicht in Docs, nicht im Wiki | schematisch, Hinweis FAB-005, Kennzeichen „schematisch“ |
| Verhalten weicher Kollisionsboxen | unbekannt | Warnung FAB-002 statt Fehler |
| Gleis-Hitbox seit 1.2 | Wert nicht dokumentiert | Kreuzungsprüfung mit vorsichtiger Höhenschwelle, als Annahme markiert |
| Signal-Kollisionsboxen | in Docs leer | Signale ohne Grundfläche |
| Variable Leistung | nur Spanne bekannt | Mittelwert als Annahme |
| Maße Bahnhof / Bahnsteig | Docs: 16 × 34 m (Gleisachse = lokale x-Achse, 16 m = Wagenlänge laut Wiki) | Gleisachse aus Wiki „Freight Car“ abgeleitet |

## Aktualisierung bei einem Spiel-Update

```bash
# 1. Docs neu einlesen (Pfad zur Installation ggf. anpassen)
npm run gamedata:extract -- --game "~/.steam/steam/steamapps/common/Satisfactory"
# 2. Anschlusszahlen aus dem Wiki aktualisieren (Netzwerk nötig)
npm run gamedata:wiki -- --data data/gamedata/<version>/gamedata.json
# 3. Erneut extrahieren, damit die Wiki-Daten einfließen
npm run gamedata:extract
# 4. EXTRAKTION.md prüfen (Abweichungen, abgeleitete Anschlüsse), Tests ausführen
npm test
```

Dabei entsteht ein **neuer** Ordner `data/gamedata/<neue version>/`. Bestehende Projekte behalten ihren Datensatz, bis sie bewusst migriert werden. Der Wechsel des Datensatzes ist für Etappe 7 vorgesehen: Abgleich der Klassennamen, Bericht über entfernte oder geänderte Rezepte und Gebäude als Befunde.

## Format

Typdefinition: [`packages/core/src/gamedata/types.ts`](../packages/core/src/gamedata/types.ts) (`GAMEDATA_SCHEMA_VERSION = 1`). Einheiten: Meter, Sekunden, m³, MW. IDs sind die Klassennamen der Docs.

## Demonstrationsdaten

Es werden **keine** Demonstrationsdaten verwendet. Der Datensatz enthält dafür das Feld `meta.isDemo`. Ein Demo-Datensatz müsste es auf `true` setzen, und die Oberfläche würde ihn dann deutlich kennzeichnen.
