#!/usr/bin/env bash
# Én kommando for å oppdatere VM-en, laget for å kunne kjøres rett fra PowerShell:
#   ssh -t <bruker>@it2810-17.idi.ntnu.no bash T17-Project2/deploy/oppdater.sh [TMDB-nøkkel]
# Linja har bevisst ingen anførselstegn: PowerShell på Windows ødela dem ved innliming.
# Uten nøkkel beholdes den som allerede er lagret.
set -euo pipefail
REPO_DIR="$(cd "$(dirname "$0")/.." && pwd)"
ENV_FILE=/opt/project2/.env
KEY="$(printf '%s' "${1:-}" | tr -d '\r[:space:]')"

if [ -n "$KEY" ]; then
  if [[ ! "$KEY" =~ ^[0-9a-fA-F]{32}$ && ! "$KEY" =~ ^eyJ[A-Za-z0-9._-]{40,}$ ]]; then
    echo "Det ser ikke ut som en TMDB-nøkkel (${#KEY} tegn)." >&2
    exit 1
  fi
  if sudo test -f "$ENV_FILE"; then
    # Fjern gammel linje og legg til ny, så det virker både når nøkkelen finnes og når den mangler.
    sudo sed -i '/^TMDB_API_KEY=/d' "$ENV_FILE"
    echo "TMDB_API_KEY=$KEY" | sudo tee -a "$ENV_FILE" >/dev/null
  else
    # Første kjøring: setup-vm.sh lager .env og tar nøkkelen fra miljøet.
    export TMDB_API_KEY="$KEY"
  fi
fi

cd "$REPO_DIR"
# Hent siste versjon selv, så brukeren slipper en egen git pull. setup-vm.sh leses først etter
# pull, så endringer i den tas med i samme kjøring.
git pull --ff-only
exec bash deploy/setup-vm.sh
