#!/usr/bin/env bash
# Setter opp hele prosjektet på it2810-17.idi.ntnu.no (Ubuntu) i én kjøring.
# Kjøres fra roten av en klon av repoet:  bash deploy/setup-vm.sh
# Trygt å kjøre på nytt: hvert steg hopper over det som allerede er gjort.
# Skriptet setter opp en Ubuntu-server; på Windows/macOS ville det feile halvveis.
if [ "$(uname -s)" != "Linux" ] || ! command -v apt-get >/dev/null; then
  echo "Dette skriptet skal kjøres på VM-en, ikke på din egen maskin." >&2
  echo "Logg inn først:  ssh <ntnu-brukernavn>@it2810-17.idi.ntnu.no" >&2
  exit 1
fi
set -euo pipefail

APP_DIR=/opt/project2
WEB_DIR=/var/www/html/project2
DB_NAME=project2
DB_USER=project2
REPO_DIR="$(cd "$(dirname "$0")/.." && pwd)"

step() { printf '\n\033[1;34m==> %s\033[0m\n' "$1"; }

step "Installerer systempakker (Postgres, Apache, Node 22)"
sudo apt-get update -qq
sudo apt-get install -y -qq postgresql postgresql-contrib apache2 curl rsync
if ! command -v node >/dev/null || [ "$(node -p 'process.versions.node.split(".")[0]')" -lt 20 ]; then
  curl -fsSL https://deb.nodesource.com/setup_22.x | sudo -E bash -
  sudo apt-get install -y -qq nodejs
fi

step "Oppretter systembruker og kopierer koden til $APP_DIR"
id -u project2 >/dev/null 2>&1 || sudo useradd --system --no-create-home --shell /usr/sbin/nologin project2
sudo mkdir -p "$APP_DIR"
sudo chown -R "$USER" "$APP_DIR"
# Kopien gjør at tjenesten ikke er avhengig av hjemmemappa til den som kjørte skriptet.
rsync -a --delete --exclude node_modules --exclude .env --exclude 'data/*.gz' "$REPO_DIR/" "$APP_DIR/"
cd "$APP_DIR"

step "Oppretter database og bruker"
if [ ! -f .env ]; then
  # Passordet genereres her og lagres bare i .env på VM-en – aldri i git.
  DB_PASS="$(openssl rand -hex 24)"
  sudo -u postgres psql -v ON_ERROR_STOP=1 -q <<SQL
DO \$\$ BEGIN
  IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = '$DB_USER') THEN
    CREATE ROLE $DB_USER LOGIN;
  END IF;
END \$\$;
ALTER ROLE $DB_USER PASSWORD '$DB_PASS';
SQL
  sed -e "s#^DATABASE_URL=.*#DATABASE_URL=postgres://$DB_USER:$DB_PASS@localhost:5432/$DB_NAME#" \
      -e "s#^CORS_ORIGIN=.*#CORS_ORIGIN=#" \
      .env.example > .env
  echo "NODE_ENV=production" >> .env
  chmod 600 .env
fi
# TMDB-nøkkel (for plakater): skriptet spør første gang. Kan også gis som miljøvariabel.
# Den skrives bare til .env på VM-en, aldri til git. Uten nøkkel vises plassholdere.
# En gyldig nøkkel er 32 hex-tegn (v3) eller en lang JWT (v4). En tidligere mislykket innliming
# (f.eks. bare ett tegn) skal ikke hindre at vi spør på nytt.
valid_key() { [[ "$1" =~ ^[0-9a-fA-F]{32}$ || "$1" =~ ^eyJ[A-Za-z0-9._-]{40,}$ ]]; }
CURRENT_KEY="$(sed -n 's/^TMDB_API_KEY=//p' .env | tr -d '\r')"
if [ -z "${TMDB_API_KEY:-}" ] && ! valid_key "$CURRENT_KEY" && [ -t 0 ]; then
  for attempt in 1 2 3; do
    # Synlig input: skjult innliming ga ingen tilbakemelding og feilet i praksis.
    read -r -p "Lim inn TMDB API-nøkkel (32 tegn, eller Enter for å hoppe over): " TMDB_API_KEY || true
    # Innliming fra Windows kan ta med \r og mellomrom.
    TMDB_API_KEY="$(printf '%s' "$TMDB_API_KEY" | tr -d '\r[:space:]')"
    [ -z "$TMDB_API_KEY" ] && break
    valid_key "$TMDB_API_KEY" && break
    echo "Det ser ikke ut som en TMDB-nøkkel (${#TMDB_API_KEY} tegn). Prøv igjen."
    TMDB_API_KEY=""
  done
fi
if [ -n "${TMDB_API_KEY:-}" ]; then
  grep -v '^TMDB_API_KEY=' .env > .env.tmp || true
  echo "TMDB_API_KEY=$TMDB_API_KEY" >> .env.tmp
  mv .env.tmp .env
  chmod 600 .env
fi
sudo -u postgres psql -tAc "SELECT 1 FROM pg_database WHERE datname = '$DB_NAME'" | grep -q 1 \
  || sudo -u postgres createdb "$DB_NAME" --owner "$DB_USER"
# pg_trgm og unaccent krever superbruker første gang (begge følger med postgresql-contrib);
# migreringene bruker IF NOT EXISTS.
sudo -u postgres psql -d "$DB_NAME" -qc 'CREATE EXTENSION IF NOT EXISTS pg_trgm; CREATE EXTENSION IF NOT EXISTS unaccent;'

step "Installerer avhengigheter og bygger"
HUSKY=0 npm ci --no-audit --no-fund
npm run build
# Migrering 004 skriver om titles og holder en lås som blokkerer all lesing og skriving i noen sekunder (ca. 4 s lokalt, 10–20 s på VM).
# Stopper backend først (ved første kjøring finnes den ikke ennå), så brukere får en ryddig 503 fra
# Apache i stedet for forespørsler som henger på låsen. Den startes igjen rett etter migreringen,
# før de tidkrevende stegene (import, plakater, Archive), slik at nedetiden bare er migreringen.
sudo systemctl stop project2-backend 2>/dev/null || true
npm run db:migrate

step "Starter backend som systemd-tjeneste"
# Tjenesten kjører som project2 og må kunne lese .env (chmod 600 og eid av oss ville gitt «permission
# denied»). Gruppen får lesetilgang i stedet for at vi flytter eierskap av hele katalogen: importene
# under kjører som oss og skriver til data/.
sudo chgrp project2 .env
chmod 640 .env
sudo cp deploy/project2-backend.service /etc/systemd/system/
sudo systemctl daemon-reload
sudo systemctl enable project2-backend
sudo systemctl restart project2-backend
# Backenden trenger et par sekunder på å starte; prøv noen ganger før vi gir opp. Vi stopper her, og
# ikke etter flere minutter med import, hvis den ikke kommer opp.
check() {
  curl -fsS -m 5 -X POST "$1" -H 'content-type: application/json' \
    -d '{"query":"{ search(first: 1) { totalCount } }"}'
}
for i in 1 2 3 4 5 6 7 8 9 10; do
  check http://127.0.0.1:3001/graphql >/dev/null 2>&1 && break
  sleep 2
done
# `if !` i stedet for `cmd && echo`: set -e overser feil i &&-lister, og da ville skriptet
# fortsatt selv om API-et ikke svarte.
if ! check http://127.0.0.1:3001/graphql >/dev/null; then
  echo "FEIL: backenden svarer ikke på port 3001. Se: sudo journalctl -u project2-backend -n 50" >&2
  exit 1
fi

step "Laster ned IMDb-data og importerer (tar noen minutter)"
mkdir -p data
for f in title.basics.tsv.gz title.ratings.tsv.gz; do
  # -z: last bare ned på nytt hvis IMDb har en nyere fil enn den vi har.
  curl -fsSL -z "data/$f" -o "data/$f" "https://datasets.imdbws.com/$f"
done
npm run db:seed

if valid_key "$(sed -n 's/^TMDB_API_KEY=//p' .env | tr -d '\r')"; then
  step "Henter plakater for de mest populære titlene (TMDB)"
  # Varmer opp bildecachen så forsiden har plakater med en gang; resten hentes når de vises.
  npm run db:artwork -- 2000 || echo "Advarsel: forhåndshenting av plakater feilet – de hentes ved visning i stedet."
fi

step "Henter lovlige filmer fra Internet Archive"
# Kobler IMDb-titler til gratis public domain-/Creative Commons-versjoner. Feil her skal ikke
# stoppe deployen: appen fungerer, bare uten «Se filmen» for titler som mangler.
npm run db:archive || echo "Advarsel: henting fra Internet Archive feilet – prøv igjen senere med npm run db:archive."

# Importene over er upsert-trygge og kjørte mens backenden svarte, så siden var oppe hele tiden.
# Apache lastes først nå, når frontend og data er på plass.
step "Publiserer frontend og konfigurerer Apache"
sudo mkdir -p "$WEB_DIR"
sudo rsync -a --delete frontend/dist/ "$WEB_DIR/"
sudo cp deploy/apache-project2.conf /etc/apache2/conf-available/
sudo a2enmod -q proxy proxy_http rewrite headers expires deflate
sudo a2enconf -q apache-project2
sudo apachectl configtest
sudo systemctl reload apache2

step "Sjekker at alt svarer"
# API-et ble sjekket rett etter start; her gjenstår veien via Apache.
if ! check http://localhost/project2/graphql; then
  echo "FEIL: backenden svarer, men ikke via Apache. Se: sudo tail -n 50 /var/log/apache2/error.log" >&2
  exit 1
fi
echo
echo "Ferdig! Åpne http://it2810-17.idi.ntnu.no/project2/"
