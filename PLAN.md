# PLAN – MVP

Målet er nådd når alle bokser under er krysset av og verifisert. Lederen krysser av, ikke utviklerne.

## Datasett (standardvalg)

IMDb non-commercial datasets (`title.basics.tsv.gz`, `title.ratings.tsv.gz`) fra https://datasets.imdbws.com – ingen API-nøkkel. Filtrer til filmer og serier med minst 100 stemmer (~100k+ rader). Bilder hoppes over i MVP (bærekraft), evt. placeholders.
Brukergenererte data: anmeldelser (1–5 stjerner + tekst) og "min liste".

## M0 – Oppsett

- [x] Monorepo med npm workspaces, TypeScript strict, ESLint, Prettier, Husky + lint-staged
- [ ] Scripts i rot: `dev`, `build`, `lint`, `typecheck`, `test`, `test:e2e`, `db:migrate`, `db:seed`
- [x] `.env.example`, `.gitignore`, `docs/beslutninger.md`, `docs/ki-logg.md`, `BLOCKERS.md`
- [x] GitLab CI (`.gitlab-ci.yml`): lint, typecheck, unit-tester

## M1 – Database og import

- [ ] Skjema + migrasjoner (titles, genres, reviews, lists), indekser inkl. `pg_trgm` GIN på tittel
- [ ] Importskript som strømmer TSV (ikke les alt i minnet) og kan kjøres på nytt (idempotent)
- [ ] `EXPLAIN ANALYZE` for søk før/etter indeks lagret i `docs/ytelse.md`

## M2 – GraphQL-API

- [ ] `search(query, filters, sort, first, after)` med connection-type (edges, pageInfo, totalCount)
- [ ] `title(id)` med detaljer og anmeldelser
- [ ] `facets(query, filters)` → antall treff per sjanger / tiår / type
- [ ] Mutations: `addReview`, `toggleList` (anonym bruker-id via cookie/localStorage-uuid)
- [ ] Input-validering, feilhåndtering, maks `first`, query-dybde begrenset
- [ ] API-tester for alle queries/mutations inkl. kanttilfeller

## M3 – Frontend

- [ ] Søkefelt med debounce, case-insensitivt, tøm-knapp
- [ ] Resultatliste med uendelig scroll + "Last flere"-knapp, skeleton-lasting
- [ ] Filterpanel (sjanger, tiår, type, min. rating) med antall treff, aktive filtre som chips, nullstill
- [ ] Sortering (relevans, rating, år, tittel) – alltid på server
- [ ] Detaljside med anmeldelser og skjema for ny anmeldelse
- [ ] "Min liste"-side
- [ ] State i URL, tilbake-knapp bevarer scroll
- [ ] Tomt/ingen treff/feil-tilstander med "prøv igjen"
- [ ] Mørk modus (følger system), responsivt ned til 320 px

## M4 – Kvalitet

- [ ] Komponenttester for søk, liste, filter, detaljside, anmeldelsesskjema
- [ ] Playwright E2E: søk → filtrer → sorter → scroll → detalj → skriv anmeldelse → se den i lista
- [ ] axe-sjekk i Playwright uten feil på alle sider
- [ ] Lighthouse ≥ 90 på alle kategorier (resultat i `docs/ytelse.md`)
- [ ] Alle tester, lint og typecheck grønne fra ren klon (`npm ci`)

## M5 – Deploy-klargjøring (kjøres ikke mot VM uten Nicolay)

- [ ] `docs/deploy.md`: Postgres-oppsett, systemd-fil for backend, Apache-konfig for `/project2`, gzip/cache-headere
- [ ] `deploy/`-mappe med systemd-unit og Apache-konfig ferdig utfylt for `it2810-17.idi.ntnu.no`

## Ferdig

- [ ] Oppsummering i `docs/status.md`: hva er gjort, hva gjenstår, hva Nicolay må gjøre
