# Beslutninger

Valg agentene har tatt uten å spørre, med begrunnelse. Nyeste nederst.

- **TypeScript 6.0 i stedet for 7.** `typescript-eslint` støtter bare `typescript <6.1`. Vi valgte
  lint-støtte framfor nyeste kompilator.
- **ESLint 9 i stedet for 10.** `eslint-plugin-jsx-a11y` støtter ikke ESLint 10 ennå, og
  tilgjengelighetslinting er et krav.
- **Git-grener.** CLAUDE.md sier at arbeidet skal skje på grener fra `mvp`. Sky-sesjonen kan bare
  pushe til én gren (`claude/webutvikling-projekt-2-k5lq6q`), så den grenen spiller rollen til
  `mvp`. Hver oppgave lages på en lokal `feat/…`-gren og merges inn med `--no-ff`, slik at historikken
  viser grenene. Ingenting pushes til `main`.
- **Ingen GitLab-issues/MR-er.** `glab` er ikke tilgjengelig i miljøet, så issue- og review-flyten
  loggføres i `docs/ki-logg.md` i stedet, slik CLAUDE.md beskriver.
- **Syntetisk testdatasett.** IMDb-nedlasting er blokkert i miljøet (se `BLOCKERS.md`). Et skript
  genererer filer i nøyaktig samme TSV-format, så importkoden er den samme for ekte og syntetiske
  data.
- **Egen migreringsrunner.** `backend/scripts/migrate.ts` (tabell `schema_migrations`, én transaksjon per
  fil, advisory lock mot samtidige kjøringer) i stedet for et bibliotek: vi trenger bare «kjør nye
  SQL-filer i rekkefølge», og testene gjenbruker samme funksjon til å migrere testdatabasen.
- **Denormalisert `titles.genres text[]` (GIN) og lagret `start_decade`.** `title_genres`/`genres` finnes
  som normalisert kilde, men sjangerfilter (`genres @> ARRAY[…]`, «alle valgte») og fasettene blir
  enklere og raskere uten join, og sjangre til en hel resultatside følger med raden (ingen N+1).
  `start_decade` er en generert kolonne slik at tiårfilter er en likhet på en indeksert kolonne.
  Prisen er at importen skriver sjangre to steder (i samme transaksjon).
- **Søk med `lower(col) LIKE lower('%…%')` og trigram-GIN på `lower(...)`-uttrykk,** ikke `ILIKE`.
  Indeksuttrykket må være identisk med spørringen for å bli brukt. Brukerens `%`, `_` og `\` escapes
  slik at de er vanlige tegn. Aksenter foldes ikke (`cafe` finner ikke `Café`); `unaccent`
  er ikke tatt med for å slippe en ekstra utvidelse.
- **Keyset-paginering med radsammenligning.** Alle sorteringsnøkler går i samme retning
  (`(a, b, id) < ($1,$2,$3)`), siste nøkkel er `id` (unik), og nullable kolonner erstattes av
  sentinel via `COALESCE` (rating → -1, år → 0). Det gir stabil paginering uten hull/duplikater og lar
  btree-indekser på samme uttrykk brukes. Konsekvens: titler uten rating/år havner sist ved DESC og
  først ved ASC. Rating og år har `num_votes` som sekundær nøkkel (populære titler først blant like).
  Cursoren inneholder en signatur (sortering/retning/om det finnes søketekst) og avvises
  (`BAD_USER_INPUT`) hvis den brukes med en annen sortering. Tidsstempler i cursorer går som tekst
  (mikrosekund-presisjon; JS `Date` har bare millisekunder).
- **Relevans = `GREATEST(similarity(primær), similarity(original))`,** tiebreak `num_votes`, så `id`.
  Uten søketekst betyr «relevans» flest stemmer først.
- **`totalCount` er lazy** (beregnes bare hvis feltet etterspørres) og kjøres som egen `count(*)`.
  `userRating`/`reviewCount`/`inMyList` hentes med en liten per-request batch-loader (`loaders.ts`),
  så en side med 20 titler koster 1 spørring per felttype i stedet for 20.
- **Fasettene** gir kun verdier med treff > 0, pluss valgte verdier med 0 (så et valgt filter ikke
  forsvinner fra UI-et). Sortering: sjangre etter antall (synkende), tiår kronologisk, typer
  `MOVIE`, `SERIES`. Titler uten startår mangler i tiårsfasetten.
- **Feilkoder og maskering.** Egne feil er `GraphQLError` med `extensions.code`; uventede feil
  (databasen nede, bugs) maskeres til «Intern feil.» med `INTERNAL_SERVER_ERROR`, og detaljene logges
  bare på serveren. `title(id)` for ukjent id gir `null` (typen er nullable); `addReview`/`toggleList`
  på ukjent tittel gir `NOT_FOUND`. `query` som inneholder NUL-tegn avvises som `BAD_USER_INPUT`
  fordi Postgres ikke kan lagre dem. `minRating: 0` betyr «ingen grense».
- **Spørredybde 6 og introspeksjon.** Egen valideringsregel (`depthLimit.ts`, rotfelt = nivå 0, som
  `graphql-depth-limit`), fordi dagens skjema ikke kan nøstes dypere enn 6; regelen er et vern mot
  fremtidige sirkulære relasjoner og testes mot et sirkulært testskjema. Introspeksjon og GraphiQL
  slås av med `NODE_ENV=production` (egen regel, fordi graphqls innebygde regel feiler når `graphql`
  lastes både som ESM og CJS). CORS er kun på utenfor produksjon (Apache gir same-origin i prod).
- **Tester mot ekte Postgres** (`project2_test`), nullstilt og migrert i `globalSetup` – ingen
  databasemocking, slik at SQL, indekser og migrasjoner testes sammen. Testene nekter å kjøre hvis
  `TEST_DATABASE_URL` er lik `DATABASE_URL`.
- **Import: rating-fila leses først** og bare rader over stemmegrensen holdes i et `Map`; `basics`
  strømmes deretter mot dette. Enklere enn staging-tabell/COPY og raskt nok (120 000 titler på ca. 17 s).
  Titler som senere faller under stemmegrensen fjernes ikke ved omkjøring (upsert, ingen sletting).
- **Frontend: URL som eneste kilde til søketilstand.** `q`, `genres`, `decades`, `types` (`film`/`serie`),
  `minRating`, `sort` (`relevans`/`rating`/`ar`/`tittel`), `dir` (`asc`/`desc`) leses og skrives med
  `useSearchParams` (`replace`, så historikken ikke fylles). Søketeksten debounces i `SearchBox` og
  skrives til URL-en først når den (trimmet) avviker fra forrige verdi; requesten følger av URL-en.
- **Frontend: scrollgjenoppretting med `ScrollRestoration`** fra react-router (data router). Apollo-cachen
  (`relayStylePagination` med keyArgs `query/filters/sort`) holder alle innlastede sider, så «tilbake»
  har full listehøyde å scrolle til uten ny request.
- **Frontend: fasetter og sjangerliste er egne queries** (`facets`, `genres`), atskilt fra `search`, slik at
  sortering/sidebytte ikke henter fasetter på nytt. Forrige fasetter vises mens nye lastes.
- **Frontend: ny anmeldelse vises via `refetch` av tittelen** etter `addReview` (serveren er kilden til
  snitt og antall). «Min liste» bruker `cache-and-network` og fjerner rader lokalt i cachen ved «Fjern».
- **Frontend: ingen nye biblioteker.** Bundle ca. 166 kB gzip initielt (React + Apollo + React Router);
  detalj- og listesiden er lazy (ca. 4 kB gzip til sammen).
- **Bruker-ID uten `crypto.randomUUID`.** VM-en serverer appen over http, som ikke er en sikker
  kontekst, og der finnes ikke `crypto.randomUUID`. Alle GraphQL-requests feilet derfor i
  produksjon, selv om alle tester (som kjører på `localhost`, som regnes som sikker) var grønne.
  UUID v4 lages nå med `crypto.getRandomValues`, som finnes overalt. Verifisert i Chromium mot en
  ikke-localhost http-adresse.
