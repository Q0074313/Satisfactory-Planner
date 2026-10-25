#!/usr/bin/env bash
# Prüft, ob der öffentliche DNS-Eintrag des Tailscale Funnels existiert, und
# setzt den Funnel neu, wenn Tailscales Nameserver NXDOMAIN meldet (bekanntes
# Problem: Eintrag verschwindet, obwohl `tailscale funnel status` „on“ zeigt).
#
# Einrichtung auf dem Server (alle 30 Minuten, ohne sudo):
#   (crontab -l 2>/dev/null; echo '*/30 * * * * $HOME/satis-planner/scripts/funnel-watch.sh') | crontab -
# Protokoll: ~/.local/state/funnel-watch.log
set -u

PORT="${FUNNEL_PORT:-8080}"
LOG="$HOME/.local/state/funnel-watch.log"
mkdir -p "$(dirname "$LOG")"
log() { echo "$(date '+%F %T') $*" >>"$LOG"; tail -n 500 "$LOG" >"$LOG.tmp" && mv "$LOG.tmp" "$LOG"; }

# Funnel nur prüfen, wenn er eingeschaltet ist
tailscale funnel status 2>/dev/null | grep -q 'Funnel on' || exit 0

HOST="$(tailscale status --json 2>/dev/null | sed -n 's/.*"DNSName": *"\([^"]*\)\.".*/\1/p' | head -n1)"
[ -n "$HOST" ] || { log "Hostname nicht ermittelt"; exit 0; }

# Direkt beim zuständigen Nameserver fragen (kein Cache)
NS="$(dig +short NS ts.net | head -n1)"
[ -n "$NS" ] || { log "Nameserver von ts.net nicht erreichbar"; exit 0; }
STATUS="$(dig "$HOST" @"$NS" +time=5 +tries=2 | sed -n 's/.*status: \([A-Z]*\).*/\1/p')"

# Nur bei eindeutigem NXDOMAIN eingreifen (Netzwerkfehler o. Ä. nicht)
if [ "$STATUS" = "NXDOMAIN" ]; then
  log "$HOST: NXDOMAIN bei $NS – Funnel wird neu gesetzt"
  if tailscale funnel reset && tailscale funnel --bg "$PORT" >/dev/null; then
    log "Funnel neu gesetzt (Eintrag erscheint meist nach 3–4 Minuten)"
  else
    log "Funnel neu setzen fehlgeschlagen"
  fi
fi
