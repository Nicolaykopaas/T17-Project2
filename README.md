# Filmsøk – IT2810 prosjekt 2, gruppe 17

Søk, filtrer, sorter og anmeld over 190 000 filmer og serier fra IMDb, med plakater fra TMDB og
lovlige gratisfilmer fra Internet Archive som kan spilles direkte i appen.

**🔗 Kjørende versjon:** <http://it2810-17.idi.ntnu.no/project2/>. Krever NTNU-nett eller VPN.
Får klienten ikke kontakt med API-et (for eksempel når frontend kjøres lokalt uten backend), viser
appen ett banner som forklarer hvorfor, i stedet for feil i hver rad.

## Innhold

1. [Arbeidsfordeling](#arbeidsfordeling)
2. [Funksjonalitet](#funksjonalitet)
3. [Arkitektur](#arkitektur)
4. [Valg og begrunnelser](#valg-og-begrunnelser)
5. [Tilgjengelighet](#tilgjengelighet)
6. [Bærekraft](#bærekraft)
7. [Sikkerhet og robusthet](#sikkerhet-og-robusthet)
8. [Testing](#testing)
9. [Kjøre lokalt](#kjøre-lokalt)
10. [Deploy på VM](#deploy-på-vm)
11. [Prosess og bruk av KI](#prosess-og-bruk-av-ki)
12. [Kjente begrensninger](#kjente-begrensninger)
13. [Videre dokumentasjon](#videre-dokumentasjon)

## Arbeidsfordeling

| Navn    | Ansvarsområde                                                        |
| ------- | -------------------------------------------------------------------- |
| Nicolay | Prosjektleder. Arkitektur, GraphQL-API og React, frontend og backend |
| Sturla  | Backendansvarlig: database, import og resolvere                      |
| Brage   | Frontendansvarlig: komponenter, design og tilgjengelighet            |
| Daniel  | Testansvarlig: enhets-, komponent- og E2E-tester                     |

Mye av koden er skrevet av KI-agenter styrt av gruppa (se [Prosess og bruk av KI](#prosess-og-bruk-av-ki)),
så git-historikken viser ikke hvem som har vurdert, testet og godkjent hva. Den enkeltes bidrag er
beskrevet i egen fil i Canvas.

## Funksjonalitet

| Krav i oppgaven         | Slik er det løst                                                                                                                                                                                   |
| ----------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Søk                     | Søkefelt med 300 ms debounce. Skiller ikke store og små bokstaver eller aksenter («amelie» finner «Amélie»). Ingen request for tomt eller uendret søk. Korte søk (1–2 tegn) matcher starten av ord |
| Store resultatsett      | Uendelig scroll med «Last flere»-knapp som alternativ. Cursor-paginering (keyset) i SQL, 20 per side                                                                                               |
| Detaljer                | Egen side per tittel med handling, sjangre, rating, anmeldelser og eventuell gratisfilm                                                                                                            |
| Sortering og filtrering | Sjanger, tiår, type, minste rating og «Kun filmer som kan strømmes gratis». Antall treff per valg. Sortering på relevans, rating, år og tittel. Alt skjer i SQL på hele datasettet                 |
| Brukergenererte data    | Anmeldelser (1–5 stjerner og tekst) og «Min liste», lagret i PostgreSQL. Egne anmeldelser kan slettes                                                                                              |
| Tilgjengelighet         | WCAG 2.1 AA. Se [Tilgjengelighet](#tilgjengelighet)                                                                                                                                                |
| Bærekraft               | Se [Bærekraft](#bærekraft)                                                                                                                                                                         |
| Design                  | Kinoinspirert, mørkt grensesnitt med lys variant. «Bla-modus» med rader og kategorinavigasjon når søket er tomt, «søkemodus» med filtre og liste når man søker                                     |

I tillegg:

- **Søketilstanden ligger i URL-en.** Søk, filtre og sortering kan deles og bokmerkes, og
  tilbake-knappen gjenoppretter både resultat og scroll-posisjon.
- **Gratisfilmer kan spilles i appen.** Bare filmer som Internet Archive merker som public domain
  eller Creative Commons. Egen videospiller med tastaturstyring og undertekster når de finnes.
- **Tema:** følger systemet, og kan overstyres med en bryter i headeren.
- **Tydelige feiltilstander:** tomt søk, ingen treff, nettverksfeil med «Prøv igjen», og ett
  forklarende banner når API-et ikke kan nås.

## Arkitektur

```
Nettleser (React + Apollo Client)
   │  GET /project2/…            statiske filer (Vite-bygg), Apache med gzip og cache-headere
   │  POST /project2/graphql ──▶ Apache (reverse proxy) ──▶ Node + GraphQL Yoga :3001 (127.0.0.1)
   │                                                            │
   │                                                            ├─▶ PostgreSQL (pg_trgm, unaccent)
   │                                                            └─▶ TMDB API (plakater, bufret i DB)
   └─ video ──────────────────────────────────────────────────────▶ archive.org (direkte)
```

```
backend/
  migrations/      SQL-migreringer (skjema, indekser, genererte søkekolonner)
  scripts/         migrering, IMDb-import, Internet Archive-import, syntetisk datasett, falske tjenester for test
  src/             GraphQL-skjema, resolvere, søk (search.ts), validering, grenser, feilhåndtering
  test/            API-tester mot ekte PostgreSQL
frontend/src/
  apollo/          klient, cache-policyer, nedetidstilstand (reactive var)
  components/      gjenbrukbare komponenter med tester ved siden av
  pages/           sider (lazy-lastet unntatt forsiden)
  hooks/, lib/     søketilstand ↔ URL, debounce, uendelig scroll, formatering
e2e/               Playwright-tester med axe
deploy/            systemd-enhet, Apache-konfig, oppsett- og oppdateringsskript for VM-en
docs/              beslutninger, API-kontrakt, oppsett, deploy, ytelse, KI-logg og KI-deklarasjon
```

## Valg og begrunnelser

Alle valg er beskrevet med begrunnelse i [`docs/beslutninger.md`](docs/beslutninger.md). Her er de
viktigste.

### Datasett

[IMDb non-commercial datasets](https://developer.imdb.com/non-commercial-datasets/) er åpne, store
og realistiske. Vi tar med filmer og serier med minst 100 stemmer, som gir 190 607 titler på VM-en.
IMDb har ingen bilder, så plakater og handling hentes fra TMDB første gang en tittel vises, og
lagres i databasen. Uten TMDB-nøkkel vises plassholdere.

### Database: PostgreSQL

Søk med delstrenger, fasettelling og stabil paginering over hundretusener av rader krever en
database som kan indeksere tekst. PostgreSQL gir dette uten ekstra tjenester:

- **`pg_trgm` med GIN-indekser** gjør delstrengsøk («dark» i «The Dark Knight») indeksert.
  Det tar 3 ms i stedet for 77 ms på 120 000 titler.
- **`unaccent`** i en IMMUTABLE wrapper-funksjon, lagret i genererte kolonner. Dermed blir
  aksentfolding gjort én gang ved skriving, ikke for hver rad ved hvert søk.
- **`tsvector` med prefikssøk** for søk på 1–2 tegn, der trigrammer ikke virker. «a» gikk fra
  ca. 300 ms til 0,2 ms.
- **B-tre-indekser per sorteringsnøkkel**, slik at sortert paginering kan lese i indeksrekkefølge.

Målinger før og etter står i [`docs/ytelse.md`](docs/ytelse.md).

### Paginering: cursor (keyset), ikke `OFFSET`

`OFFSET` blir tregere jo lenger ned man scroller, og gir hull eller duplikater hvis data endres.
Vi bruker radsammenligning på sorteringsnøklene med `id` som siste nøkkel, for eksempel
`(rating, votes, id) < ($1, $2, $3)`. For sorteringene med indeks (rating, år, tittel, popularitet)
er side 1000 like rask som side 1. Relevanssortering med søketekst må regne likhet for alle treff, men
det gjelder hver side likt og er ikke avhengig av hvor langt man har scrollet. Cursoren inneholder en
signatur for sorteringen og avvises hvis den brukes med en annen sortering.

### Filtrering og fasetter

Hver fasett telles med de _andre_ filtrene aktive. Antallet ved «Drama» viser altså hvor mange
treff du får hvis du også krysser av for Drama. Valgte verdier vises også når de har 0 treff, så de
ikke forsvinner under brukeren. `totalCount` regnes bare ut når klienten ber om det, og forsiderader
ber ikke om det.

### API: GraphQL med GraphQL Yoga

Klienten henter nøyaktig de feltene hver visning trenger. Listene henter for eksempel bare
`stream { url }`, mens detaljsiden henter hele strømmeinformasjonen. Kontrakten står i
[`docs/api.md`](docs/api.md). Viktige egenskaper:

- **Ingen N+1:** en batch-loader per request henter `inMyList`, rating og antall anmeldelser for en
  hel side i én spørring per felt.
- **Grenser:**
  - `first` er maks 50.
  - Spørringsdybden er maks 6.
  - En kostnadsgrense teller felt og vekter lister med `first`.
  - Rate limiting på mutations.
  - `statement_timeout` er 15 s.
- **Feil:** egne feilkoder (`BAD_USER_INPUT`, `NOT_FOUND`, `RATE_LIMITED`, `SERVICE_UNAVAILABLE`).
  Uventede feil maskeres, og detaljene logges bare på serveren. Introspeksjon og GraphiQL er av i
  produksjon.

### State: Apollo Client og URL-en

- **URL-en er eneste kilde til søketilstand** (`useSearchState`). Da fungerer deling, bokmerker og
  tilbake-knappen uten egen synkronisering.
- **Apollo-cachen** bruker `relayStylePagination` med sortering og filtre som nøkkel. Sider for
  samme søk slås sammen, og et tilbake-klikk viser innlastede sider uten ny request.
- **Reactive var** brukes for global klienttilstand som ikke hører hjemme i URL-en, for eksempel
  om API-et kan nås.
- **Anonym bruker-ID** (UUID i `localStorage`) sendes i en header. Vi har valgt bort innlogging for å
  holde prosjektet innenfor rammen, se [Kjente begrensninger](#kjente-begrensninger).

### Egne komponenter og hooks

Komponentene er delt etter ansvar, slik at logikk som er vanskelig å få riktig (debounce, fokus,
lazy-lasting, paginering) ligger ett sted og kan testes isolert:

| Komponent / hook                                    | Ansvar og hvorfor den er skilt ut                                                                                                                                                              |
| --------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `useSearchState` (+ `lib/searchState.ts`)           | Leser og skriver søk, filtre og sortering i URL-en. Eneste kilde til søketilstand, så alle komponenter er enige                                                                                |
| `SearchBox`, `HeaderSearch`, `useDebouncedCallback` | `SearchBox` debouncer (300 ms) og hopper over tomme og uendrede søk. `HeaderSearch` kobler den til URL-en: på forsiden endres bare `q`, fra andre sider sendes brukeren til forsiden med søket |
| `FilterPanel`, `ActiveFilters`, `SortControls`      | Fasetter med antall treff, aktive filtre som chips og sortering. Endrer bare URL-en; serveren gjør resten                                                                                      |
| `SearchResults`, `useInfiniteScroll`                | Resultatliste med uendelig scroll og «Last flere», `aria-live` for antall treff og alle tom-, feil- og lastetilstander                                                                         |
| `TitleRow`, `LazyRow`, `useNearViewport`            | Forsiderader som henter data først når de nærmer seg skjermen. Piltaster flytter fokus mellom kortene i raden                                                                                  |
| `CategoryNav`                                       | Hopp til kategori på forsiden, med fokus på raden også når den er tom                                                                                                                          |
| `PosterCard`                                        | Plakat med `srcset`. Tittellenken strekkes over hele kortet, så hvert kort er ett tabulatorstopp i stedet for to                                                                               |
| `Layout`                                            | Header, skip-link, fokus til sidens `h1` ved rutebytte, og plassen for API-banneret                                                                                                            |
| `ApiUnavailableBanner` (+ `apollo/apiStatus.ts`)    | Ett globalt banner når API-et ikke kan nås, styrt av en reactive var som Apollo-linken setter                                                                                                  |
| `ReviewForm`, `ReviewList`, `DeleteReviewButton`    | Anmeldelser med validering som speiler backenden (tegn telles som kodepunkter) og sletting med bekreftelse på stedet                                                                           |
| `ListToggleButton`                                  | Legg i / fjern fra Min liste, med kunngjøring av utfallet                                                                                                                                      |
| `VideoPlayer`                                       | Egen spiller på `<video>` med norske etiketter og tastaturstyring                                                                                                                              |
| `ThemeToggle`, `useTheme`                           | Brukervalgt tema som overstyrer systemet, synkronisert mellom faner                                                                                                                            |

GraphQL-typene i frontend (`graphql/types.ts`) er håndskrevne og speiler [`docs/api.md`](docs/api.md).
Med et lite skjema var det enklere enn å sette opp kodegenerering. En backend-test validerer alle
frontendens spørringer mot skjemaet, slik at avvik oppdages.

### Biblioteker

Vi har valgt få, veletablerte avhengigheter, og bevisst valgt bort tunge UI-biblioteker:

| Bibliotek                                | Hvorfor                                                                                                           |
| ---------------------------------------- | ----------------------------------------------------------------------------------------------------------------- |
| React 19, React Router, Vite             | Krav i oppgaven. Router gir lazy-lastede ruter og innebygd scroll-gjenoppretting                                  |
| Apollo Client                            | Normalisert cache, paginering og reactive vars. Erstatter egen state-håndtering                                   |
| GraphQL Yoga, `pg`                       | Lett GraphQL-server med gode utvidelsespunkter for validering og feil. `pg` gir parametriserte spørringer direkte |
| Vitest, Testing Library, Playwright, axe | Komponenttester som tester oppførsel, E2E i ekte nettleser og automatisk WCAG-sjekk                               |
| ESLint (med `jsx-a11y`), Prettier, Husky | Lik kodestil og tilgjengelighetslinting før hver commit                                                           |

**Ikke brukt, med vilje:**

- **Komponentbibliotek (MUI o.l.):** kunne gitt raskere oppstart, men ville gitt mer JavaScript og
  mindre kontroll over fokus og kontrast.
- **Spillerbibliotek:** videospilleren er bygd på `<video>` (ca. 4 kB gzip), fordi den innebygde
  spilleren varierer i tastaturstøtte og ikke kan få norske etiketter.
- **ORM:** søket er det viktigste i appen, og vi ville ha full kontroll over SQL-en og indeksbruken.
  All input er parametrisert.

## Tilgjengelighet

Målet er WCAG 2.1 AA, og det er verifisert automatisk og med tastatur:

- **Semantisk HTML:** landemerker, overskriftshierarki, `<nav>` for kategorier, ekte knapper og
  lenker. Skip-link til hovedinnholdet.
- **Tastatur overalt:**
  - piltaster flytter fokus mellom kortene i en rad
  - videospilleren styres med mellomrom, piler, M og F
  - sletting bekreftes på stedet, ikke i `window.confirm`
- **Fokushåndtering:**
  - Ved rutebytte flyttes fokus til sidens `h1`, så skjermlesere leser ny side.
  - Kategorihopp flytter fokus til raden.
  - Etter sletting flyttes fokus til listeoverskriften.
  - I flytene vi tester (rutebytte, kategorihopp, sletting, avbrutt sletting, feilbanner) havner
    fokus aldri på `<body>`.
- **Skjermleser:**
  - `aria-live` for antall treff og statusmeldinger
  - ett `role="alert"`-banner ved nedetid i stedet for én feil per rad
  - stjerner leses som «4,3 av 5»
  - knapper har etiketter som beskriver handlingen
- **Visuelt:** synlig fokusring, AA-kontrast i lys og mørk modus, `prefers-reduced-motion` respekteres,
  og responsivt ned til 320 px uten horisontal scroll.
- **Verifisering:** axe kjører i Playwright på alle sider i lys og mørk modus, på desktop og mobil.
  Lighthouse Accessibility var 100 på forside, detaljside og Min liste. Det er målt lokalt
  30.09.2026 mot produksjonsbygget med syntetiske data, før endringene i oktober (se
  [`docs/ytelse.md`](docs/ytelse.md)).

## Bærekraft

- **Mindre data over nettet:**
  - Detaljside, Min liste og spiller lazy-lastes.
  - Forsiderader under folden henter data først når de nærmer seg skjermen (IntersectionObserver).
  - Bilder har `srcset` og `sizes` og lastes lazy.
  - Lister henter bare feltene de viser.
- **Mindre arbeid på serveren:**
  - Indekserte søk og cursor-paginering.
  - `totalCount` regnes bare ut når det vises. Det fjernet 8 `count(*)` per forsidevisning.
  - TMDB-svar bufres i databasen.
  - Søk debounces, og uendrede søk sendes ikke.
- **Cache:** byggede filer har innholdshash og `Cache-Control: immutable`. `index.html` revalideres.
  Apache komprimerer med gzip, og Apollo gjenbruker data ved navigering.
- **Video:** strømmes direkte fra archive.org, og vi velger den minste spillbare filen. Vi lagrer
  ingen video selv.
- **Mørk modus** er standard i kinodesignet, noe som sparer strøm på OLED-skjermer. Lys modus kan
  velges.
- **Få avhengigheter:** ingen UI-, spiller- eller ORM-bibliotek. Lighthouse Performance var 94–100 ved
  siste lokale måling (30.09.2026, før endringene i oktober).

## Sikkerhet og robusthet

- SQL er alltid parametrisert. Brukerens `%`, `_` og `\` escapes etter aksentfolding, slik at
  fullbreddevarianter ikke blir jokertegn.
- Kostnads- og dybdegrense mot dyre spørringer. De er memoisert, så nøstede fragmenter ikke kan
  låse CPU-en.
- Rate limiting av mutations per bruker og IP. Backenden lytter bare på `127.0.0.1` i produksjon, så
  den ikke kan nås forbi Apache.
- `/health` sjekker databasen. systemd starter backenden på nytt ved feil.
- Content-Security-Policy og andre sikkerhetsheadere i Apache.
- Ingen hemmeligheter i git: `.env` er ignorert, og `.env.example` dokumenterer alle variabler.

## Testing

| Type                                            |        Antall | Kommando           |
| ----------------------------------------------- | ------------: | ------------------ |
| API og database (Vitest mot ekte PostgreSQL)    |  TALL_BACKEND | `npm test`         |
| Komponenter og hooks (Vitest + Testing Library) | TALL_FRONTEND | `npm test`         |
| E2E med axe (Playwright, desktop og mobil)      |      TALL_E2E | `npm run test:e2e` |

**Typisk bruk** testes med hele flyten: søk, filtrer, sorter, scroll, åpne detalj, skriv anmeldelse
og se den i lista, legg i og fjern fra Min liste, og spill en gratisfilm med tastatur.

**Utypisk bruk:**

- **Søk:** tomt søk, ingen treff, ett tegn, spesialtegn (`%`, `_`, `\`, `'`, fullbredde, emoji,
  NUL), aksenter og veldig lange strenger.
- **Ugyldig input:** ugyldig cursor, cursor fra en annen sortering, `first` utenfor grensene,
  ugyldige id-er.
- **Angrep og misbruk:** SQL-injeksjonsforsøk, dype og dyre spørringer, nøstede fragmenter og
  rate limit.
- **Samtidighet og feil:** samtidige toggles, nettverksfeil, API utilgjengelig, database nede
  (`SERVICE_UNAVAILABLE`), og http uten `crypto.randomUUID`.
- **Visning:** 320 px skjermbredde, mørk og lys modus, og tom rad etter kategorihopp.

**Testoppsett:**

- Backend-testene kjører mot en egen PostgreSQL-database uten mocking, slik at SQL, indekser og
  migreringer testes sammen. En test bekrefter at søkeindeksene faktisk brukes.
- E2E kjører mot produksjonsbygget med falske, lokale versjoner av TMDB og Internet Archive, slik at
  testene ikke avhenger av internett.

**CI** (`.gitlab-ci.yml`) er satt opp til å kjøre lint, typecheck, enhetstester, build og E2E med
PostgreSQL, og en ustabil test gjør jobben rød. Repoet ligger på GitHub fram til innlevering, så
GitLab-jobbene kjøres først når det er flyttet. De samme kommandoene er kjørt lokalt før hver merge.

## Kjøre lokalt

Krever Node.js ≥ 20 og PostgreSQL ≥ 14 med `pg_trgm` og `unaccent` (følger med `postgresql-contrib`).
Med syntetiske data tar oppsettet noen minutter og krever ingen nedlasting:

```bash
npm ci
cp .env.example .env                       # juster DATABASE_URL / TEST_DATABASE_URL ved behov
createdb project2 && createdb project2_test
npm run db:fixture -w backend              # ca. 120 000 syntetiske titler i IMDb-format
npm run db:seed                            # migrerer og importerer
npm run dev                                # http://localhost:5173/project2/
```

- **Ekte IMDb-data, plakater fra TMDB (eller falsk TMDB) og gratisfilmer:** se
  [`docs/oppsett.md`](docs/oppsett.md).
- **Tester:**
  - `npm run lint && npm run typecheck && npm test`
  - `npm run test:e2e`. E2E lager sin egen database og starter selv falske tjenester.

## Deploy på VM

Backend og database kjører direkte på `it2810-17.idi.ntnu.no` uten Docker: PostgreSQL, Node som
systemd-tjeneste på port 3001, og Apache som serverer frontend under `/project2` og videresender
`/project2/graphql`. Oppdatering med én kommando:

```bash
ssh -t <brukernavn>@it2810-17.idi.ntnu.no bash T17-Project2/deploy/oppdater.sh
```

Skriptet henter siste kode, bygger, stopper backend, migrerer, importerer og starter tjenestene igjen.
Det stopper med feilmelding hvis API-et ikke svarer. Alt som trengs for å starte backend, er
beskrevet i [`docs/deploy.md`](docs/deploy.md). Feilsøking: `bash deploy/sjekk.sh`.

## Prosess og bruk av KI

Prosjektet er utviklet med Claude Code som KI-assistent, styrt av rammene i [`CLAUDE.md`](CLAUDE.md)
og planen i [`PLAN.md`](PLAN.md). Hvordan KI er brukt, hva mennesker har bestemt og kontrollert, og
hvilke feil KI-en gjorde, står i [`docs/ki-deklarasjon.md`](docs/ki-deklarasjon.md). Én linje per
oppgave er logget i [`docs/ki-logg.md`](docs/ki-logg.md).

Ferdigstillingen etter medstudentvurderingen er gjort gjennom issues, pull requests og kodegjennomgang:

| Issue | Innhold                                                    | Pull request |
| ----- | ---------------------------------------------------------- | ------------ |
| #13   | Forklarende banner når API-et ikke kan nås, `/health`      | #19          |
| #14   | Presis filteretikett, kategorinavigasjon, ustabil test     | #18          |
| #15   | API-grenser, slett anmeldelse, aksentuavhengig og kort søk | #20          |
| #16   | Feilrettinger, tilgjengelighet, tema-bryter, slett i UI    | #21          |
| #17   | CI (build og E2E), CSP, dokumentasjon                      | #22, PR_DOCS |

Hver PR har review-kommentarer med funn rangert som blokkerende, bør fikses og valgfritt. Funnene er
rettet med nye commits før merge.

**Grenmodell:**

```
feat/… · fix/… · chore/… ──PR + review──▶ integrasjonsgren ──PR──▶ main ──▶ VM (oppdater.sh)
```

1. **Oppgavegrener:** hver oppgave får egen gren. Pre-commit kjører ESLint og Prettier på endrede
   filer (Husky og lint-staged).
2. **Integrasjonsgren:** oppgavegrener merges hit via PR når review og alle tester er grønne. Fra
   oktober er det `claude/adoring-brown-3nct5k`, fordi sky-miljøet KI-agentene kjører i bare kan
   pushe til én forhåndsbestemt gren.
3. **`main`:** integrasjonsgrenen merges til `main` av et gruppemedlem. Det er `main` som deployes.

Historikken skrives aldri om (ingen force-push), og merge-commits viser grenene.

## Kjente begrensninger

- **Ingen innlogging.** Anmeldelser og liste følger nettleseren via en anonym ID. Bytter du
  nettleser eller tømmer lagringen, mister du tilgang til egne anmeldelser.
- **Korte søk (1–2 tegn)** matcher bare starten av ord. Det er et bevisst valg for ytelsen, og fra 3
  tegn søkes det på delstrenger.
- **Søk på vanlige ord** som «the» med relevanssortering tar ca. 140 ms, fordi det treffer en
  stor del av tabellen. Se [`docs/ytelse.md`](docs/ytelse.md).
- **Ytelsestallene er målt på syntetiske data** (120 000 titler) i utviklingsmiljøet. VM-en har det
  ekte datasettet.
- **Rate limiting ligger i minnet** og nullstilles ved omstart. Det holder for én serverprosess.

## Videre dokumentasjon

[Oppsett](docs/oppsett.md) · [Deploy](docs/deploy.md) · [API](docs/api.md) ·
[Beslutninger](docs/beslutninger.md) · [Ytelse](docs/ytelse.md) ·
[KI-deklarasjon](docs/ki-deklarasjon.md) · [KI-logg](docs/ki-logg.md) · [Status](docs/status.md)

_Bilder og beskrivelser fra TMDB. Produktet bruker TMDB-API-et, men er ikke godkjent eller
sertifisert av TMDB. Filmer fra Internet Archive vises med lisens og kilde under spilleren._
