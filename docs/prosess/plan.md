# PLAN – MVP

Målet er nådd når alle bokser under er krysset av og verifisert. Lederen krysser av, ikke utviklerne.

## Datasett (standardvalg)

IMDb non-commercial datasets (`title.basics.tsv.gz`, `title.ratings.tsv.gz`) fra https://datasets.imdbws.com – ingen API-nøkkel. Filtrer til filmer og serier med minst 100 stemmer (~100k+ rader). Datasettet har ingen bilder: plakater hentes fra TMDB og lagres i egen tabell (uten nøkkel vises plassholdere).
Brukergenererte data: anmeldelser (1–5 stjerner + tekst) og "min liste".

## M0 – Oppsett

- [x] Monorepo med npm workspaces, TypeScript strict, ESLint, Prettier, Husky + lint-staged
- [x] Scripts i rot: `dev`, `build`, `lint`, `typecheck`, `test`, `test:e2e`, `db:migrate`, `db:seed`
- [x] `.env.example`, `.gitignore`, `docs/beslutninger.md`, `docs/ki/ki-logg.md`, `docs/prosess/blokkeringer.md`
- [x] GitLab CI (`.gitlab-ci.yml`): lint, typecheck, unit-tester, build og E2E (build og E2E fra M7, #17)

## M1 – Database og import

- [x] Skjema + migrasjoner (titles, genres, reviews, lists), indekser inkl. `pg_trgm` GIN på tittel
- [x] Importskript som strømmer TSV (ikke les alt i minnet) og kan kjøres på nytt (idempotent)
- [x] `EXPLAIN ANALYZE` for søk før/etter indeks lagret i `docs/ytelse.md`

## M2 – GraphQL-API

- [x] `search(query, filters, sort, first, after)` med connection-type (edges, pageInfo, totalCount)
- [x] `title(id)` med detaljer og anmeldelser
- [x] `facets(query, filters)` → antall treff per sjanger / tiår / type
- [x] Mutations: `addReview`, `deleteReview` (egne anmeldelser, lagt til i M7), `toggleList` (anonym bruker-id via cookie/localStorage-uuid)
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
- [x] Mørk modus (følger system, bryter for brukervalg fra M7), responsivt ned til 320 px

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
- [x] Frontend: filter «Kun filmer som kan strømmes gratis», rad «Se gratis nå» på forsiden, merke på plakater
- [x] Videospiller på `/watch/:id`: spill/pause, spoling (tidslinje og ±10 s), volum og demping, fullskjerm, tastatur (mellomrom, piler, M, F), undertekster når de finnes, lisens og kilde under spilleren
- [x] Tester: import og kobling, API, spillerkontroller (komponent), E2E med liten testvideo, axe
- [x] Deploy: `setup-vm.sh` kjører `db:archive` etter importen

## M7 – Ferdigstilling etter medstudentvurdering

Issues og PR-er ligger på GitHub (flyttes til NTNU GitLab ved innlevering). Hver PR har review av en
kritiker-agent og ble rettet før merge.

- [x] #13 Tydelig feiltilstand når API-et ikke nås: global banner, `GET /health` (PR #19)
- [x] #14 Filteretikett «Kun filmer som kan strømmes gratis», kategorinavigasjon, rotårsak til ustabil checkbox rettet (`flushSync`) (PR #18)
- [x] #15 Backend-herding: memoisert kostnads- og dybdegrense, rate limit, `deleteReview`, aksentuavhengig søk (genererte kolonner), `tsvector`-ordprefiks for 1–2 tegn (PR #20)
- [x] #16 Frontend-gjennomgang: `inMyList` i Hero, listeknapp uten `aria-pressed`, feil i «Last flere» på Min liste, tegntelling per kodepunkt, stjerneopplesning, fokus til `h1` ved rutebytte, `ROW_QUERY` uten `totalCount`, tema-bryter, slett egen anmeldelse, `RATE_LIMITED`-melding (PR #21)
- [x] #17 CI med build og E2E (`failOnFlakyTests`), CSP fra Apache verifisert i E2E (PR #22)
- [x] #23 Kommentarer og dokumentasjon (PR #24 m.fl.)

## M8 – Klargjøring for sluttinnlevering (etter vurdering mot oppgaveteksten 2026-10-13)

En gjennomgang mot prosjektbeskrivelsen fant at produktet oppfyller alle funksjonelle og tekniske
krav (lint, typecheck, 490 backend-, 288 komponent- og 101 E2E-tester grønne fra ren klon), men at
prosessen (egen kontroll, samarbeid, review) og målinger på ekte data er svakt dokumentert. Punktene
er delt i det en agent kan gjøre, og det som krever gruppa (tilganger, VM, egne ord, egne vurderinger).

### Agent

- [ ] A1 `docs/prosess/status.md` oppdatert: integrasjonsgrenen er merget (PR #31), riktige testtall, dato, og «hva gjenstår» peker hit
- [ ] A2 Lighthouse med én kommando (`npm run lighthouse -- <url>`) fra egen maskin på VPN, som skriver en markdown-tabell klar for `docs/ytelse.md`. Ingen ny tung runtime-avhengighet i appen
- [ ] A3 `deploy/mal-ytelse.sh` og plassholdertabellen i `docs/ytelse.md` gjennomgått, så gruppa bare må kjøre og lime inn
- [ ] A4 Fasetter uten søk og filter (forsiden og «Se alle») teller ikke hele tabellen per request: bufret eller forhåndsberegnet, med test og måling før/etter
- [ ] A5 Flytting til NTNU GitLab: `docs/prosess/gitlab.md` med nøyaktige kommandoer (alle grener, issues og PR-historikk som tabell), MR- og issue-maler i `.gitlab/`
- [x] A6 Review-guide for gruppa: `docs/prosess/review-guide.md` med én kodedel per medlem (søk/paginering, frontend/tilgjengelighet, tester, deploy), hva de skal lese, sjekkliste og spørsmål sensor kan stille
- [ ] A7 Mal for «Gruppens egen gjennomgang» i `docs/ki/ki-deklarasjon.md` med konkrete spørsmål per medlem (fylles ut av gruppa, agenten skriver ingen svar)
- [ ] A8 README-støtte: `docs/readme-fakta.md` med fakta, tall og lenker gruppa kan skrive README fra med egne ord. README.md røres ikke
- [ ] A9 Konsistenssjekk av alle tall og påstander i `docs/` mot faktisk kode og testkjøring

### Gruppa (krever mennesker)

- [ ] G1 Flytte repoet til git.ntnu.no etter `docs/prosess/gitlab.md`, og se at CI-pipelinen blir grønn
- [ ] G2 På VM-en: `deploy/oppdater.sh`, deretter `deploy/mal-ytelse.sh`, og lime tabellen inn i `docs/ytelse.md`
- [ ] G3 Fra egen maskin på VPN: Lighthouse mot VM-adressen (A2), lim inn resultatet
- [ ] G4 Hvert medlem gjør review av sin del etter `review-guide.md` og legger inn minst én egen commit/MR (rettelse, test eller dokumentasjon) under eget navn
- [ ] G5 Fylle ut «Gruppens egen gjennomgang» i `docs/ki/ki-deklarasjon.md`
- [ ] G6 Skrive README.md med egne ord ut fra `docs/readme-fakta.md`
- [ ] G7 Bidragsfil i Canvas
- [ ] G8 Avgjøre commit-forfatter «Claude» (anbefaling: la stå, det er forklart i KI-deklarasjonen)

## Ferdig

- [x] Oppsummering i `docs/prosess/status.md`: hva er gjort, hva gjenstår, hva Nicolay må gjøre
