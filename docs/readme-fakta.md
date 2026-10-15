# Fakta til README

> **README.md skal skrives av gruppa med egne ord** (se `CLAUDE.md`). Denne fila er bare et
> faktagrunnlag: hvor kravene er løst, tall som er sjekket, hovedvalgene og installasjonsstegene.
> Ikke kopier teksten rett inn. Sjekk tallene på nytt hvis koden er endret etter 2026-10-13.

## Krav og hvor de er løst

| Krav                          | Løsning i én setning                                                                                     | Filer                                                                                                                               |
| ----------------------------- | -------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------- |
| Søk                           | Debounce 300 ms, ingen request for tomt eller uendret søk, aksentuavhengig, ordprefiks ved 1–2 tegn.     | `frontend/src/components/SearchBox.tsx`, `backend/src/search.ts`, `backend/migrations/004_unaccent_search.sql`                      |
| Store resultatsett            | Cursor-paginering (keyset) i SQL, 20 per side, uendelig scroll med «Last flere» som alternativ.          | `backend/src/keyset.ts`, `frontend/src/components/SearchResults.tsx`, `frontend/src/hooks/useInfiniteScroll.ts`                     |
| Detaljvisning                 | Egen side per tittel med handling, sjangre, rating, anmeldelser og eventuell gratisfilm.                 | `frontend/src/pages/TitlePage.tsx`, `frontend/src/pages/WatchPage.tsx`, `frontend/src/components/VideoPlayer.tsx`                   |
| Sortering og filtrering       | Sjanger, tiår, type, minste rating og «gratis», med antall treff per valg. Alt i SQL på hele datasettet. | `backend/src/search.ts`, `frontend/src/components/FilterPanel.tsx`, `frontend/src/components/SortControls.tsx`                      |
| Brukergenererte data          | Anmeldelser (1–5 og tekst, egne kan slettes) og «Min liste», lagret i PostgreSQL.                        | `backend/src/resolvers/index.ts`, `frontend/src/components/ReviewForm.tsx`, `frontend/src/pages/MyListPage.tsx`                     |
| State management              | Apollo Client (cache, paginering, reactive var for API-status). URL-en er eneste kilde til søketilstand. | `frontend/src/apollo/cache.ts`, `frontend/src/apollo/apiStatus.ts`, `frontend/src/hooks/useSearchState.ts`                          |
| GraphQL-API                   | GraphQL Yoga med dybde-, kostnads- og `first`-grense (maks 50), rate limit og maskerte feil.             | `backend/src/typeDefs.ts`, `backend/src/complexityLimit.ts`, `backend/src/depthLimit.ts`, `backend/src/rateLimit.ts`, `docs/api.md` |
| Database på VM-en             | PostgreSQL med `pg_trgm`, `unaccent` og GIN-indekser. Migreringer og importskript ligger i repoet.       | `backend/migrations/`, `backend/scripts/migrate.ts`, `backend/scripts/import-imdb.ts`, `deploy/setup-vm.sh`                         |
| Tilgjengelighet (WCAG 2.1 AA) | Semantisk HTML, tastatur overalt, synlig fokus, fokus til `h1` ved rutebytte, `aria-live` for treff.     | `frontend/src/components/Layout.tsx`, `frontend/src/components/SearchResults.tsx`, `e2e/a11y.spec.ts`                               |
| Bærekraft                     | Lazy-lastede ruter og rader, `srcset`, gzip og `immutable`-cache, mørk modus som standard.               | `frontend/src/routes.tsx`, `frontend/src/hooks/useNearViewport.ts`, `deploy/apache-project2.conf`                                   |
| Design og responsivitet       | Kinoinspirert, mørk og lys variant, bla-modus med rader og søkemodus med filtre, ned til 320 px.         | `frontend/src/styles/global.css`, `frontend/src/pages/HomePage.tsx`, `frontend/src/components/ThemeToggle.tsx`                      |
| Testing                       | API-tester mot ekte PostgreSQL, komponenttester og Playwright E2E med axe på desktop og mobil.           | `backend/test/`, `frontend/src/**/*.test.tsx`, `e2e/`, `docs/forklaring.md#9-testoppsett`                                           |
| Deploy                        | Node som systemd-tjeneste på port 3001 bak Apache, frontend bygd med `base: '/project2/'`.               | `deploy/`, `frontend/vite.config.ts`, `docs/deploy.md`                                                                              |
| Prosess, git og KI            | Grener, issues og PR-er med review. KI-bruk beskrevet åpent.                                             | `docs/prosess/grener-og-pr.md`, `docs/prosess/gitlab.md`, `docs/ki/ki-deklarasjon.md`                                               |

## Tall

| Tall                                            | Verdi                                                        | Kilde og status                                                                     |
| ----------------------------------------------- | ------------------------------------------------------------ | ----------------------------------------------------------------------------------- |
| Titler i produksjon                             | 190 607 (filmer og serier med minst 100 stemmer)             | `docs/beslutninger.md#datasett`, `docs/prosess/status.md`. Talt av Nicolay på VM-en |
| Backendtester (Vitest mot PostgreSQL)           | 502 i 24 filer                                               | Kjørt på nytt 2026-10-13: alle grønne. `README.md` oppgir et eldre tall             |
| Komponenttester (Vitest + Testing Library)      | 288 i 27 filer                                               | Kjørt på nytt 2026-10-13: alle grønne                                               |
| E2E-tester (Playwright, desktop og mobil)       | 101 bestått, 15 hoppet over, 0 ustabile                      | Kjørt på nytt 2026-10-13 i CI-modus. `README.md` oppgir 101 uten de hoppede         |
| Søk «dark», sortert på rating                   | 76,7 ms uten indekser, 3,1 ms med                            | `docs/ytelse.md`, syntetiske data (120 000 titler)                                  |
| Søk «dark», relevans                            | 82,4 ms uten indekser, 8,9 ms med                            | `docs/ytelse.md`, syntetiske data                                                   |
| Ingen søketekst, sortert på rating              | 24,2 ms uten indekser, 0,03 ms med                           | `docs/ytelse.md`, syntetiske data                                                   |
| Kort søk «a» (relevans)                         | 314,0 ms før ordprefiks, 0,18 ms etter                       | `docs/ytelse.md`, «Aksentfolding og korte søk»                                      |
| Vanlig ord «the» (relevans)                     | ca. 140 ms (kjent begrensning)                               | `docs/ytelse.md`, «Ærlige merknader»                                                |
| Import av 120 000 syntetiske titler             | ca. 17 s                                                     | `docs/ytelse.md`, «Importtid»                                                       |
| Lighthouse 2026-10-06 (Performance/A11y/BP/SEO) | Mobil 93–98 / 100 / 100 / 100, desktop 100 / 100 / 100 / 100 | `docs/ytelse.md#lighthouse`, lokalt produksjonsbygg, ikke VM-en                     |
| Initial JavaScript                              | ca. 170 kB gzip                                              | `docs/beslutninger.md`, «Frontend: ingen nye biblioteker»                           |

Alle ytelsestall er målt på syntetiske data. Tabellen for ekte data i `docs/ytelse.md` («Måle på
VM-en») er ikke fylt ut ennå. Testtallene over er kjørt på nytt 2026-10-13 etter at fasett-cachen kom inn.

## Hovedvalg

Lenkene går til [`beslutninger.md`](beslutninger.md). Der valget står i den lange punktlista øverst,
er navnet på punktet oppgitt i anførselstegn.

| Valg                                                       | Hvorfor, kort                                                                             | Hvor                                                                   |
| ---------------------------------------------------------- | ----------------------------------------------------------------------------------------- | ---------------------------------------------------------------------- |
| PostgreSQL med trigram-GIN mot normaliserte tittelkolonner | Delstrengsøk uten å lese hele tabellen, og aksentfolding uten å kjøre `unaccent` per rad. | «Søk med `LIKE` mot normaliserte tittelkolonner og trigram-GIN»        |
| Keyset-paginering, ikke `OFFSET`                           | Like rask på side 1000 som side 1, og ingen hull eller duplikater.                        | «Keyset-paginering med radsammenligning»                               |
| Egen relevansformel                                        | Ren likhet rangerte obskure titler over klassikeren brukeren mener.                       | «Relevans = `0,6 * word_similarity + …`»                               |
| `totalCount` bare når feltet etterspørres                  | Telling er den dyreste delen av et bredt søk.                                             | «`totalCount` er lazy»                                                 |
| URL som eneste kilde til søketilstand                      | Deling, bokmerker og tilbake-knappen virker uten egen synkronisering.                     | «Frontend: URL som eneste kilde til søketilstand»                      |
| Tester mot ekte PostgreSQL, ikke mock                      | SQL, indekser og migreringer testes sammen.                                               | «Tester mot ekte Postgres»                                             |
| Plakater fra TMDB lagret i egen tabell                     | TMDB har rate-grenser, og `titles` skal være en ren, reimporterbar IMDb-kopi.             | «Bilder fra TMDB, lagret i egen tabell, ikke proxyet»                  |
| Bare lovlige filmer fra Internet Archive, bare pekere      | Lisens sjekkes per element, og vi lagrer ingen video selv.                                | «Strømming fra Internet Archive (M6)», «Lisensregel for importen»      |
| Få biblioteker (ingen UI-, spiller- eller ORM-bibliotek)   | Mindre JavaScript, full kontroll over fokus, kontrast og SQL.                             | [Biblioteker](beslutninger.md#biblioteker)                             |
| Ingen SSR                                                  | En statisk SPA bak Apache er enklere å drifte. Prisen er noen poeng på mobil-Lighthouse.  | [Hvorfor ikke SSR](beslutninger.md#hvorfor-ikke-ssr)                   |
| Egen migreringsrunner                                      | Vi trenger bare «kjør nye SQL-filer i rekkefølge», og testene gjenbruker den.             | «Egen migreringsrunner»                                                |
| Oppsett med to kommandoer                                  | `npm run setup` og `npm run dev` virker likt på Windows, macOS og Linux.                  | [Oppsett med to kommandoer](beslutninger.md#oppsett-med-to-kommandoer) |
| Grener og integrasjonsgren                                 | Sky-miljøet kan bare pushe til én gren, så en integrasjonsgren har rollen til `mvp`.      | «Git-grener», og [`prosess/grener-og-pr.md`](prosess/grener-og-pr.md)  |

Mer om bærekraft og sikkerhet: [Bærekraft](beslutninger.md#bærekraft) og
[Sikkerhet og robusthet](beslutninger.md#sikkerhet-og-robusthet).

## Installasjon

Krever Node.js 20 eller nyere og PostgreSQL med contrib-pakken (`pg_trgm`, `unaccent`).

```bash
npm ci
npm run setup    # lager databasene og fyller dem med syntetiske data
npm run dev      # http://localhost:5173/project2/
```

Tester og kvalitetssjekk:

```bash
npm run lint
npm run typecheck
npm test            # backend mot testdatabasen og komponenttester
npm run test:e2e    # Playwright med axe
```

Ekte IMDb-data, plakater fra TMDB og gratisfilmer fra Internet Archive: [`oppsett.md`](oppsett.md).
Deploy og oppdatering på VM-en: [`deploy.md`](deploy.md). Kjørende versjon:
<http://it2810-17.idi.ntnu.no/project2/> (krever NTNU-nett eller VPN).
