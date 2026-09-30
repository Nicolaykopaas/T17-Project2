# PLAN – MVP

Målet er nådd når alle bokser under er krysset av og verifisert. Lederen krysser av, ikke utviklerne.

## Datasett (standardvalg)

IMDb non-commercial datasets (`title.basics.tsv.gz`, `title.ratings.tsv.gz`) fra https://datasets.imdbws.com – ingen API-nøkkel. Filtrer til filmer og serier med minst 100 stemmer (~100k+ rader). Bilder hoppes over i MVP (bærekraft), evt. placeholders.
Brukergenererte data: anmeldelser (1–5 stjerner + tekst) og "min liste".

## M0 – Oppsett

- [x] Monorepo med npm workspaces, TypeScript strict, ESLint, Prettier, Husky + lint-staged
- [x] Scripts i rot: `dev`, `build`, `lint`, `typecheck`, `test`, `test:e2e`, `db:migrate`, `db:seed`
- [x] `.env.example`, `.gitignore`, `docs/beslutninger.md`, `docs/ki-logg.md`, `BLOCKERS.md`
- [x] GitLab CI (`.gitlab-ci.yml`): lint, typecheck, unit-tester

## M1 – Database og import

- [x] Skjema + migrasjoner (titles, genres, reviews, lists), indekser inkl. `pg_trgm` GIN på tittel
- [x] Importskript som strømmer TSV (ikke les alt i minnet) og kan kjøres på nytt (idempotent)
- [x] `EXPLAIN ANALYZE` for søk før/etter indeks lagret i `docs/ytelse.md`

## M2 – GraphQL-API

- [x] `search(query, filters, sort, first, after)` med connection-type (edges, pageInfo, totalCount)
- [x] `title(id)` med detaljer og anmeldelser
- [x] `facets(query, filters)` → antall treff per sjanger / tiår / type
- [x] Mutations: `addReview`, `toggleList` (anonym bruker-id via cookie/localStorage-uuid)
- [x] Input-validering, feilhåndtering, maks `first`, query-dybde begrenset
- [x] API-tester for alle queries/mutations inkl. kanttilfeller

## M3 – Frontend

- [x] Søkefelt med debounce, case-insensitivt, tøm-knapp
- [x] Resultatliste med uendelig scroll + "Last flere"-knapp, skeleton-lasting
- [x] Filterpanel (sjanger, tiår, type, min. rating) med antall treff, aktive filtre som chips, nullstill
- [x] Sortering (relevans, rating, år, tittel) – alltid på server
- [x] Detaljside med anmeldelser og skjema for ny anmeldelse
- [x] "Min liste"-side
- [x] State i URL, tilbake-knapp bevarer scroll
- [x] Tomt/ingen treff/feil-tilstander med "prøv igjen"
- [x] Mørk modus (følger system), responsivt ned til 320 px

## M4 – Kvalitet

- [x] Komponenttester for søk, liste, filter, detaljside, anmeldelsesskjema
- [x] Playwright E2E: søk → filtrer → sorter → scroll → detalj → skriv anmeldelse → se den i lista
- [x] axe-sjekk i Playwright uten feil på alle sider
- [x] Lighthouse ≥ 90 på alle kategorier (resultat i `docs/ytelse.md`)
- [x] Alle tester, lint og typecheck grønne fra ren klon (`npm ci`)

## M5 – Deploy-klargjøring (kjøres ikke mot VM uten Nicolay)

- [x] `docs/deploy.md`: Postgres-oppsett, systemd-fil for backend, Apache-konfig for `/project2`, gzip/cache-headere
- [x] `deploy/`-mappe med systemd-unit og Apache-konfig ferdig utfylt for `it2810-17.idi.ntnu.no`

## M6 – Se lovlige filmer fra Internet Archive

Kun filmer som Internet Archive markerer som fri bruk (public domain eller Creative Commons). Vi
lenker til og strømmer fra archive.org og lagrer ingen video selv.

- [x] Backend: tabell `title_streams` (title_id, archive_id, fil, lisens, varighet) + migrering
- [x] Importskript `db:archive`: hent filmer fra Internet Archive-samlinger med fri lisens, koble til IMDb-titler via IMDb-ID i metadata (ellers tittel + år), velg en MP4-fil som nettlesere kan spille. Idempotent, testet mot falsk Archive-server
- [x] API: `Title.stream { url, license, archiveUrl }` og filter `availableOnly` (+ fasettantall)
- [x] Frontend: filter «Kun filmer du kan se», rad «Se gratis nå» på forsiden, merke på plakater
- [x] Videospiller på `/watch/:id`: spill/pause, spoling (tidslinje og ±10 s), volum og demping, fullskjerm, tastatur (mellomrom, piler, M, F), undertekster når de finnes, lisens og kilde under spilleren
- [x] Tester: import og kobling, API, spillerkontroller (komponent), E2E med liten testvideo, axe
- [x] Deploy: `setup-vm.sh` kjører `db:archive` etter importen

## Ferdig

- [x] Oppsummering i `docs/status.md`: hva er gjort, hva gjenstår, hva Nicolay må gjøre
