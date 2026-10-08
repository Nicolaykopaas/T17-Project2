#!/usr/bin/env bash
# Måler søkeytelsen på det ekte datasettet og skriver en markdown-tabell til stdout, klar til å
# limes inn i docs/ytelse.md:   bash deploy/mal-ytelse.sh > ytelse-vm.md
# Fremdrift og feil går til stderr, så fila bare inneholder tabellen. Leser bare fra databasen
# (EXPLAIN ANALYZE på SELECT, i en skrivebeskyttet økt) og kan trygt kjøres mens siden er i bruk,
# men kjør den helst når det er rolig: målingene konkurrerer om CPU med besøkende.
# Skriptet måler en Ubuntu-server; på Windows/macOS ville det feile halvveis.
if [ "$(uname -s)" != "Linux" ] || ! command -v apt-get >/dev/null; then
  echo "Dette skriptet skal kjøres på VM-en, ikke på din egen maskin." >&2
  echo "Logg inn først:  ssh <ntnu-brukernavn>@it2810-17.idi.ntnu.no" >&2
  exit 1
fi
set -euo pipefail

APP_DIR="${APP_DIR:-/opt/project2}"
ENV_FILE="$APP_DIR/.env"

if [ ! -f "$ENV_FILE" ]; then
  echo "Fant ikke $ENV_FILE. Kjør  bash deploy/setup-vm.sh  først." >&2
  exit 1
fi
# Kopien i $APP_DIR oppdateres av setup-vm.sh/oppdater.sh. Er den eldre enn denne fila, mangler
# målerskriptet der og npm gir en uforståelig feil.
if [ ! -f "$APP_DIR/backend/scripts/measure-performance.ts" ]; then
  echo "$APP_DIR har ikke målerskriptet ennå. Kjør  bash deploy/oppdater.sh  først." >&2
  exit 1
fi

# Samme uthenting som setup-vm.sh bruker for andre verdier i .env. Passordet i URL-en skrives aldri ut.
DATABASE_URL="$(sed -n 's/^DATABASE_URL=//p' "$ENV_FILE" | tr -d '\r' | tail -n 1)"
if [ -z "$DATABASE_URL" ]; then
  echo "DATABASE_URL mangler i $ENV_FILE." >&2
  exit 1
fi
export DATABASE_URL

# -s: uten npms egne overskrifter på stdout, som ellers havner i markdown-fila.
cd "$APP_DIR"
npm run -s db:measure -w backend
