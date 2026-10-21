# Satis Planner – Hinweise für Claude Code

Planungswerkzeug für Satisfactory 1.2 (Produktion, Fabrikgrundriss, Schienennetz, Transport) in einem Projektmodell. Sprache des Nutzers, der Oberfläche und der Doku: **Deutsch**.

## Architektur

npm-Workspaces, TypeScript überall, Node ≥ 22 (lokal: `~/.local/bin/node`).

| Paket | Inhalt |
|---|---|
| `packages/core` | Projektmodell (Zod-Schema), Migrationen, Berechnungen, Prüfregeln, i18n `tr()`. Keine UI, kein Dateisystem. Wird von Web und Server direkt als TS-Quelle importiert. |
| `apps/web` | React 19 + Vite + Zustand/Immer. Canvas-Editoren, Autosave. |
| `apps/server` | Fastify: `/api/factory` (Projekte als JSON-Dateien) + Auslieferung von `apps/web/dist` mit SPA-Fallback. Läuft mit `tsx` (kein eigener Build). |
| `packages/gamedata-tools` | Extraktion der Spieldaten aus der lokalen Spielinstallation nach `data/gamedata/<version>/` (eingecheckt). |

**Speicherung:**
- Mit Server: ein Projekt = eine Datei `storage/projects/<id>.json`. Die ID (16 Zufallsbytes, base64url, 22 Zeichen) ist zugleich der geheime Link `/f/<id>`. Kein Login, keine Liste aller Projekte.
- Ohne Server (`npm run dev` allein): IndexedDB im Browser, wie früher. Die App erkennt den Modus beim Start über `/api/health` (`apps/web/src/state/session.ts` → `boot()`).
- „Projekt“ = alles (mehrere Fabriken, Schienennetz, Züge, Transporte). „Fabrik“ ist eine Untereinheit im Projekt. Die URL/API heißt trotzdem `/f/` bzw. `/api/factory`.

**API** (`apps/server/src/app.ts`): `GET /api/health`, `POST /api/factory` `{project}` → `{id, revision}`, `GET /api/factory/:id` → `{project, revision, migrations}`, `PUT /api/factory/:id` `{project, baseRevision}` → `{revision}` bzw. 409 bei Konflikt. Schreibende Anfragen brauchen den Kopf `X-Requested-With: satis-planner`.

**Sicherheit** (öffentlich über Tailscale Funnel):
- ID-Format wird vor jedem Dateizugriff geprüft (`isProjectId`).
- Atomares Schreiben (tmp, fsync, rename) mit Sperre pro ID (`storage.ts`).
- Größenlimit, Gesamtzahl und Rate-Limit pro IP (`rateLimit.ts`, Werte über Umgebungsvariablen).
- Referrer-Policy no-referrer, CSP, noindex. IDs werden in Logs gekürzt. CSP erlaubt als einzige fremde Quelle Bilder von `static.satisfactory-calculator.com` (Kartenkacheln).
- Der Container läuft als `node`, mit read-only Dateisystem, und der Port ist nur an 127.0.0.1 gebunden.

## Befehle

```bash
npm run dev            # Web-App :5173 (ohne Server → IndexedDB)
npm run dev:server     # API :8080, Projekte in ./storage (zusammen mit npm run dev nutzen)
npm test               # Vitest: core, web (i18n-Abdeckung), server (API)
npm run typecheck      # tsc -b
npm run test:e2e       # Playwright (startet Vite :5199 + Server :8099 mit Temp-Ablage)
npm run build && npm start   # wie Produktion, ohne Docker
```

Docker gibt es **nur auf dem Server**, nicht auf dem Laptop.

## Deployment

- Server1: `homeserver@192.168.178.39`, Debian 13, SSH-Schlüssel vom Laptop ist hinterlegt.
- Arbeitskopie `~/satis-planner`, Bare-Repo `~/git/satis-planner.git` (Remote `server` auf dem Laptop).
- Ablauf: Am Laptop committen, `git push server main`, dann auf dem Server `cd ~/satis-planner && ./update.sh`.
- `update.sh` macht: Backup von `storage/` nach `backups/` (10 behalten), `git pull --ff-only`, `docker compose up -d --build`, Health-Check.
- Öffentlich über `tailscale funnel --bg 8080`. Den Funnel nur nach Rückfrage beim Nutzer ändern. Vor Befehlen auf dem Server immer fragen.

## Konventionen

- **Formatänderung immer mit Migration:** Jede Änderung am Projektschema (`packages/core/src/model/schema.ts`), die alte Daten unlesbar oder falsch machen würde, braucht:
  1. `PROJECT_FORMAT_VERSION` + 1 (das Feld heißt `formatVersion` und ist die Schema-Version jedes gespeicherten Projekts)
  2. einen Schritt `from: n` in `MIGRATIONS` (`packages/core/src/project/migrations.ts`), der auf Rohdaten arbeitet
  3. eine Fixture im alten Format plus Test (`apps/server/test/fixtures/`)

  Nie eine bestehende Migration nachträglich ändern. Gespeicherte Dateien auf dem Server enthalten alte Formate und werden erst beim Laden migriert. Anleitung: README → „Datenformat und Migrationen“.
- **i18n:** Jeder sichtbare Text steht auf Deutsch in `t()` (Web), `tr()` (Core) oder `N_()` (Label-Tabellen); der deutsche Text ist der Schlüssel. Die englische Übersetzung gehört in `apps/web/src/i18n/en.ts` bzw. `packages/core/src/i18n/en.ts`. Die Abdeckungstests schlagen sonst fehl.
- **Spieldaten:** Nur belegte Werte aus den offiziellen Docs-Dateien bzw. kuratierten Quellen (`docs/SPIELDATEN.md`), nichts erfinden. Rohstoffvorkommen der Karte: `data/gamedata/<version>/map.json` aus satisfactory-calculator.com (`npm run gamedata:map`); Kartenkacheln werden nur live geladen, nie eingecheckt.
- **Server-Daten** (`storage/`, `backups/`) und `.env` sind nie im Git.
- Code-Stil: Kommentare auf Deutsch, knapp. An umliegenden Code anpassen.
