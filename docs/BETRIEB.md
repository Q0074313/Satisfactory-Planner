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

### A) Nur statisch (ohne Konten)

Inhalt von `apps/web/dist` auf einem beliebigen statischen Webserver ausliefern (nginx, Caddy, GitHub Pages …). Alle Daten bleiben im Browser (IndexedDB). Die Kontofunktionen blenden sich aus, wenn kein Server antwortet.

```nginx
server {
  listen 80;
  root /srv/satis-planner/dist;
  location / { try_files $uri /index.html; }
  location /assets/ { add_header Cache-Control "public, max-age=31536000, immutable"; }
}
```

### B) Mit Server (Konten, Projekte im Konto, Freigabelinks)

Ein Node-Prozess (`apps/server`, Fastify) liefert API und die gebaute App aus.

**Konfiguration ausschließlich über Umgebungsvariablen** (Vorlage `.env.example`; `.env` ist in `.gitignore` ausgeschlossen, Zugangsdaten stehen nie im Code):

| Variable | Bedeutung |
|---|---|
| `DATABASE_URL` | `postgres://…` für PostgreSQL; `pglite:<Ordner>` bzw. `pglite:memory` für eine eingebettete Datenbank (Entwicklung, Tests) |
| `SESSION_SECRET` | Schlüssel für die Sitzungs-HMAC, mindestens 32 Zeichen, zufällig |
| `PUBLIC_BASE_URL` | Öffentliche Adresse, z. B. `https://planer.example.org` (Freigabelinks; bei `https` werden Cookies als „Secure“ gesetzt) |
| `PORT`, `HOST` | Optional, Standard 8080 / 0.0.0.0 |
| `STATIC_DIR` | Optional, Standard `apps/web/dist` |

Lokal starten (eingebettete Datenbank im Ordner `.data`):

```bash
cp .env.example .env            # SESSION_SECRET eintragen
npm run build                   # Web-App bauen
npm start                       # Server mit App auf http://localhost:8080
```

Entwicklung mit Hot-Reload: `npm run dev:server` (Port 8080) und parallel `npm run dev` – der Vite-Server leitet `/api` an `http://localhost:8080` weiter (abweichend: Umgebungsvariable `SATIS_API`).

**Datenbankmigrationen** liegen versioniert in `apps/server/drizzle/` und werden beim Start automatisch angewendet. Manuell: `npm run db:migrate`. Nach Schemaänderungen in `apps/server/src/schema.ts`: `npm run db:generate` erzeugt eine neue Migration (einchecken).

**Docker** (ein Image für App und Server, PostgreSQL separat):

```bash
cp .env.example .env            # POSTGRES_PASSWORD, SESSION_SECRET, PUBLIC_BASE_URL setzen
docker compose up -d --build
```

Hinter einem Reverse-Proxy (TLS) betreiben. Health-Check: `GET /api/health`.

**Sicherheit:** Passwörter mit scrypt und Salz; Sitzungstoken nur als HMAC in der Datenbank; Cookie httpOnly, SameSite=Lax; schreibende Anfragen verlangen den Kopf `X-Requested-With: satis-planner`; Anmeldeversuche begrenzt; Projekte werden serverseitig migriert und gegen das Schema geprüft; Freigabelinks sind schreibgeschützt und widerrufbar.

**Lizenzhinweis:** Für einen öffentlichen Betrieb ist zu klären, ob die aus den Docs-Dateien des Spiels extrahierten Daten weitergegeben werden dürfen (siehe [SPIELDATEN.md](SPIELDATEN.md)).

## Tests

```bash
npm test                        # Unit- und API-Tests (Vitest; API gegen PGlite)
npm run test:e2e                # Browser-Tests; startet Vite und den Server (PGlite im Speicher) selbst
```

## Spieldaten aktualisieren

Siehe [SPIELDATEN.md](SPIELDATEN.md#aktualisierung-bei-einem-spiel-update).
