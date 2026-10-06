# Satis Planner

Planungswerkzeug für **Satisfactory 1.2**. Es verbindet Produktionsberechnung, maßstabsgetreue Fabrikplanung und Schienennetze in **einem** Projektmodell. Inoffizielles Fan-Projekt, nicht mit Coffee Stain Studios verbunden.

```bash
npm install
npm run dev        # http://localhost:5173
npm test           # Unit-Tests (Vitest)
npm run test:e2e   # Ende-zu-Ende-Tests (Playwright; einmalig: npx playwright install chromium)
npm run build && npm start   # mit Server: Konten, Projekte im Konto, Freigabelinks (vorher .env anlegen, siehe docs/BETRIEB.md)
```

Oberfläche auf Deutsch oder Englisch, hell oder dunkel, mit frei belegbaren Tastenkürzeln (⚙) und geführten Touren (? bzw. F1).

## Stand

| Etappe | Inhalt | Status |
|---|---|---|
| 1 | Architektur, Datenmodell, Spielregeln, Spieldaten 1.2.4.0 | ✅ |
| 2 | Grundgerüst: Grundrisseditor, Autosave, Import/Export, Undo/Redo, Befunde | ✅ |
| 3 | Schieneneditor, Signale, Prüfregeln, Züge, Fahrpläne | ✅ |
| 4 | Produktionsberechnung (LP), Abgleich mit der Fabrik | ✅ |
| – | Verbesserungen: Tutorial, Tastenbelegung, Hell/Dunkel, Sprache, Befunde je Reiter, Bandverlegung, Diagramm, Signale auf Gleis, animierte Züge | ✅ |
| 5 | Fabrikplanung: Durchsatzmodell, Kapazität, Gewinnung, Seitenansicht, Lifte, Gruppen bearbeiten | ✅ |
| 6 | Transportplanung zwischen Fabriken: Aufträge, Zugkapazität, Schätzung, Lücken | ✅ |
| 7 | Zugsimulation, Konten, Freigabelinks, Server, Migrationen, Docker, Spieldatenwechsel | ✅ |

Details und Abnahmekriterien: [docs/ENTWICKLUNGSPLAN.md](docs/ENTWICKLUNGSPLAN.md).

## Dokumentation

- [Architektur](docs/ARCHITEKTUR.md): Module, Stack, Rendering, Ordnerstruktur, Datenfluss
- [Datenmodell](docs/DATENMODELL.md)
- [Spielregeln und Prüfregeln](docs/SPIELREGELN.md), mit Quellen
- [Spieldaten](docs/SPIELDATEN.md): Version, Quellen, Lizenzen, Aktualisierung
- [Entwicklung, Build, Betrieb](docs/BETRIEB.md)

## Tastenkürzel

Alle Kürzel lassen sich unter ⚙ → Tastenkürzel ändern. Standardbelegung:

### Allgemein

| Taste | Funktion |
|---|---|
| Strg+Z / Strg+Y | rückgängig / wiederholen |
| Strg+S / Strg+E / Strg+F | speichern / exportieren / Katalogsuche |
| Alt+1 … Alt+4 | Ansicht Grundriss / Produktion / Schiene / Transport |
| F1 / Strg+, | Tutorial / Einstellungen |

### Grundriss

| Taste | Funktion |
|---|---|
| V / M / A / B / P | Auswahl / Messen / Baufläche / Förderband / Rohr |
| N | Verlegemodus Normal → Gerade → Kurve (beim Zeichnen oder für gewählte Leitungen) |
| R, Umschalt+R | drehen |
| Strg+C / Strg+V / Strg+D | kopieren / einfügen / duplizieren |
| Strg+A | alles auf dem Stockwerk auswählen |
| Entf | löschen |
| U | Aufstellung aufheben (Maschine bleibt geplant) |
| Pfeiltasten (+Umschalt) | um Fangweite (Hauptraster) verschieben |
| Bild↑ / Bild↓ | Stockwerk wechseln (beim Bandzeichnen: Lift) |
| Umschalt+S | Seitenansicht |
| Pos1, + / − | Ansicht einpassen, zoomen |
| Leertaste + Ziehen, rechte/mittlere Maustaste | Ansicht verschieben |
| Alt (gedrückt) | ohne Fangen |

### Schienennetz

| Taste | Funktion |
|---|---|
| V / G / B / P / S / M | Auswahl / Gleis / Blocksignal / Pfadsignal / Bahnhof / Messen |
| Umschalt (Gleiswerkzeug) | gerade Fortsetzung entlang der Tangente |
| R | Bahnhof drehen (beim Setzen und in der Auswahl) |
| F | Achse des gewählten Knotens umkehren |
| T | Zugsimulation starten/anhalten |
| Esc | Gleiszug beenden / Werkzeug verlassen |
