#!/usr/bin/env bash
# Aktualisiert Satis Planner auf dem Server:
#   1. Sicherung des Projektordners storage/ nach backups/ (tar.gz mit Datum, die letzten BACKUP_KEEP behalten)
#   2. git pull (nur Fast-Forward)
#   3. docker compose up -d --build
#   4. Prüfung, ob /api/health antwortet
# Aufruf im Projektordner oder von überall: ./update.sh
set -euo pipefail

cd "$(dirname "$(readlink -f "$0")")"

# Einstellungen aus .env übernehmen (nur PORT und BACKUP_KEEP)
env_value() { [ -f .env ] && sed -n "s/^$1=//p" .env | tail -n1 | tr -d '"'"'"' \r' || true; }
PORT="${PORT:-$(env_value PORT)}"; PORT="${PORT:-8080}"
BACKUP_KEEP="${BACKUP_KEEP:-$(env_value BACKUP_KEEP)}"; BACKUP_KEEP="${BACKUP_KEEP:-10}"
HEALTH_URL="http://127.0.0.1:${PORT}/api/health"
HEALTH_TIMEOUT="${HEALTH_TIMEOUT:-90}"

step() { printf '\n\033[1m==> %s\033[0m\n' "$*"; }
fail() {
  printf '\n\033[1;31mFEHLER: %s\033[0m\n' "$*" >&2
  exit 1
}
trap 'fail "Abbruch in Zeile $LINENO (Befehl: $BASH_COMMAND). Die Sicherung liegt in backups/."' ERR

command -v git >/dev/null || fail "git ist nicht installiert."
command -v docker >/dev/null || fail "docker ist nicht installiert."
docker compose version >/dev/null 2>&1 || fail "docker compose ist nicht verfügbar (oder keine Berechtigung für Docker – ist der Benutzer in der Gruppe 'docker'?)."

# storage/ muss dem Benutzer gehören, nicht root (sonst legt Docker ihn als root an)
mkdir -p storage backups

step "1/4 Sicherung von storage/"
stamp="$(date +%Y-%m-%d_%H%M%S)"
backup="backups/storage_${stamp}.tar.gz"
tar -czf "$backup" storage
echo "Gesichert: $backup ($(du -h "$backup" | cut -f1), $(find storage -name '*.json' | wc -l) Projekte)"
# Nur die neuesten BACKUP_KEEP Sicherungen behalten
mapfile -t old < <(ls -1t backups/storage_*.tar.gz 2>/dev/null | tail -n +"$((BACKUP_KEEP + 1))")
if [ "${#old[@]}" -gt 0 ]; then
  rm -f -- "${old[@]}"
  echo "Alte Sicherungen entfernt: ${#old[@]}"
fi

step "2/4 git pull"
before="$(git rev-parse --short HEAD)"
git pull --ff-only || fail "git pull fehlgeschlagen (lokale Änderungen auf dem Server? 'git status' prüfen)."
after="$(git rev-parse --short HEAD)"
if [ "$before" = "$after" ]; then
  echo "Keine neuen Commits ($after)."
else
  echo "Aktualisiert: $before → $after"
  git --no-pager log --oneline "$before..$after" | head -20
fi

step "3/4 docker compose up -d --build"
GIT_COMMIT="$after" docker compose up -d --build

step "4/4 Prüfe $HEALTH_URL (bis ${HEALTH_TIMEOUT}s)"
probe() {
  if command -v curl >/dev/null; then curl -fsS --max-time 3 "$HEALTH_URL"
  else wget -qO- --timeout=3 "$HEALTH_URL"; fi
}
deadline=$((SECONDS + HEALTH_TIMEOUT))
until body="$(probe 2>/dev/null)"; do
  if [ "$SECONDS" -ge "$deadline" ]; then
    trap - ERR
    echo "Letzte Log-Zeilen:" >&2
    docker compose logs --tail 40 app >&2 || true
    docker compose ps >&2 || true
    fail "Die Seite antwortet nach ${HEALTH_TIMEOUT}s nicht auf $HEALTH_URL.
  Logs:          docker compose logs -f app
  Zurück:        git checkout $before && docker compose up -d --build
  Daten zurück:  siehe README.md, Abschnitt „Backup und Wiederherstellung“ (Sicherung: $backup)"
  fi
  sleep 2
done
echo "$body"
printf '\n\033[1;32mFertig: Satis Planner läuft (%s).\033[0m\n' "$after"
