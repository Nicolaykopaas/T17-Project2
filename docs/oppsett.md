# Oppsett

Krever Node.js ≥ 20 (testet med 22) og PostgreSQL ≥ 14 med `pg_trgm` og `unaccent` (begge følger med standard
`postgresql-contrib`; i Debian/Ubuntu-pakken `postgresql-contrib`, i Homebrew og offisielle
Docker-bilder er den med).

## 1. Installer avhengigheter

```bash
npm ci
```

## 2. PostgreSQL

Opprett to databaser: én til appen og én til testene (testene **tømmer** sin database).

```bash
sudo -u postgres createdb project2
sudo -u postgres createdb project2_test
```

Bruker du en egen bruker med passord: `sudo -u postgres psql -c "CREATE USER it2810 PASSWORD 'hemmelig' SUPERUSER;"`
(`SUPERUSER` trengs bare fordi migrasjonene kjører `CREATE EXTENSION pg_trgm` og `unaccent`; alternativt kjør
`CREATE EXTENSION pg_trgm; CREATE EXTENSION unaccent;` selv som superuser i begge databasene og gi vanlig bruker eierskap.)

## 3. Miljøvariabler

```bash
cp .env.example .env
```

Rediger `DATABASE_URL` og `TEST_DATABASE_URL` hvis du ikke bruker `postgres` uten passord på
`localhost:5432`. Uten `.env` gjelder disse standardverdiene:

| Variabel             | Standard                                           | Brukes av                                   |
| -------------------- | -------------------------------------------------- | ------------------------------------------- |
| `PORT`               | `3001`                                             | backend                                     |
| `HOST`               | `127.0.0.1` i produksjon, ellers alle grensesnitt  | backend (hvilket grensesnitt den lytter på) |
| `DATABASE_URL`       | `postgres://postgres@localhost:5432/project2`      | backend, importskript                       |
| `TEST_DATABASE_URL`  | `postgres://postgres@localhost:5432/project2_test` | backend-tester                              |
| `E2E_DATABASE_URL`   | `postgres://postgres@localhost:5432/project2_e2e`  | E2E (se «E2E-tester»)                       |
| `CORS_ORIGIN`        | `http://localhost:5173` (bare utenfor produksjon)  | backend                                     |
| `IMDB_DATA_DIR`      | `./data` (relativt til repo-roten)                 | importskript                                |
| `IMDB_MIN_VOTES`     | `100`                                              | importskript                                |
| `NODE_ENV`           | `production` slår av introspeksjon og GraphiQL     | backend                                     |
| `TMDB_API_KEY`       | (tom: ingen bilder fra TMDB)                       | backend                                     |
| `TMDB_API_URL`       | `https://api.themoviedb.org/3`                     | backend                                     |
| `TMDB_IMAGE_URL`     | `https://image.tmdb.org/t/p`                       | backend                                     |
| `TMDB_MOCK_PORT`     | `3999`                                             | `tmdb:mock`                                 |
| `TMDB_MOCK_DELAY_MS` | `0`                                                | `tmdb:mock` (kunstig forsinkelse)           |
| `ARCHIVE_URL`        | `https://archive.org`                              | backend og `db:archive`                     |
| `ARCHIVE_MOCK_PORT`  | `3998`                                             | `archive:mock`                              |
| `ARCHIVE_LIMIT`      | (ingen grense)                                     | `db:archive` (som `--limit`)                |
| `FIXTURE_SIZE`       | `120000`                                           | `db:fixture` (antall syntetiske titler)     |
| `VITE_GRAPHQL_URL`   | `<base>/graphql`, i praksis `/project2/graphql`    | frontend (leses ved bygging og i dev)       |
| `PW_CHROMIUM_PATH`   | (tom: Playwrights egen Chromium)                   | E2E, sti til forhåndsinstallert Chromium    |

`.env` leses fra repo-roten uansett hvilken mappe kommandoene kjøres fra. Variabler som allerede er
satt i skallet (eller i CI) går foran `.env`.

## 4. Skjema

```bash
npm run db:migrate
```

Kjører alle filene i `backend/migrations/` som ikke er kjørt (sporet i tabellen `schema_migrations`).
Trygt å kjøre flere ganger. Importskriptet (`db:seed`) kjører også migrasjonene først.

## 5. Data

Importen trenger to filer i `IMDB_DATA_DIR` (standard `data/`): `title.basics.tsv.gz` og
`title.ratings.tsv.gz`. Velg ett av alternativene.

### A. Ekte IMDb-data (ca. 200 MB nedlasting)

Datasettene er gratis for ikke-kommersiell bruk, ingen nøkkel trengs
(<https://developer.imdb.com/non-commercial-datasets/>).

```bash
mkdir -p data
wget -P data https://datasets.imdbws.com/title.basics.tsv.gz
wget -P data https://datasets.imdbws.com/title.ratings.tsv.gz
```

(`curl -L -o data/title.basics.tsv.gz https://datasets.imdbws.com/title.basics.tsv.gz` fungerer også.)

### B. Syntetiske data (ingen nedlasting)

For utvikling og CI, eller når `datasets.imdbws.com` ikke er tilgjengelig:

```bash
npm run db:fixture -w backend            # ca. 120 000 titler, deterministisk
FIXTURE_SIZE=5000 npm run db:fixture -w backend   # mindre sett
```

Filene har nøyaktig samme format som IMDb sine (samme kolonner, `\N` for null) og inneholder
episoder, kortfilmer og titler med for få stemmer som importen skal filtrere bort, i tillegg til
noen kjente titler (`tt0111161` The Shawshank Redemption, `tt0068646` The Godfather,
`tt0468569` The Dark Knight, `tt0903747` Breaking Bad …). Datafilene er i `.gitignore`.

### Importer

```bash
npm run db:seed
```

Beholder filmer (`movie`) og serier (`tvSeries`, `tvMiniSeries`) med minst `IMDB_MIN_VOTES` stemmer.
Filene strømmes; minnebruken er lav. Skriptet kan kjøres på nytt (upsert), og resultatet er det
samme. Ekte data gir omtrent 100–500 tusen titler avhengig av grensen, og tar noen minutter.
Mangler filene, gir skriptet en feilmelding som peker hit.

## 6. Kjør

```bash
npm run dev -w backend      # API på http://localhost:3001/graphql (GraphiQL i nettleseren)
npm run dev                 # backend + frontend sammen (fra roten)
```

Frontend kjører da på <http://localhost:5173/project2/> (Vite bruker `base: '/project2/'`, også i
utvikling). Vite proxyer `/project2/graphql` til backend på port 3001, så `VITE_GRAPHQL_URL` trengs ikke.

Prøv API-et:

```bash
curl -s localhost:3001/graphql -H 'content-type: application/json' \
  -d '{"query":"{ search(query: \"dark\", first: 3) { totalCount edges { node { id primaryTitle startYear } } } }"}'
```

Mutations krever headeren `x-user-id: <uuid>`.

Produksjonsbygg av backend:

```bash
npm run build -w backend
NODE_ENV=production npm start -w backend
```

### Bilder (TMDB)

IMDb-datasettene har ingen bilder. Backenden henter plakat, bakgrunnsbilde og handling fra TMDB
første gang en tittel trenger dem, og lagrer svaret i tabellen `title_artwork` (migrering
`002_title_artwork.sql`, kjøres av `npm run db:migrate`). Uten `TMDB_API_KEY` gjøres aldri
nettverkskall; feltene blir `null` og frontend viser plassholdere.

**Med falsk TMDB (utvikling, E2E, ingen internett):**

```bash
npm run tmdb:mock -w backend            # port 3999 (TMDB_MOCK_PORT), tegner plakater som SVG
TMDB_API_KEY=test TMDB_API_URL=http://localhost:3999/3 TMDB_IMAGE_URL=http://localhost:3999/t/p \
  npm run dev -w backend
```

Mocken svarer «ukjent» for hver 10. tittel-id, så plassholdere kan testes. `TMDB_MOCK_DELAY_MS`
legger på forsinkelse for å teste tidsgrensen.

**Med ekte nøkkel:** opprett en gratis konto på themoviedb.org og legg enten v3-nøkkelen eller
v4-lesetokenet (starter med `eyJ`) i `TMDB_API_KEY` i `.env`. La de to andre variablene stå tomme.
Vil du unngå ventetid i en demo, forhåndshent de mest populære titlene (kan avbrytes og kjøres
på nytt, maks ca. 30 kall i sekundet):

```bash
npm run db:artwork -w backend -- 2000   # antall titler; standard 2000
```

### Gratisfilmer fra Internet Archive

`npm run db:archive` fyller tabellen `title_streams` (migrering `003_title_streams.sql`) med lovlige
gratisfilmer fra Internet Archive, koblet til IMDb-titler. Vi lagrer bare pekere (element-id og
filnavn); videoen strømmes fra archive.org. Kjør `npm run db:migrate` og importer IMDb-titlene først.
Skriptet kan kjøres på nytt uten duplikater (upsert).

**Mot ekte Archive** (trenger internett, tar noen minutter; pent tempo, ca. 4 samtidige kall):

```bash
npm run db:archive                    # alle lovlige kandidater
npm run db:archive -- --limit 50      # bare de 50 første koblede (test). Env: ARCHIVE_LIMIT=50
```

**Mot falsk Archive** (utvikling, E2E, ingen internett; port `ARCHIVE_MOCK_PORT`, standard 3998):

```bash
npm run archive:mock -w backend                       # i ett terminalvindu
ARCHIVE_URL=http://localhost:3998 npm run db:archive  # i et annet: 5 filmer lagres
ARCHIVE_URL=http://localhost:3998 npm run dev -w backend
```

Mocken tilbyr noen elementer koblet til de kjente titlene i det syntetiske datasettet (Shawshank,
Godfather, Matrix, Pulp Fiction, Amélie), ett med ulovlig lisens, ett uten spillbar fil og ett uten
treff hos IMDb; alle skal hoppes over. Den serverer `e2e/fixtures/test-video.webm` med
`Accept-Ranges` og Range-støtte (206). `ARCHIVE_URL` (standard `https://archive.org`) må også være
satt for API-serveren, siden det avgjør hvilke URL-er `Title.stream` gir ut.

## 7. Test og kvalitetssjekk

```bash
npm run lint                  # eslint + prettier --check
npm run typecheck             # alle pakker
npm test                      # alle pakker; backend-testene trenger TEST_DATABASE_URL
npm test -w backend           # bare backend
```

Backend-testene nullstiller `TEST_DATABASE_URL`-databasen (`DROP SCHEMA public CASCADE`), migrerer den
fra scratch og setter inn et lite kontrollert datasett. De nekter å kjøre hvis
`TEST_DATABASE_URL` er lik `DATABASE_URL`. I GitLab CI peker `TEST_DATABASE_URL` på en tom
`postgres:16`-tjeneste (se `.gitlab-ci.yml`); ingen forberedelser trengs.

## 8. E2E-tester (Playwright)

Fra en ren klon, etter `npm ci`:

```bash
npx playwright install chromium             # på Linux evt. `--with-deps` (trenger sudo for systempakker)
npm run test:e2e
```

`npm run test:e2e` starter alt selv (se `playwright.config.ts`): falsk TMDB (port 3999), falsk
Internet Archive (3998), backend (3001, bygges først) og `vite preview` av produksjonsbygget (4173,
med samme CSP som Apache). Alle fire porter må være ledige når kjøringen starter. Utenfor CI gjenbrukes
tjenester som allerede kjører på portene; i CI (`CI=1`) starter Playwright alltid nye.

- **Database:** `e2e/global-setup.ts` oppretter databasen `project2_e2e` hvis den ikke finnes,
  migrerer den, fyller den med 20 000 syntetiske titler første gang, tømmer `reviews` og
  `list_items` hver kjøring og kjører `db:archive` mot den falske Archive. Postgres-brukeren må derfor
  ha `CREATEDB`, og trenger superbruker (eller ferdig installerte extensions) for `pg_trgm` og
  `unaccent`. Standard er `postgres://postgres@localhost:5432/project2_e2e`; overstyr med
  `E2E_DATABASE_URL`. Utviklings- og testdatabasen røres ikke.
- **Nettleser:** `PW_CHROMIUM_PATH` kan peke på en forhåndsinstallert Chromium (nyttig i CI-bilder
  og containere); uten den brukes Playwrights egen.
- **CI-modus:** `CI=1 npm run test:e2e` gir én retry, og en test som bare består på retry
  regnes som feil (`failOnFlakyTests`). Rapport i `playwright-report/`, JUnit i `test-results/`.

`npm run screenshots` lager skjermbildene i `docs/img/` (samme stack som E2E; `e2e/screenshots.spec.ts`
hoppes over uten `SCREENSHOTS=1`).

## Feilsøking

- `permission denied to create extension "pg_trgm"` (eller `"unaccent"`): kjør migrasjonen som superuser, eller kjør
  `CREATE EXTENSION pg_trgm; CREATE EXTENSION unaccent;` som superuser i databasen først.
- `Fant ikke datafilene`: gjør steg 5A eller 5B.
- `permission denied to create database` i E2E: gi brukeren `CREATEDB` eller opprett `project2_e2e` selv.
- `port … already in use` i E2E: frigjør portene 3001, 3998, 3999 og 4173.
- `password authentication failed`: sett riktig bruker/passord i `DATABASE_URL` / `TEST_DATABASE_URL`.
