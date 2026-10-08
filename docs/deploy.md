# Deploy til it2810-17.idi.ntnu.no

Stegene under kjøres av Nicolay på VM-en (krever NTNU-VPN og `sudo`). Agentene har ikke kjørt dem.
Ferdige filer ligger i `deploy/`.

**Enklest (én linje, også fra PowerShell):**
`ssh -t <brukernavn>@it2810-17.idi.ntnu.no bash T17-Project2/deploy/oppdater.sh [TMDB-nøkkel]`.
Den henter siste kode og kjører `setup-vm.sh`. Nøkkelen trengs bare første gang.

**Raskeste vei fra VM-en selv:** `bash deploy/setup-vm.sh` fra en klon av repoet på VM-en gjør alle stegene under
automatisk (genererer også databasepassord i `.env`). Stegene under er det samme, gjort for hånd.

## 1. PostgreSQL

```bash
sudo apt update && sudo apt install -y postgresql postgresql-contrib   # contrib gir pg_trgm og unaccent
sudo -u postgres createuser project2 --pwprompt                         # velg et sterkt passord
sudo -u postgres createdb project2 --owner project2
# pg_trgm og unaccent må opprettes av en superbruker første gang (migreringene bruker IF NOT EXISTS):
sudo -u postgres psql -d project2 -c 'CREATE EXTENSION IF NOT EXISTS pg_trgm; CREATE EXTENSION IF NOT EXISTS unaccent;'
```

## 2. Kode, bygg og data

```bash
sudo useradd --system --no-create-home --shell /usr/sbin/nologin project2
sudo mkdir -p /opt/project2 && sudo chown "$USER" /opt/project2
git clone <repo-url> /opt/project2 && cd /opt/project2
npm ci
cp .env.example .env    # sett DATABASE_URL=postgres://project2:<passord>@localhost:5432/project2
chmod 600 .env
npm run build
npm run db:migrate

# Ekte IMDb-data (ca. 250 MB nedlasting):
wget -P data https://datasets.imdbws.com/title.basics.tsv.gz https://datasets.imdbws.com/title.ratings.tsv.gz
npm run db:seed
sudo chown -R project2:project2 /opt/project2
sudo chmod 600 /opt/project2/.env
```

## 3. Backend som tjeneste

```bash
sudo cp deploy/project2-backend.service /etc/systemd/system/
sudo systemctl daemon-reload
sudo systemctl enable --now project2-backend
curl -s -X POST localhost:3001/graphql -H 'content-type: application/json' \
  -d '{"query":"{ search(first: 1) { totalCount } }"}'
```

Helsesjekk: `curl -s localhost:3001/health` gir `{"status":"ok"}` (200), eller `{"status":"db-unavailable"}` (503)
hvis Postgres ikke svarer. Apache videresender den som `/project2/health`; `bash deploy/sjekk.sh` kjører begge.
Enheten har `Restart=always` og `Wants=postgresql.service` (+ `After`). Frontend viser et banner («Får ikke kontakt med serveren akkurat nå») hvis API-et ikke nås.

## 4. Apache

```bash
sudo mkdir -p /var/www/html/project2
sudo cp -r frontend/dist/* /var/www/html/project2/
sudo cp deploy/apache-project2.conf /etc/apache2/conf-available/
sudo a2enmod proxy proxy_http rewrite headers expires deflate
sudo a2enconf apache-project2
sudo apachectl configtest && sudo systemctl reload apache2
```

Åpne <http://it2810-17.idi.ntnu.no/project2/>.

## Oppdatering senere

```bash
cd /opt/project2 && git pull && npm ci && npm run build
sudo systemctl stop project2-backend          # se «Låsvindu» under
npm run db:migrate
sudo systemctl start project2-backend         # opp igjen med en gang; importene under kan kjøre mens den svarer
npm run db:seed && npm run db:artwork -- 2000 && npm run db:archive
sudo cp -r frontend/dist/* /var/www/html/project2/ && sudo systemctl reload apache2
```

`deploy/setup-vm.sh` følger samme rekkefølge: stopp, migrer, start backend, så import, plakater og
Archive-skanning, og til slutt publisering av frontend og reload av Apache. Importene bruker upsert
og kan derfor kjøre mens backend svarer, så siden er bare nede mens migreringen går (sekunder, ikke
minutter). Skriptet avslutter med feilmelding og avsluttingskode 1 hvis API-et ikke svarer like etter start.

**Archive-skanningen har en grense.** `setup-vm.sh` kjører `db:archive` med `ARCHIVE_LIMIT=500`
(maks 500 koblede titler; innsamlingen stopper da), så hver deploy ikke skanner hele Archive. Full
skanning: `ARCHIVE_LIMIT=0 bash deploy/setup-vm.sh`, eller `ARCHIVE_LIMIT=0 npm run db:archive` alene.
Skanningen lagrer side for side, så Ctrl+C taper ikke det som er funnet: første Ctrl+C stopper
innsamlingen og lagrer kandidatene som allerede er koblet, andre Ctrl+C avbryter helt.

**Måle ytelse på ekte data:** `bash deploy/mal-ytelse.sh > ytelse-vm.md` kjører `EXPLAIN ANALYZE` på søkespørringene og skriver en tabell til `docs/ytelse.md` (se «Måle på VM-en» der). Den bare leser fra databasen.

## Sikkerhetsheadere og Content-Security-Policy

`deploy/apache-project2.conf` setter CSP, `Permissions-Policy`, `Referrer-Policy`,
`X-Content-Type-Options` og `X-Frame-Options` for `/project2`. CSP-en er satt så streng som appen tåler:
alt kommer fra samme opphav (`'self'`, ingen inline skript/stiler, GraphQL går via samme domene) bortsett
fra to passive medieopphav: plakater fra `https://image.tmdb.org` og film/undertekster fra
`https://archive.org` og `https://*.archive.org` (Archive videresender nedlastinger til verter som
`ia800000.us.archive.org`). Legger appen til et nytt eksternt opphav, må det inn i policyen, ellers blokkerer
nettleseren det. `e2e/csp.spec.ts` leser policyen rett fra Apache-konfigen (med mock-vertene byttet inn) og
sjekker at forside, detalj og spiller laster uten brudd, og feiler hvis `frontend/dist/index.html` har et inline-skript som ikke står som `'sha256-…'` i `script-src`. Hele E2E-suiten kjører dessuten under denne policyen (Vite preview får den som header). Husk `sudo a2enmod headers`.

## CI (`.gitlab-ci.yml`)

- `lint`, `typecheck`: kodekvalitet. `unit-tests`: `npm test` mot Postgres-service.
- `build`: `npm run build`, `frontend/dist/` lagres som artefakt.
- `e2e`: Playwright-bildet (`mcr.microsoft.com/playwright:v1.63.0-noble`, må følge versjonen i
  `package-lock.json`) med `postgres:16` som service. `E2E_DATABASE_URL` peker mot service-verten;
  Playwright starter mock-servere, backend og frontend selv. `playwright-report/` og `test-results/`
  lagres som artefakt ved feil.

Repoet ligger på GitHub fram til innlevering, så GitLab-jobbene kjøres først når det er flyttet. En ustabil
E2E-test gjør jobben rød. De samme kommandoene er kjørt lokalt før hver merge.

**Låsvindu for migrering 004.** Migreringen legger til tre genererte (`STORED`) kolonner på `titles`
(`primary_title_norm`, `original_title_norm`, `title_words`) i én `ALTER TABLE`, og bygger deretter
tre GIN-indekser på dem. `ALTER TABLE ... ADD COLUMN ... STORED` skriver om hele tabellen mens den
holder `ACCESS EXCLUSIVE`-lås, så alle spørringer mot `titles` står i kø til den er ferdig (ca. 4 s lokalt, regn med 10–20 s
for 120 000 titler på VM-en; indeksbyggingen kommer i tillegg). Kjør derfor migreringen med backend
stoppet, slik `deploy/setup-vm.sh` og kommandoene over gjør. `scripts/migrate.ts` setter
`statement_timeout = 0` (poolens 15 s-grense ville avbrutt og rullet tilbake omskrivingen) og
`lock_timeout = 30s` på migreringsklienten, og nullstiller begge etterpå. Senere migreringer som ikke skriver om
tabellen trenger ikke dette.

**Nettverk.** Med `NODE_ENV=production` (satt i `deploy/project2-backend.service`) lytter backend bare
på `127.0.0.1:3001`, så port 3001 ikke kan nås utenfra uten om Apache. `HOST` overstyrer ved behov.
Apache-konfigen og `deploy/sjekk.sh` bruker allerede `127.0.0.1`. Begrensningen av mutations stoler på
`X-Forwarded-For` bare når forbindelsen kommer fra loopback.
