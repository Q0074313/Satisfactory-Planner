# Satis Planner

Planungswerkzeug für **Satisfactory 1.2**. Es verbindet Produktionsberechnung, maßstabsgetreue Fabrikplanung und Schienennetze in **einem** Projektmodell. Inoffizielles Fan-Projekt, nicht mit Coffee Stain Studios verbunden.

Oberfläche auf Deutsch oder Englisch, hell oder dunkel, mit frei belegbaren Tastenkürzeln (⚙) und geführten Touren (? bzw. F1).

## Nutzung

Der Planer läuft vollständig im Browser. Es gibt zwei Betriebsarten:

- **Als App über GitHub (empfohlen):** **https://q0074313.github.io/Satisfactory-Planner/** öffnen. Ohne Server und ohne Konto; Projekte bleiben im Browser auf diesem Rechner (IndexedDB), zur Sicherung oder Weitergabe gibt es den JSON-Export.
  - **Installieren:** In Chrome/Edge über das Symbol in der Adresszeile bzw. Menü → „App installieren“. Der Planer bekommt ein eigenes Fenster und Symbol und läuft danach auch **offline**.
  - **Updates:** Beim Start prüft die App, ob auf GitHub eine neuere Version veröffentlicht ist, und zeigt dann neben der Versionsnummer „Neue Version … – neu laden“. Projekte bleiben dabei erhalten. Stand und „Jetzt prüfen“: ⚙ → Allgemein → Updates.
  - Die Projekte gehören zum Browser: Ein anderer Browser oder Rechner sieht sie nicht (dafür JSON exportieren/importieren). Browserdaten löschen löscht auch die Projekte.
- **Mit eigenem Server:** Ein kleiner Server speichert die Projekte und macht sie über Links von überall erreichbar, siehe [Betrieb auf dem Server](#betrieb-auf-dem-server). Auch hier weist die App auf neue Versionen hin; aktualisieren muss der Betreiber des Servers.

**Projekte und Links (nur mit Server):** Es gibt kein Login. Jedes Projekt (alle Fabriken, Schienennetz, Züge, Transporte) bekommt beim Anlegen eine zufällige ID mit 128 Bit und ist unter `https://<server>/f/<id>` erreichbar. Wer den Link hat, kann das Projekt öffnen und bearbeiten; eine Übersicht aller Projekte gibt es nicht. Der Link steht in der Leiste unter der Kopfzeile (mit „Kopieren“) – als Lesezeichen speichern!

## Lokale Entwicklung

Voraussetzung: Node.js ≥ 22 (siehe [docs/BETRIEB.md](docs/BETRIEB.md#voraussetzungen)). Docker wird lokal **nicht** gebraucht.

```bash
npm install
npm run dev          # nur Web-App: http://localhost:5173 – Projekte lokal im Browser (IndexedDB)
npm test             # Unit- und API-Tests (Vitest)
npm run typecheck    # TypeScript
npm run test:e2e     # Browser-Tests (Playwright; einmalig: npx playwright install chromium)
```

Mit Server (Projekt-Links wie in Produktion):

```bash
npm run dev:server   # Terminal 1: API auf http://localhost:8080, Projekte in ./storage
npm run dev          # Terminal 2: http://localhost:5173 – leitet /api an den Server weiter
```

Ohne laufenden Server arbeitet die App wie bisher rein lokal; erreicht sie einen Server, speichert sie dort.

Produktionsnah ohne Docker: `npm run build && npm start` → http://localhost:8080 (liefert die gebaute App und die API aus).

Eigenständige Ausgabe wie auf GitHub Pages (Offline-Cache, nie ein Server): `SATIS_STANDALONE=1 SATIS_BASE=/Satisfactory-Planner/ npm run build`.

## Veröffentlichen (GitHub)

Eine neue Version erscheint auf GitHub Pages und als Release, sobald ein passender Tag gepusht wird:

```bash
# Version in package.json erhöhen (und APP_VERSION in packages/core/src/project/serialize.ts), committen
git tag v0.10.0                 # muss zur Version in package.json passen
git push github main --tags
```

Der Workflow [.github/workflows/release.yml](.github/workflows/release.yml) prüft Typen und Tests, baut die eigenständige App, stellt sie auf GitHub Pages bereit und legt danach das Release an – gegen dieses vergleicht die Versionsprüfung der App. Einmalig im Repository einstellen: Settings → Pages → Source „GitHub Actions“.

## Betrieb auf dem Server

Optional – für alle, die Projekte zentral speichern und per Link teilen wollen (Speicherung auf dem Server statt im Browser). Läuft auf einem eigenen Linux-Server (z. B. Debian) als Docker-Container. Im Folgenden steht `<benutzer>` für den Benutzer auf dem Server und `<server>` für seine Adresse. Öffentlich erreichbar über **Tailscale Funnel**; der Container-Port ist nur auf `127.0.0.1:8080` gebunden.

```
Internet ──HTTPS──▶ Tailscale Funnel (*.ts.net) ──▶ tailscaled ──▶ 127.0.0.1:8080 ──▶ Container (Node, Benutzer node)
                                                                                        └─ ./storage  (eine JSON-Datei pro Projekt)
```

### Ersteinrichtung (einmalig)

Auf dem Server (einmal mit sudo; danach nicht mehr nötig):

```bash
curl -fsSL https://get.docker.com | sudo sh     # Docker + Compose
sudo apt install -y git
sudo usermod -aG docker <benutzer>               # danach neu anmelden
sudo tailscale set --operator=<benutzer>         # tailscale serve/funnel ohne sudo
```

Git: Das zentrale Repository liegt als Bare-Repo auf dem Server (`~/git/satis-planner.git`).

```bash
# Server: Bare-Repo anlegen
ssh <benutzer>@<server> 'git init --bare -b main ~/git/satis-planner.git'
# Laptop: Remote eintragen und hochladen
git remote add server <benutzer>@<server>:git/satis-planner.git
git push -u server main
# Server: Arbeitskopie klonen und starten
ssh <benutzer>@<server>
git clone ~/git/satis-planner.git ~/satis-planner
cd ~/satis-planner
./update.sh                                     # legt storage/ und backups/ an, baut und startet
tailscale funnel --bg 8080                      # öffentlich freischalten (HTTPS, *.ts.net)
tailscale funnel status                         # zeigt die öffentliche Adresse
```

Der Container startet nach einem Neustart des Servers automatisch (`restart: unless-stopped`), der Funnel ebenso (`--bg`). Abschalten: `tailscale funnel --https=443 off` bzw. `docker compose down`.

Optionale Einstellungen (Port, Limits) in `~/satis-planner/.env`, Vorlage: [.env.example](.env.example).

### Update

Am Laptop entwickeln, committen, `git push server main`. Dann auf dem Server:

```bash
cd ~/satis-planner && ./update.sh
```

`update.sh` sichert zuerst `storage/` nach `backups/storage_<Datum>.tar.gz` (die letzten 10 bleiben, `BACKUP_KEEP` in `.env`), macht `git pull --ff-only`, baut und startet den Container neu (`docker compose up -d --build`) und prüft danach bis zu 90 s lang `http://127.0.0.1:8080/api/health`. Bei einem Fehler bricht es mit einer klaren Meldung ab und zeigt die Logs.

Nützlich: `docker compose logs -f app`, `docker compose ps`, `curl -s localhost:8080/api/health`.

### Backup und Wiederherstellung

- **Daten:** `~/satis-planner/storage/projects/<id>.json` – eine Datei pro Projekt, Dateiname = ID im Link. `storage/` und `backups/` sind nicht im Git.
- **Sicherung von Hand:** `tar -czf backups/storage_$(date +%F_%H%M%S).tar.gz storage` (macht `update.sh` automatisch). Für eine Sicherung außerhalb des Servers `backups/` regelmäßig auf einen anderen Rechner kopieren, z. B. `scp <benutzer>@<server>:satis-planner/backups/*.tar.gz ~/satis-backups/`.
- **Alles zurückspielen:**
  ```bash
  cd ~/satis-planner
  docker compose stop app
  mv storage storage.kaputt-$(date +%F)          # aktuellen Stand aufheben
  tar -xzf backups/storage_<Datum>.tar.gz        # erzeugt storage/
  docker compose start app
  ```
- **Ein einzelnes Projekt zurückspielen:** `tar -xzf backups/storage_<Datum>.tar.gz storage/projects/<id>.json` (überschreibt nur diese Datei; der Container kann dabei laufen).
- Ältere Formate in Sicherungen sind kein Problem: Sie werden beim Laden automatisch migriert (siehe unten).

## Datenformat und Migrationen

Jedes gespeicherte Projekt trägt auf oberster Ebene das Feld **`formatVersion`** (derzeit **4**; definiert als `PROJECT_FORMAT_VERSION` in [packages/core/src/model/schema.ts](packages/core/src/model/schema.ts)). Beim Laden – vom Server, aus IndexedDB oder per JSON-Import – führt die zentrale Funktion `migrateProject()` in [packages/core/src/project/migrations.ts](packages/core/src/project/migrations.ts) ältere Stände Schritt für Schritt ins aktuelle Format über (1→2→3→4 …) und prüft danach das Schema. Gespeichert wird immer im aktuellen Format; auf der Platte bleibt eine alte Datei bis zum nächsten Speichern unverändert.

**Neue Migration hinzufügen** (bei jeder Formatänderung, die alte Daten unlesbar oder falsch machen würde – neue Pflichtfelder, Umbenennungen, geänderte Bedeutung):

1. Schema in `packages/core/src/model/schema.ts` ändern und `PROJECT_FORMAT_VERSION` um 1 erhöhen (z. B. 2 → 3).
2. In `MIGRATIONS` (`packages/core/src/project/migrations.ts`) einen Schritt anhängen:
   ```ts
   {
     from: 2,
     description: 'Kurze Beschreibung der Änderung',   // wird übersetzt → Eintrag in packages/core/src/i18n/en.ts
     migrate(p) {
       // p ist das rohe, untypisierte Projekt im Format 2
       for (const b of Object.values(table(p, 'buildings'))) b.neuesFeld ??= null;
       return p;
     },
   },
   ```
   Schritte arbeiten auf Rohdaten (`Record<string, unknown>`), nie auf dem aktuellen Typ, und setzen `formatVersion` nicht selbst.
3. Testdatei im alten Format ablegen (z. B. `apps/server/test/fixtures/project-v2.json`) und einen Test ergänzen, der sie lädt und die neuen Felder prüft; bestehende Fixtures bleiben (v1 muss weiter über alle Schritte laufen).
4. `npm test` und `npm run test:e2e`; der Export-Test in `e2e/editor.spec.ts` prüft die aktuelle Versionsnummer.

Ein Projekt mit einer **neueren** Version als der Server kennt, wird abgelehnt statt beschädigt („Bitte die Anwendung aktualisieren“).

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
| 7 | Zugsimulation, Server, Migrationen, Docker, Spieldatenwechsel | ✅ |
| 8 | Betrieb auf dem Heimserver: Projekte unter geheimen Links (/f/&lt;id&gt;), Dateiablage, Tailscale Funnel, update.sh | ✅ |
| 0.6 | Weltkarte: Kartenbild, Rohstoffvorkommen, Fabrikstandort im Weltraster, Miner auf Vorkommen, Entfernungen, Standortvorschlag | ✅ |
| 0.7 | Automatisches Fabriklayout (Varianten Reihen/kompakt/Etagen, Prüfung im Durchsatzmodell), Blackbox-Fabriken, Rezepte nachschlagen und vergleichen | ✅ |
| 0.8 | Anschlusslagen aus den Spielpaketen (Lage, Höhe, Richtung), Auto-Layout und Beispiele damit, 3D-Ansicht der Fabrik (nur ansehen; 0.8.1/0.8.2: Namen, Infos beim Überfahren, Flussrichtung animierbar, Fundamentraster, Stockwerk als Schnitt), kürzere Wege und nur nötige Höhen im Auto-Layout, verschiebbare Knoten im Produktionsdiagramm | ✅ |
| 0.9 | Spielstand importieren (Fabriken, Bänder und Rohre, Produktionspläne, Schienennetz mit Zügen, Spielfortschritt; im Browser gelesen), Freischaltung nach Phase/HUB-Tier und M.A.M. (gesperrte Rezepte und Gebäude ausgegraut, in Plänen nicht genutzt), Gebäude selbst setzen und automatisch verbinden, Flüssigkeitspuffer im Auto-Layout, Weltraster um 4 m korrigiert; 0.9.1: Import mit Fundamenten, Signalrichtung geprüft, Gewinnung an ihrer Fabrik, Namen nach Endprodukten; 0.9.2: Rohre in beide Richtungen, Stationen nach Bedarf, Logistikebenen, Gebäude einer anderen Fabrik zuweisen | ✅ |
| 0.10 | Nutzung als App über GitHub: GitHub Pages, installierbar und offline nutzbar, Versionsprüfung gegen die GitHub-Releases (auch mit Server), Veröffentlichung per Tag | ✅ |

Details und Abnahmekriterien: [docs/ENTWICKLUNGSPLAN.md](docs/ENTWICKLUNGSPLAN.md).

## Dokumentation

- [Architektur](docs/ARCHITEKTUR.md): Module, Stack, Rendering, Ordnerstruktur, Datenfluss
- [Datenmodell](docs/DATENMODELL.md)
- [Spielregeln und Prüfregeln](docs/SPIELREGELN.md), mit Quellen
- [Spieldaten](docs/SPIELDATEN.md): Version, Quellen, Lizenzen, Aktualisierung
- [Entwicklung, Build, Betrieb](docs/BETRIEB.md) (Details zu Konfiguration und Sicherheit)
- [CLAUDE.md](CLAUDE.md): Kurzüberblick und Konventionen für die Weiterentwicklung

## Tastenkürzel

Alle Kürzel lassen sich unter ⚙ → Tastenkürzel ändern. Standardbelegung:

### Allgemein

| Taste | Funktion |
|---|---|
| Strg+Z / Strg+Y | rückgängig / wiederholen |
| Strg+S / Strg+E / Strg+F | speichern / exportieren / Katalogsuche |
| Alt+1 … Alt+5 | Ansicht Grundriss / Produktion / Schiene / Transport / Karte |
| F1 / Strg+, | Tutorial / Einstellungen |

### Grundriss

| Taste | Funktion |
|---|---|
| V / M / A / B / P | Auswahl / Messen / Baufläche / Förderband / Rohr |
| B bzw. P erneut | Verlegemodus Normal → Gerade → Kurve (bei aktivem Förderband- bzw. Rohrwerkzeug) |
| N | Stufe Mk.1 → … → Mk.6 (Bänder) bzw. Mk.1 ↔ Mk.2 (Rohre), beim Zeichnen oder für gewählte Leitungen; Stufe und Verlegemodus bleiben für die nächste Benutzung gespeichert |
| Umschalt+N | Verlegemodus gewählter Leitungen |
| O | Pipeline-Pumpe waagrecht → senkrecht ▲ → senkrecht ▼ (beim Setzen und für gewählte Pumpen, auch in der Seitenansicht) |
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

### Karte

| Taste | Funktion |
|---|---|
| Klick / Ziehen | Vorkommen bzw. Fabrik auswählen / Fabrik verschieben (Fundamente im Weltraster, Alt: frei) |
| R, Umschalt+R | gewählte Fabrik (bzw. beim Platzieren) drehen |
| Entf | Fabrik von der Karte nehmen |
| Doppelklick | Fabrikgrundriss öffnen |
| Pos1, + / − | ganze Karte, zoomen |
