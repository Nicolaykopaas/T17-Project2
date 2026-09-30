# Filmsøk – IT2810 prosjekt 2, gruppe 17

Søk, filtrer og anmeld over 190 000 filmer og serier fra IMDb, i et kinoaktig grensesnitt med
plakater fra TMDB.

**Kjørende versjon:** <http://it2810-17.idi.ntnu.no/project2/> (krever NTNU-nett eller VPN)

## Innhold

- [Funksjonalitet](#funksjonalitet)
- [Datasett](#datasett)
- [Arkitektur og teknologi](#arkitektur-og-teknologi)
- [Søk, filtrering, sortering og paginering](#søk-filtrering-sortering-og-paginering)
- [Tilstandshåndtering](#tilstandshåndtering)
- [Tilgjengelighet](#tilgjengelighet)
- [Bærekraft](#bærekraft)
- [Testing](#testing)
- [Kjøre prosjektet](#kjøre-prosjektet)
- [Deploy på VM](#deploy-på-vm)
- [Bruk av KI](#bruk-av-ki)
- [Kjente begrensninger og videre arbeid](#kjente-begrensninger-og-videre-arbeid)

## Funksjonalitet

- **Forside i «bla-modus»:** hero-banner med den mest populære tittelen og rader med plakater
  (Mest populære, Høyest rangerte filmer, Populære serier og sjangerrader). Radene kan scrolles
  sidelengs med mus, berøring, knapper og piltaster. «Se alle» åpner søket med samme filter.
- **Søk** på tittel (primær- og originaltittel), uten skille på store og små bokstaver. Søket
  sendes 300 ms etter siste tastetrykk, og tomme eller uendrede søk sender ingen request.
- **Filtrering** på sjanger, tiår, type (film/serie) og minste IMDb-rating. Hvert valg viser
  antall treff (fasetter), og aktive filtre vises som chips som kan fjernes enkeltvis eller samlet.
- **Sortering** på relevans, rating, år eller tittel, stigende eller synkende.
- **Dynamisk lasting:** uendelig scroll med en synlig «Last flere»-knapp i tillegg.
- **Detaljside** med plakat, bakgrunnsbilde, handling, sjangre, spilletid, IMDb-rating og snittet
  av brukeranmeldelser.
- **Brukergenererte data:** anmeldelser (1–5 stjerner og tekst) og «Min liste». Brukeren er
  anonym og identifiseres med en tilfeldig UUID lagret i `localStorage`.
- **State i URL:** søk, filtre og sortering ligger i adressen, så lenker kan deles og
  tilbake-knappen bevarer både resultater og scroll-posisjon.
- Mørkt kinodesign som standard, lys variant når systemet ber om det. Responsivt ned til 320 px.

## Datasett

- [IMDb Non-Commercial Datasets](https://developer.imdb.com/non-commercial-datasets/)
  (`title.basics.tsv.gz` og `title.ratings.tsv.gz`). Vi tar med filmer og serier med minst 100
  stemmer, som gir **190 607 titler**.
- Plakater, bakgrunnsbilder og handlingsbeskrivelser hentes fra
  [TMDB](https://www.themoviedb.org/) ved behov og lagres i databasen (se under).
  _Dette produktet bruker TMDB-API-et, men er ikke godkjent eller sertifisert av TMDB._

Importskriptet (`backend/scripts/import-imdb.ts`) strømmer de komprimerte filene linje for linje i
stedet for å lese dem inn i minnet, og kan kjøres på nytt uten duplikater (upsert).

## Arkitektur og teknologi

| Del      | Valg                                                             |
| -------- | ---------------------------------------------------------------- |
| Frontend | React 19, TypeScript, Vite, React Router, Apollo Client          |
| Backend  | Node.js, TypeScript, GraphQL (graphql-yoga)                      |
| Database | PostgreSQL med `pg_trgm` og GIN-indekser                         |
| Testing  | Vitest, Testing Library, Playwright og axe-core                  |
| Kvalitet | ESLint, Prettier, Husky + lint-staged, GitLab CI                 |
| Drift    | Apache (statiske filer og proxy) og systemd (backend) på NTNU-VM |

```
frontend/   React-klienten (sider, komponenter, Apollo-oppsett)
backend/    GraphQL-API, migreringer, import og TMDB-integrasjon
e2e/        Playwright-tester (brukerflyt og tilgjengelighet)
deploy/     Oppsettskript, systemd-enhet og Apache-konfig for VM-en
docs/       API-kontrakt, beslutninger, ytelse, oppsett, deploy og KI-logg
```

API-et er beskrevet i [`docs/api.md`](docs/api.md). Viktige beslutninger og begrunnelser står i
[`docs/beslutninger.md`](docs/beslutninger.md).

### Bilder fra TMDB

IMDb-dataene har ingen bilder. Første gang en tittel vises, slår backenden den opp hos TMDB med
IMDb-ID-en og lagrer svaret, også «finnes ikke», i tabellen `title_artwork`. Etterpå kalles
ikke TMDB igjen for den tittelen. Et søk venter maks 2,5 s på bilder, og titler som ikke rakk
det, får en gradient-plassholder og hentes neste gang. Bildene lastes direkte fra TMDBs CDN.

## Søk, filtrering, sortering og paginering

- All søk, filtrering og sortering skjer i **SQL på hele datasettet**, aldri i klienten.
- Tittelsøk bruker `pg_trgm` med GIN-indeks. Relevans vektes med ord-likhet, likhet og
  popularitet, så «dark knight» gir «The Dark Knight» før obskure titler med samme navn.
- **Cursor-basert (keyset) paginering** på sorteringsverdi og ID gir stabile sider uten
  duplikater eller hull, også dypt ned i resultatene.
- Fasettene teller hver dimensjon med alle _andre_ filtre aktive, så brukeren ser hva et nytt
  valg vil gi.
- `EXPLAIN ANALYZE` før og etter indeksene står i [`docs/ytelse.md`](docs/ytelse.md). Et typisk
  søk gikk fra ca. 77 ms til 3 ms.
- Validering: `first` 1–50, søketekst maks 200 tegn, spørredybde maks 6, parameteriserte
  spørringer overalt og maskerte interne feil.

## Tilstandshåndtering

- **Apollo Client** med normalisert cache og `relayStylePagination` for søk, «Min liste» og
  anmeldelser. Innlastede sider ligger i cachen, så det går raskt tilbake fra en detaljside.
- **URL-en** er kilden til søk, filtre og sortering (`useSearchParams`).
- Anonym bruker-ID lagres i `localStorage` og sendes i headeren `x-user-id`.

## Tilgjengelighet

Målet er WCAG 2.1 AA.

- Semantisk HTML: landemerker, én `h1` per side, overskriftshierarki og lister.
- Skip-link «Hopp til innhold», og alt kan brukes med tastatur, også plakatradene med piltaster.
- Synlig fokus (`:focus-visible`), labels på alle skjemafelt og feilmeldinger koblet med
  `aria-describedby`.
- `aria-live` for antall treff og statusmeldinger, og `aria-busy` under lasting.
- `prefers-reduced-motion` skrur av animasjoner.
- Kontrast er sjekket i både mørkt og lyst tema.
- **Automatisk sjekket:** axe-core i Playwright på alle sider, i lys og mørk modus, uten brudd.
  Lighthouse Accessibility gir 100.

## Bærekraft

- Bildene er små: plakater i 185/342 px via `srcset`, `loading="lazy"`, og faste mål som
  hindrer layoutskift.
- Plakatrader under folden henter data først når de nærmer seg skjermen.
- Detaljside og «Min liste» lastes lazy (kodesplitting).
- TMDB-svar lagres i databasen, så hver tittel slås bare opp én gang.
- Mørkt tema som standard, som bruker mindre strøm på OLED-skjermer.
- Apache komprimerer tekstressurser (gzip), og filer med hash i navnet caches i ett år.
- Ingen tunge UI-biblioteker; vanlig CSS med custom properties.

## Testing

| Type                              | Verktøy                  | Antall |
| --------------------------------- | ------------------------ | -----: |
| API og resolvere mot testdatabase | Vitest                   |    209 |
| Komponenter                       | Vitest + Testing Library |    111 |
| Ende-til-ende (desktop og mobil)  | Playwright + axe-core    |     48 |

Testene dekker både vanlig og utypisk bruk:

- tomt søk, ingen treff, spesialtegn (`%`, `_`, `'`, emoji, aksenter) og svært lange strenger
- ugyldige cursorer og grenseverdier for `first`
- nettverksfeil med «Prøv igjen»
- validering av anmeldelser
- TMDB-feil og tidsavbrudd

E2E-testene går gjennom hele flyten: søk → filtrer → sorter → scroll → detalj → skriv anmeldelse →
se den i lista. De bruker en egen database og en falsk TMDB-server, så de trenger verken internett
eller API-nøkkel.

Lighthouse-resultater står i [`docs/ytelse.md`](docs/ytelse.md).

## Kjøre prosjektet

Krever Node.js 20+ og PostgreSQL 16+. Hele oppsettet står i [`docs/oppsett.md`](docs/oppsett.md).

```bash
npm ci
cp .env.example .env                # juster DATABASE_URL ved behov
createdb project2 && createdb project2_test
npm run db:migrate

# Data: ekte IMDb-filer i data/ …
wget -P data https://datasets.imdbws.com/title.basics.tsv.gz https://datasets.imdbws.com/title.ratings.tsv.gz
# … eller et syntetisk datasett uten nedlasting:
# npm run db:fixture -w backend
npm run db:seed

npm run dev                          # http://localhost:5173/project2/
```

For plakater setter du `TMDB_API_KEY` i `.env`, eller bruker den falske TMDB-serveren
(`npm run tmdb:mock -w backend`, se `docs/oppsett.md`).

| Kommando                        | Hva den gjør                                |
| ------------------------------- | ------------------------------------------- |
| `npm run lint`                  | ESLint og Prettier-sjekk                    |
| `npm run typecheck`             | TypeScript i alle pakker                    |
| `npm test`                      | Vitest i backend og frontend                |
| `npm run test:e2e`              | Playwright (starter servere selv)           |
| `npm run build`                 | Produksjonsbygg av backend og frontend      |
| `npm run db:artwork -w backend` | Forhåndshenter plakater for populære titler |

## Deploy på VM

Appen kjører på `it2810-17.idi.ntnu.no`:

- Apache serverer frontend fra `/project2/` og proxyer `/project2/graphql` til backenden.
- Backenden kjører på port 3001 som systemd-tjenesten `project2-backend`.

Oppdatering etter nye endringer er én linje fra PowerShell eller en terminal:

```bash
ssh -t <brukernavn>@it2810-17.idi.ntnu.no bash T17-Project2/deploy/oppdater.sh
```

`oppdater.sh` henter siste kode og kjører `setup-vm.sh`. Det skriptet installerer det som
mangler, bygger, migrerer, importerer data, henter plakater og publiserer. Første gang gis
TMDB-nøkkelen som argument (`oppdater.sh <nøkkel>`) og lagres bare i `.env` på VM-en.
`bash deploy/sjekk.sh` feilsøker hele kjeden. Mer i [`docs/deploy.md`](docs/deploy.md).

## Bruk av KI

Prosjektet er utviklet med Claude Code som KI-assistent:

- én hovedsesjon som planla, delegerte og verifiserte
- egne agenter for backend, frontend, testing og review
- rollene og reglene står i [`CLAUDE.md`](CLAUDE.md), planen i [`PLAN.md`](PLAN.md)

Hver oppgave er logget i [`docs/ki-logg.md`](docs/ki-logg.md). Valg KI-en tok på egen hånd er
begrunnet i [`docs/beslutninger.md`](docs/beslutninger.md). All kode er gjennomgått og testet før
merge, og gruppa har testet den publiserte versjonen på VM-en.

## Kjente begrensninger og videre arbeid

- **Ingen HTTPS på VM-en:** siden kjører på vanlig http. Det krever et sertifikat og trekker ned
  Lighthouse Best Practices.
- **Aksenter i søk:** «cafe» finner ikke «Café».
- **Korte søk:** søk på 1–2 tegn kan ikke bruke trigram-indeksen og er tregere.
- **Brukerdata følger nettleseren:** anmeldelser og liste er knyttet til nettleseren
  (`localStorage`), ikke til en innlogget bruker.
- **Tekst fra TMDB:** handlingsbeskrivelsene er på engelsk.
