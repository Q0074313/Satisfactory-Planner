# Entwicklung, Build und Betrieb

## Voraussetzungen

- **Node.js ≥ 22** (entwickelt mit 24 LTS). Ohne Administratorrechte lässt sich Node z. B. nach `~/.local` entpacken:
  ```bash
  curl -O https://nodejs.org/dist/v24.21.0/node-v24.21.0-linux-x64.tar.xz
  tar xf node-v24.21.0-linux-x64.tar.xz -C ~/.local/share
  ln -s ~/.local/share/node-v24.21.0-linux-x64/bin/{node,npm,npx} ~/.local/bin/
  ```
- Für die Spieldaten-Extraktion: eine lokale Satisfactory-Installation (nur beim Aktualisieren der Spieldaten nötig; der Datensatz liegt im Repository).

## Lokale Entwicklung

```bash
npm install          # Abhängigkeiten aller Workspaces
npm run dev          # Web-App auf http://localhost:5173
npm test             # Unit-Tests (Vitest) für packages/core
npm run typecheck    # TypeScript-Prüfung aller Pakete
npx playwright install chromium   # einmalig
npx playwright test  # Ende-zu-Ende-Tests (startet den Dev-Server selbst)
```

Im Entwicklungsmodus stellt die App `window.__satis` (Stores) für die E2E-Tests bereit. Im Produktions-Build ist das nicht enthalten.

## Build

```bash
npm run build        # Typprüfung + Vite-Build nach apps/web/dist
npm run preview      # Build lokal ansehen
```

Das Ergebnis ist eine **statische Webanwendung**. Die Spieldaten werden als eigener Chunk mitgebaut (ca. 30 kB gzip).

## Betriebsarten

### A) Nur statisch (ohne Server)

Inhalt von `apps/web/dist` auf einem beliebigen statischen Webserver ausliefern (nginx, Caddy, GitHub Pages …). Alle Daten bleiben im Browser (IndexedDB). Antwortet kein Server unter `/api/health`, arbeitet die App in diesem Modus.

```nginx
server {
  listen 80;
  root /srv/satis-planner/dist;
  location / { try_files $uri /index.html; }
  location /assets/ { add_header Cache-Control "public, max-age=31536000, immutable"; }
}
```

### B) Mit Server (Projekt-Links)

Ein Node-Prozess (`apps/server`, Fastify) liefert API und die gebaute App aus. Projekte liegen als JSON-Dateien in `STORAGE_DIR/projects/<id>.json`; die ID ist der geheime Link `/f/<id>`. Einrichtung auf dem Heimserver, Update, Backup: siehe [README](../README.md#betrieb-auf-dem-server).

**Konfiguration** über Umgebungsvariablen, alle optional (Vorlage `.env.example`; `.env` ist in `.gitignore`):

| Variable | Standard | Bedeutung |
|---|---|---|
| `PORT`, `HOST` | 8080 / 0.0.0.0 | Adresse des Servers (Docker: `PORT` ist der Port auf dem Host, nur 127.0.0.1) |
| `STORAGE_DIR` | `./storage` (Container: `/app/storage`) | Projektablage |
| `STATIC_DIR` | `apps/web/dist` | gebaute Web-App |
| `MAX_PROJECT_BYTES` | 5 MiB | Größenlimit je Projekt (größere Anfragen → 413) |
| `MAX_PROJECTS` | 5000 | Gesamtzahl Projekte (danach → 507) |
| `RATE_CREATE_PER_HOUR` | 10 | neue Projekte je IP und Stunde |
| `RATE_SAVE_PER_MINUTE` / `RATE_LOAD_PER_MINUTE` | 120 / 300 | Speichern/Laden je IP und Minute |
| `TRUST_PROXY` | aus (Container: `loopback,uniquelocal`) | Absender, deren `X-Forwarded-For` geglaubt wird (für die echte Client-IP hinter tailscaled) |

Lokal starten (ohne Docker):

```bash
npm run build                   # Web-App bauen
npm start                       # Server mit App auf http://localhost:8080, Projekte in ./storage
```

Entwicklung mit Hot-Reload: `npm run dev:server` (Port 8080) und parallel `npm run dev` – der Vite-Server leitet `/api` an `http://localhost:8080` weiter (abweichend: Umgebungsvariable `SATIS_API`).

**Docker:** `docker compose up -d --build` (bzw. `./update.sh`). Ein Container, läuft als Benutzer `node` (UID 1000) mit schreibgeschütztem Dateisystem, ohne Zusatzrechte; nur `./storage` ist beschreibbar eingebunden. Der Port ist nur auf `127.0.0.1` freigegeben; öffentlich erreichbar macht ihn `tailscale funnel --bg 8080` (TLS übernimmt Tailscale). Health-Check: `GET /api/health` (prüft auch, ob der Speicherordner beschreibbar ist).

**Sicherheit:**
- IDs mit 128 Bit Zufall; das Format wird vor jedem Dateizugriff geprüft (kein Path Traversal).
- Projekte werden atomar geschrieben (temporäre Datei, fsync, rename) und serverseitig migriert und gegen das Schema geprüft. Ungültiges JSON wird mit 400 abgewiesen.
- Größenlimit, Obergrenze für die Gesamtzahl und Rate-Limit pro IP.
- Schreibende Anfragen verlangen den Kopf `X-Requested-With: satis-planner`.
- `Referrer-Policy: no-referrer` (der Link ist das Geheimnis), `X-Robots-Tag: noindex` und Content-Security-Policy. Einzige fremde Quelle: Bilder von `https://static.satisfactory-calculator.com` (Kartenkacheln, ohne Referrer geladen); Skripte und Verbindungen nur zur eigenen Adresse.
- Projekt-IDs erscheinen in den Logs nur gekürzt.

**Lizenzhinweis:** Für einen öffentlichen Betrieb ist zu klären, ob die aus den Docs-Dateien des Spiels extrahierten Daten weitergegeben werden dürfen (siehe [SPIELDATEN.md](SPIELDATEN.md)).

## Tests

```bash
npm test                        # Unit- und API-Tests (Vitest; API mit Temp-Ordner)
npm run test:e2e                # Browser-Tests; startet Vite und den Server (Temp-Ordner) selbst
```

## Spieldaten aktualisieren

Siehe [SPIELDATEN.md](SPIELDATEN.md#aktualisierung-bei-einem-spiel-update).
