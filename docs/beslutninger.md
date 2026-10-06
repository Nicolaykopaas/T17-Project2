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
- **Søk med `LIKE` mot normaliserte tittelkolonner og trigram-GIN,** ikke `ILIKE`. Kolonnene
  `primary_title_norm`/`original_title_norm` er `lower(f_unaccent(tittel))` (se «Aksentuavhengig søk»
  under), og indeksene ligger på dem. Brukerens `%`, `_` og `\` escapes slik at de er vanlige tegn.
- **Keyset-paginering med radsammenligning.** Alle sorteringsnøkler går i samme retning
  (`(a, b, id) < ($1,$2,$3)`), siste nøkkel er `id` (unik), og nullable kolonner erstattes av
  sentinel via `COALESCE` (rating → -1, år → 0). Det gir stabil paginering uten hull/duplikater og lar
  btree-indekser på samme uttrykk brukes. Konsekvens: titler uten rating/år havner sist ved DESC og
  først ved ASC. Rating og år har `num_votes` som sekundær nøkkel (populære titler først blant like).
  Cursoren inneholder en signatur (sortering/retning/om det finnes søketekst) og avvises
  (`BAD_USER_INPUT`) hvis den brukes med en annen sortering. Tidsstempler i cursorer går som tekst
  (mikrosekund-presisjon; JS `Date` har bare millisekunder).
- **Relevans = `0,6 * word_similarity + 0,2 * similarity + 0,2 * popularitet`,** tiebreak `num_votes`,
  så `id`. Begge likhetsmålene tas som `GREATEST` over primær- og originaltittel. Ren likhet rangerte
  obskure titler med identisk navn («Dark Knight», 1 500 stemmer) over klassikeren brukeren mener
  («The Dark Knight»). `word_similarity` gir full score når søkeordene står i tittelen, `similarity`
  belønner eksakte treff, og popularitet (`log10(stemmer) / 7`, mettet ved 10 mill.) skiller resten.
  Uten søketekst betyr «relevans» flest stemmer først. Formelen står i `sortKeys` i
  `backend/src/search.ts`.
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
- **Bilder fra TMDB, lagret i egen tabell, ikke proxyet.** IMDb-dataene har ingen bilder; TMDB har et
  gratis API med IMDb-id-oppslag (`/find`) og et bilde-CDN. Svaret lagres i `title_artwork` (også
  «finnes ikke»), fordi TMDB har rate-grenser og oppslag ellers ville skje ved hvert søk; egen tabell
  fordi `titles` er en ren, reimporterbar IMDb-kopi. Klienten får CDN-URL-er og laster bildene
  direkte: en proxy ville gitt oss båndbredde, cache og sikkerhetsansvar for ingen gevinst.
  Oppslag skjer per request med samtidighetsgrense og ca. 2,5 s tidsfrist; det som ikke rekker
  det blir `null` nå og lagres i bakgrunnen. Forbigående feil lagres aldri som «finnes ikke»
  (5 min negativ cache i minnet), og 401/403 slår av oppslag i 10 min. Ugyldig `width` (≤ 0) gir
  `BAD_USER_INPUT`; gyldige verdier snappes til nærmeste tillatte størrelse. Stier fra TMDB
  valideres mot et strengt mønster før de brukes i en URL. Testes mot en lokal falsk TMDB
  (`scripts/tmdb-mock.ts`), siden internett ikke er tilgjengelig i CI.
- **Frontend: kinoaktig redesign uten nye biblioteker.** Ren CSS med custom properties i `global.css`.
  Mørkt er standard, lyst følger `prefers-color-scheme: light` med samme layout. Header, heltebilder og
  plakat-overlegg er alltid mørke (egne `--on-media`-tokens), fordi de ligger over bilder; det gjør at
  kontrasten ikke avhenger av bildet og at én stil fungerer i begge temaer. Aksentfargen er gull
  (`#f5c518`, mørk tekst på knapper); i lyst tema brukes en mørkere gull (`#7a5200`) til tekst.
- **Forsiden har to moduser, styrt av URL-en.** Uten `q`, filtre og sortering (`isBrowseState`) vises
  «bla-modus»: hero + horisontale rader (`lib/browseRows.ts`). Ellers vises trefflisten som før, som
  rutenett av plakatkort. Hver rads variabler og «Se alle»-lenke utledes fra samme `SearchState`, så de
  ikke kan bli ulike, og «Se alle» treffer Apollo-cachen. All sortering/filtrering er GraphQL-variabler.
- **Hero og toppraden deler én request.** `Featured`-spørringen er `search` med samme cache-nøkkel som
  raden «Mest populære», bare med `overview` og bakgrunnsbilder på alle 20 titler (ca. 6 kB ekstra).
  Det er billigere enn en egen `first: 1`-request som ville kollidert med radens cache-oppføring.
  Hero = første tittel som har bakgrunnsbilde. Bildet har `fetchpriority="high"`, `srcset` (780/1280) og
  fast størrelse via CSS, så det ikke gir CLS.
- **Rader under folden er lazy.** Bare toppraden hentes ved oppstart; de andre bruker
  `IntersectionObserver` (`useNearViewport`, 400 px margin) og `skip` til de nærmer seg. Uten
  IntersectionObserver hentes alt med en gang. Plakater har `loading="lazy"`, `srcset` 185/342.
- **Søkefeltet flyttet til headeren** (på alle sider). På forsiden endrer det bare `q`; andre steder
  navigerer det til `/?q=…`. Layout flytter ikke fokus etter navigasjon hvis fokus står i søkefeltet.
- **Plakatkort:** tittelen er lenken og strekkes over kortet med `::after`, så lenkenavnet er bare
  tittelen og fokusringen omslutter hele kortet. Plakaten har `alt=""` (tittelen står som tekst under).
  Uten plakat: gradient med tittelen, farge fra `hueFromId`. Kort-ids bruker `useId` (samme tittel kan
  stå i flere rader). `main` har `min-height: 100vh` slik at footeren aldri hopper opp i bildet
  (CLS 0,27 på Min liste mobil før dette).
- **Header:** sticky og gjennomsiktig over heltebilde til man scroller (passiv scroll-lytter, state bare
  ved skifte); sider med heltebilde setter `data-hero` på `<html>` (`useHeaderOverlay`).
- **E2E bruker falsk TMDB.** `playwright.config.ts` starter `tmdb:mock` (port 3999) og gir backend
  `TMDB_API_KEY/URL/IMAGE_URL`. Forsiden har ingen `.count` i bla-modus, så flyttesten søker først.
- **README skrevet av lederen.** CLAUDE.md sier at gruppa skriver README, men Nicolay ba eksplisitt
  om det 2026-09-30. Innholdet bygger på fakta fra `docs/`, og tallene er fra siste testkjøring.
- **Strømming fra Internet Archive (M6): bare pekere, ingen video.** `title_streams` (migrering 003)
  har én rad per tittel (PK `title_id`, `ON DELETE CASCADE`) med element-id, filnavn, lisens,
  varighet og valgfri `.vtt`. Egen tabell av samme grunn som `title_artwork`: `titles` er en
  reimporterbar IMDb-kopi. `availableOnly` er `EXISTS (SELECT 1 FROM title_streams s WHERE s.title_id = t.id)`,
  som planleggeren kjører som PK-oppslag per kandidatrad; `Facets.available` teller med alle andre
  filtre (og søketeksten) men uten `availableOnly`. `Title.stream` slås opp med én spørring per side
  (samme loader-mønster som anmeldelser). URL-ene bygges ved lesing fra `ARCHIVE_URL`, ikke lagret, så
  serveren kan byttes (mock/ekte) uten ny import. Element-id må matche `^[A-Za-z0-9._-]+$` (og ikke
  `..`), filnavn kan ikke ha `/`, `\`, `..` eller kontrolltegn; ellers blir `stream` `null`, og
  filnavnet URL-enkodes.
- **Lisensregel for importen (`isLawful` i `scripts/import-archive.ts`).** Et Archive-element er
  lovlig hvis (a) `licenseurl` har verten `creativecommons.org` (eller subdomene), eller URL-en
  inneholder `publicdomain` (CC0, Public Domain Mark, usa.gov-erklæringen), eller (b) elementet ligger
  i en kuratert public domain-samling: `feature_films`, `film_noir` eller `silent_films`. Alt annet
  hoppes over, også elementer i `classic_tv` uten lisens-URL, siden den samlingen blander opphavsrett
  og public domain. Vi sjekker verten i stedet for å teste om URL-en «inneholder» creativecommons.org,
  slik at `http://evil.example/creativecommons.org/…` ikke slipper gjennom. CC-varianter med NC/ND
  godtas fordi vi bare lenker til og viser videoen på archive.org, uten å kopiere eller endre den.
  Lisensteksten utledes fra URL-en (`CC BY 4.0`, `CC BY-NC-ND 3.0`, `CC0`, `Public Domain`); kuratert
  samling uten URL gir `Public Domain`. Søket mot Scrape API er bredere enn regelen (det tar også med
  `classic_tv`) og regelen brukes på hvert treff, så feil i søkespørringen aldri gir ulovlige titler.
- **Kobling Archive -> IMDb.** 1) `urn:imdb:ttNNNNNNN` i `external-identifier`, hvis id-en finnes i
  `titles`. 2) Ellers normalisert tittel (Unicode NFKD uten aksenter, små bokstaver, tegnsetting til
  mellomrom, ledende «the»/«a» fjernet) mot primær- og originaltittel for `movie`-titler, med år ±1
  (Archive og IMDb er sjelden enige), og bare ved nøyaktig ett treff. Tvetydige treff hoppes over: feil
  film på feil side er verre enn ingen film. Flere Archive-elementer for samme tittel: IMDb-ID-koblingen
  vinner, ellers det første (deterministisk). Filmer indekseres i minnet ved importstart (normaliseringen
  skjer i JS), IMDb-id-er slås opp i én spørring per Scrape-side.
- **Filvalg.** Nettleserne spiller MP4 (H.264) overalt, så rekkefølgen er `.mp4` (formatene h.264 /
  h.264 IA først, så 512Kb MPEG4, så MPEG4-originaler, så andre), deretter `.webm`, deretter `.ogv`.
  Innen samme klasse velges den minste filen (bærekraft: ikke send en 4 GB-original til en
  strømmer). Filer i undermapper hoppes over. Varighet leses fra `length` (sekunder eller tt:mm:ss) på
  valgt fil, ellers fra en annen fil i elementet. `.vtt` med samme grunnnavn som videoen foretrekkes.
- **Importens oppførsel mot Archive.** Fire samtidige arbeidere, men felles taktgiver (150 ms mellom
  kallstart), 20 s tidsgrense per kall, ett nytt forsøk ved 5xx/429/timeout/nettverksfeil (ikke ved 404),
  upsert per tittel, og `--limit`/`ARCHIVE_LIMIT` som stopper innsamlingen etter N koblede titler. Et
  element som feiler teller som `feilet` uten å stoppe resten; skriptet avslutter da med kode 1.
- **Falsk Archive (`scripts/archive-mock.ts`) serverer WebM.** Testvideoen er `.webm`, så de spillbare
  filene i mocken heter `.webm` (ellers ville `Content-Type: video/mp4` løyet om bytene). Filvalg
  mellom mp4/webm/ogv dekkes av enhetstester på `chooseFiles`.

## M6 – Spiller og «Se gratis nå» (frontend)

- **Egen spiller på native `<video>`, ingen bibliotek.** Innebygde kontroller varierer i tastaturstøtte og kan ikke få norske navn. Spilleren (`VideoPlayer.tsx`, ca. 4 kB gzip inkl. side) er lazy-lastet sammen med `/watch/:id`.
- **Kontroller over bildet på bred skjerm, under bildet under 40 rem.** Overlegg ville dekket det meste av en 320 px bred video. Kontrollene skjules etter 3 s uten bevegelse bare mens den spiller og aldri ved tastaturfokus (`:has(:focus-visible)`).
- **Snarveier gjelder når fokus er inne i spilleren** (wrapper med `tabIndex=-1`, ikke globale). Knapper eier mellomrom, sliders eier piltastene, så ingenting utløses to ganger.
- **CORS-fallback for undertekster.** `<track>` krever `crossorigin` på videoen. Feiler videoen med det, prøver vi én gang uten undertekster i stedet for å miste filmen.
- **`stream { url }` i lister, full `stream` bare på detalj/spiller.** Nok til «Se nå»-merket uten ekstra bytes. `Title.stream` har `merge: true` i Apollo-cachen så de to feltmengdene flettes.
- **Volum og demping huskes i `localStorage`** (`filmsok:player`); ødelagt verdi gir standard.
- **Tilbake-lenken på spillersiden går alltid til `/title/:id`** (deterministisk, også ved direkte åpning).
- **Mobil skjuler volumslideren** (maskinvareknapper); demp-knappen finnes.

## Herding av backend (issue #15)

- **Feltgrense i tillegg til dybdegrensen.** `complexityLimit` (`backend/src/complexityLimit.ts`) avviser
  operasjoner med mer enn 8 rotfelt eller 150 felt totalt (aliaser og ekspanderte fragmenter telt
  hver for seg). Dybdegrensen stoppet bare nøsting, så ett flatt dokument med hundrevis av aliasede
  `search` (én SQL-spørring hver) eller `posterUrl` (TMDB) slapp gjennom. Frontendens største spørring
  (Title-detaljer) har ca. 45 felt og ett rotfelt, så grensene har rundt tre ganger slingringsmonn;
  `server.test.ts` har kopier av de to største spørringene som vaktbikkje. Fragmenttellingen er
  memoisert, slik at en fragmentkjede med eksponentiell utvidelse ikke kan brukes til å låse CPU-en
  under selve valideringen.
- **Begrensning av mutations: token bucket i prosessminnet** (`backend/src/rateLimit.ts`), per
  `x-user-id` og i tillegg per IP (siste ledd i `X-Forwarded-For`, som Apache legger til; uten
  proxy hoppes IP-grensen over). Én bøtte for `addReview` (10/min) og én for `toggleList` og
  `deleteReview` (60/min); IP-grensen er 3 ganger brukergrensen. Per-IP trengs fordi `x-user-id` er
  anonym og trivielt å rotere. Overskridelse gir `RATE_LIMITED` med `retryAfterSeconds`.
  Begrensning: tilstanden er per prosess og nullstilles ved restart. Det er greit for én
  systemd-tjeneste på VM-en; flere instanser ville krevd delt lager (Redis/tabell), som er overkill her.
  Grensene er romslige nok for E2E-testene og vanlig bruk. Minnet er avgrenset (50 000 nøkler per bøtte).
- **`deleteReview(id)` returnerer `{ deletedId, title }`.** Eierskapet sjekkes i selve
  `DELETE ... WHERE id AND user_id`, og både «andres» og «finnes ikke» gir `NOT_FOUND` med lik melding
  slik at mutationen ikke kan brukes til å lete etter anmeldelser. `title` gir ferdig oppdaterte
  `userRating`/`reviewCount` som Apollo skriver inn i `Title:<id>` uten refetch; `deletedId` brukes til
  å evicte `Review:<id>`. Ugyldig id (ikke 1–18 siffer) gir `BAD_USER_INPUT`.
- **Tittel-id valideres som `^tt\d{7,10}$`** (`isPlausibleTitleId`). Fixture, testdata og
  Archive-mock bruker bare 7 siffer; IMDb har 7–8 i dag, 10 gir slingringsmonn.
- **Aksentuavhengig søk («Aksentuavhengig søk»).** `unaccent` via en IMMUTABLE innpakning
  `f_unaccent(text)` (migrering 004). Normalisert tittel lagres som genererte kolonner
  `primary_title_norm`/`original_title_norm` (`lower(f_unaccent(tittel))`) med trigram-GIN på dem, i
  stedet for å legge uttrykket i indeksen og i hver spørring. Grunnen er målt: uttrykket kjører
  `unaccent` på nytt for hver rad i recheck, filter og relevans og ga opptil 2x tregere brede søk
  (tall i `docs/ytelse.md`). Kolonnene koster ca. 5 MB ekstra på 120 000 titler. Innpakningen peker på
  ordlisten med fullt kvalifisert navn; endres ordlisten må kolonner og indekser bygges på nytt.
  `unaccent` følger med `postgresql-contrib` sammen med `pg_trgm` og er «trusted» fra PostgreSQL 13, så
  `deploy/setup-vm.sh` og `docs/oppsett.md` trenger bare å nevne den ved siden av `pg_trgm`.
  Konsekvens: «ø», «å» og «æ» foldes til «o», «a» og «ae».
- **Korte søk (1–2 tegn) er prefiksmatch og rangeres etter popularitet.** Delstrengsøk på 1–2 tegn
  har ingen trigrammer og traff opptil 70 % av tabellen, og relevansberegningen (`similarity`) på
  alle treff tok ca. 0,5 s for «a». Prefiksmatch mot de normaliserte kolonnene bruker
  `text_pattern_ops`-btree (eller stemmeindeksen baklengs), og relevans er stemmer, så id. Det
  endrer funksjonen: «ar» finner ikke lenger «Dark». Alternativene vi vurderte: (1) beholde delstreng
  og bare droppe likhetsberegningen (hindrer ikke full skanning), (2) ordprefiks («ar» finner
  «The Arrival»), som krever tokenisering eller regex uten indeks. Valgte enkel prefiksmatch fordi
  den er rask, forutsigbar og dekker det brukere gjør når de skriver de første bokstavene av en
  tittel. Cursoren har en egen signatur for korte søk, siden sorteringsnøklene er annerledes.
