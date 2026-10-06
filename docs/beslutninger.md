# Beslutninger

Valg agentene har tatt uten å spørre, med begrunnelse. Nyeste nederst.

- **TypeScript 6.0 i stedet for 7.** `typescript-eslint` støtter bare `typescript <6.1`. Vi valgte
  lint-støtte framfor nyeste kompilator.
- **ESLint 9 i stedet for 10.** `eslint-plugin-jsx-a11y` støtter ikke ESLint 10 ennå, og
  tilgjengelighetslinting er et krav.
- **Git-grener.** CLAUDE.md sier at arbeidet skal skje på grener fra `mvp`. Sky-miljøet kan bare
  pushe til én gren om gangen, så en integrasjonsgren spiller rollen til `mvp`. I september var
  den `claude/webutvikling-projekt-2-k5lq6q`, og arbeidet gikk inn i `main` via PR-er. I oktober
  er den `claude/adoring-brown-3nct5k`, som et gruppemedlem merger til `main`; `main` deployes.
  Hver oppgave lages på en egen gren (`feat/…`, `fix/…`, `docs/…`) og merges inn med PR eller
  `--no-ff`, slik at historikken viser grenene. Agentene pusher aldri til `main` og aldri med force.
- **Issues og PR-er på GitHub, ikke GitLab.** I september var `glab` ikke tilgjengelig, så
  issue- og review-flyten ble loggført i `docs/ki-logg.md`. Fra oktober ligger issues (#13–#17, #23)
  og PR-er (#18–#24) på GitHub (`Nicolaykopaas/T17-Project2`), og hver PR har review fra en
  kritiker-agent. Repoet flyttes til NTNU GitLab ved innlevering.
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
- **Frontend: ingen nye biblioteker.** Målt 2026-10-06 (`npm run build -w frontend`): initial JS ca. 172 kB gzip
  (118,3 + 52,5 + 1,2 + 0,4 kB; React, Apollo og React Router) pluss 5,5 kB CSS. Detalj-, spiller- og
  listesiden er lazy (4,0 + 3,9 + 1,3 + 0,3 kB, ca. 9,5 kB gzip til sammen). Tidligere tall var ca. 166 kB (2026-09-30).
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
  ikke kan bli ulike, og «Se alle» henter første side på nytt, med antall (radenes `ROW_QUERY` har ikke `totalCount`). All sortering/filtrering er GraphQL-variabler.
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

## Backend-herding: kostnadsgrenser, rate limit og søk (#15)

- **Feltgrense i tillegg til dybdegrensen.** `complexityLimit` (`backend/src/complexityLimit.ts`) avviser
  operasjoner med mer enn 8 rotfelt eller 150 felt totalt (aliaser og ekspanderte fragmenter telt
  hver for seg). Dybdegrensen stoppet bare nøsting, så ett flatt dokument med hundrevis av aliasede
  `search` (én SQL-spørring hver) eller `posterUrl` (TMDB) slapp gjennom. Frontendens største spørring
  (Title-detaljer) har ca. 45 felt og ett rotfelt, så grensene har rundt tre ganger slingringsmonn;
  `server.test.ts` har kopier av de to største spørringene som vaktbikkje. Fragmenttellingen er
  memoisert, slik at en fragmentkjede med eksponentiell utvidelse ikke kan brukes til å låse CPU-en
  under selve valideringen.
- **Begrensning av mutations: token bucket i prosessminnet** (`backend/src/rateLimit.ts`), per
  `x-user-id` og i tillegg per IP (siste ledd i `X-Forwarded-For`, som Apache legger til; for
  tilkoblinger som ikke kommer fra loopback brukes i stedet `remoteAddress`, og IP-grensen hoppes bare
  over for loopback uten header). Én bøtte for `addReview` (10/min) og én for `toggleList` og
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
- **Korte søk (1–2 tegn) er ordprefiks og rangeres etter popularitet.** Delstrengsøk på 1–2 tegn
  har ingen trigrammer og traff opptil 70 % av tabellen, og relevansberegningen (`similarity`) på
  alle treff tok ca. 0,3 s for «a». Nå brukes en generert `tsvector` (`title_words`, `'simple'`) med
  GIN og `to_tsquery('simple', '<tekst>:*')`; relevans er stemmer, så id. «ma» finner «The Matrix»,
  men «ar» finner ikke «Dark». Søketeksten strippes for tegnsetting før den settes inn i
  tsquery-syntaksen, så operatortegn ikke kan gi syntaksfeil, og blir ingenting igjen gir det null
  treff. Alternativene vi vurderte: (1) beholde delstreng og bare droppe likhetsberegningen (hindrer
  ikke full skanning), (2) prefiks av hele tittelen med `text_pattern_ops`-btree, som vi først
  implementerte og målte (like rask) men som ikke fant «The Matrix» på «ma». Den tidligere påstanden
  om at ordprefiks krever regex uten indeks var feil: tsvector med GIN gir ordprefiks med indeks.
  Cursoren har en egen signatur for korte søk, siden sorteringsnøklene er annerledes.
- **Søketeksten normaliseres før den escapes, begge deler i SQL.** `unaccent` mapper fullbreddetegn
  (`％`, `＿`, `＼`) til `%`, `_` og `\`; escapet vi i JavaScript først, ble de jokertegn i LIKE og
  traff hele tabellen. Mønsteret bygges derfor som `'%' || regexp_replace(lower(f_unaccent($1)),
'([\\%_])', '\\\1', 'g') || '%'`.
- **Kompleksitetsgrensen veier lister med `first`.** I tillegg til rotfelt og totalt antall felt har
  `complexityLimit` en vektet kostnad: feltene under `search`, `myList` og `reviews` teller `first`
  ganger (standard 20/20/10 når `first` utelates, 50 når `first` er en variabel, også når den
  har en lavere standardverdi, siden klienten kan overstyre den i `variables`). 8 x `search(first: 50) { reviews(first: 50) }` er under feltgrensene, men koster
  millioner og avvises. Grensen er 2 500; frontendens største spørring koster ca. 1 100.
  Regelen er memoisert per fragment (også `depthLimit`), siden en kjede av fragmenter som hver
  spres ti ganger i det neste ellers tok minutter CPU under validering.
- **Backend lytter på `127.0.0.1` i produksjon, og `X-Forwarded-For` stoles bare på fra loopback.**
  Uten det kunne noen nå port 3001 direkte og sette en ny falsk IP per forespørsel og dermed omgå
  IP-grensen. `HOST` kan overstyre. Apache og `deploy/` bruker allerede `127.0.0.1`.

## Feiltilstand når API-et ikke nås (#13)

- **Ingen mock-data i produksjon; forklarende banner i stedet.** Sensor og brukere skal se ekte data fra databasen eller en ærlig feil. Mock-data ville skjult at serveren er utilgjengelig (backend/DB nede, appen kjørt uten backend, eller utenfor NTNU-nettet uten VPN) og at appen ikke viser det den utgir seg for. Mock-servere finnes allerede for utvikling og E2E (`tmdb:mock`, `archive:mock`).
- **Én global tilstand, ikke én feil per rad.** Error-linken i `apollo/client.ts` setter reactive var `apiUnavailable` (og årsaken i `apiFailureKind`: `network` eller `service`) ved nettverksfeil (fetch feilet, HTTP 502/503/504, ikke-JSON-svar) og nullstiller den ved første svar fra serveren. GraphQL-feil teller ikke: da svarte serveren, og feilen er vår bug eller brukerinput. `ApiUnavailableBanner` i `Layout` kunngjør nedetiden én gang (`role="alert"`, knappen ligger utenfor alert-regionen) og gir kort hjelp: prøv igjen, start backend hvis du kjører appen selv, og VPN utenfor NTNU-nett. VPN-hintet utelates ved `SERVICE_UNAVAILABLE` (backend svarer, databasen er nede). Radene viser stille skjelett mens banneret står; andre feil viser fortsatt per-rad-feil.
- **`rxjs` er lagt til som direkte avhengighet i `frontend`.** Apollo 4 har den som obligatorisk peer-avhengighet (allerede i bundlen); vi bruker bare `tap` i linkkjeden.
- **`GET /health` gjør `SELECT 1` med 2 s tidsgrense** (200 `ok`, 503 `db-unavailable`). Yogas egen `/health` (alltid «alive») er flyttet, fordi den ikke sier noe om databasen. Systemd-enheten har `Restart=always` og `Wants=postgresql.service` (+ `After`).

## Frontend-gjennomgang: tilgjengelighet, tema og sletting (#16)

- **«Legg i min liste»-knappen har dynamisk etikett og ingen `aria-pressed`.** Kombinasjonen ga motstridende opplesning («Fjern fra min liste, trykket»). Et fast navn («Min liste» + `aria-pressed`) ville latt brukeren tolke en tilstand («trykket») i stedet for å få vite hva et trykk gjør. En handlingsetikett er tydeligere for både seende og skjermleser, og utfallet kunngjøres i `role="status"`.
- **Rutebytte flytter fokus til sidens første `h1`, ellers `<main>`.** Skjermleseren leser da opp hvor man er. Siden h1 ofte kommer først etter lazy-lasting eller datahenting, følger `Layout` med på innholdet i 3 s og flytter fokus til gjeldende h1 så lenge brukeren ikke har flyttet det selv. Skip-linken fokuserer fortsatt `<main>`.
- **Forsideradene bruker `ROW_QUERY` uten `totalCount`.** Antallet vises aldri der, og hver `totalCount` er en `count(*)`; forsiden sparer åtte slike. Samme `search`-felt og cache-nøkkel, men siden raden mangler `totalCount` gir «Se alle» cache-miss, og søkespørringen henter første side på nytt, nå med antallet.
- **Brukervalgt tema: bryter med fast navn «Mørkt tema» og `aria-pressed`.** Ikonet er eneste synlige innhold, så navnet («Mørkt tema») er fast og tilstanden bæres av `aria-pressed`; valget synkroniseres mellom faner via `storage`-eventet. Uten valg følger siden systemet (`prefers-color-scheme`); første klikk setter `data-theme` på `<html>` og lagrer i `localStorage` (`filmsok:theme`, try/catch). Det er ingen «tilbake til system»-tilstand, for å holde knappen enkel. `public/theme-init.js` lastes synkront i `<head>` (uten `defer`/`module`) og setter `data-theme` før første maling (ingen blink). De lyse fargene står to ganger i `global.css` (systemvalg og eksplisitt valg); `theme.test.ts` feiler hvis blokkene blir ulike.
- **CSP:** temaskriptet ligger i en egen fil og ingen inline-skript trengs, så `script-src 'self'` holder (ingen hash å vedlikeholde). En test sjekker at skriptet bruker samme `localStorage`-nøkkel som `THEME_KEY`.

## Sluttgjennomgang av backend

- **Tokengrense (1 000) og kroppsgrense (64 kB) mot CPU-DoS i validering.** graphql-js sin regel
  `OverlappingFieldsCanBeMerged` er kvadratisk i antall felt, og `complexityLimit` stopper ikke de
  andre reglene: `{ genres genres … }` med 8 000 felt (55 kB) blokkerte event-loopen i ca. 5 s. En
  `onParse`-plugin parser derfor med `maxTokens`, så dokumentet avvises før validering. Frontendens
  største operasjon har 128 tokens (GraphiQLs introspeksjonsspørring ca. 180), så grensen har åtte
  ganger slingringsmonn; en test krever minst fire ganger. Yogas `maxRequestBodySize` er satt til
  64 kB (standard er 25 MB).
- **Variabel `first` regnes alltid som 50 i kostnadsgrensen.** Standardverdien (`$n: Int = 1`) kan
  overstyres i `variables`, så å bruke den lot en angriper be om 50 per side og betale for 1.
- **`facets` har en fast tilleggskostnad på 500.** Hver `facets` kjører fire aggregeringer over
  hele tabellen; åtte aliasede ga 32 parallelle helskanninger mot en pool på 10. Med grensen 2 500
  rommer en operasjon fire, og frontend sender én. Vi la ikke til en minnecache for fasetter uten
  søk (60 s TTL): kostnadsgrensen fjerner angrepsflaten, og en cache ville gitt gammel telling rett
  etter import uten at noen målt gevinst krever det.
- **Migreringer og importer kjører uten API-ets `statement_timeout`.** Poolens 15 s-grense er et
  vern mot løpske spørringer fra API-et. `ALTER TABLE … ADD COLUMN … STORED` (migrering 004) tar
  10–20 s eller mer på VM-en med ca. 190 000 titler, og en avbrutt migrering ruller tilbake og kan
  aldri bli ferdig. `migrate()` setter `statement_timeout = 0` og `lock_timeout = '30s'` på sin
  klient og nullstiller begge etterpå (tilkoblingen går tilbake til poolen). `import-imdb` bruker en
  pool med 10 minutters grense, siden en batch på 2 000 rader oppdaterer tre GIN-indekser.
  `import-archive` og `db:artwork` gjør bare små upserts og ett enkelt utvalg, og beholder
  standardgrensen.
- **TMDB-oppslagskøen er begrenset til 200 ventende.** Scraping av søk og detaljsider kunne fylle
  den delte, FIFO-baserte køen med titusenvis av ventende oppslag og sulte vanlige brukere.
  Oppslag utover grensen avvises (`busy`) uten TMDB-kall, uten lagring og uten negativ cache, så
  bildet hentes som vanlig neste gang det er plass. Plakater er valgfrie, så avvisning gir `null`.
- **Cursor med umulig dato gir `BAD_USER_INPUT`.** Mønsteret slapp gjennom `2026-13-45 00:00:00`,
  som Postgres avviser (22008) og dermed ga maskert 500. Komponentene valideres mot kalender i JS.
  Vi bruker ikke `Date.parse` på strengen, siden Postgres' tidsstempelformat (`+00`, mikrosekunder)
  ikke er ISO 8601 og ikke-ISO-parsing varierer mellom JS-motorer.
- **IMDb-importen skriver bare endrede rader.** `ON CONFLICT DO UPDATE … WHERE (kolonner) IS DISTINCT
FROM (EXCLUDED.kolonner)` hindrer at hver omkjøring lager en ny radversjon per tittel (bloat), regner
  ut de genererte kolonnene på nytt og oppdaterer GIN-indeksene. `title_genres` bygges bare på nytt
  for rader som ble satt inn eller endret (`RETURNING id`). **Titler som faller under `minVotes` ved en
  senere import slettes ikke**: importen er bare upsert, og sletting ville også fjernet brukernes
  anmeldelser og lister (fremmednøkler med `ON DELETE CASCADE`). Vil man rydde, må det gjøres bevisst.
- **Keep-alive 65 s på Node-serveren.** Node lukker ledige forbindelser etter 5 s, mens Apache
  gjenbruker dem lenger, noe som ga sporadiske 502. `headersTimeout` er satt litt høyere (66 s).
- **`setup-vm.sh` starter backend rett etter migreringen.** Tidligere var siden nede under hele
  importen, plakathentingen og Archive-skanningen (minutter). Importene er upsert-trygge og kan
  kjøre mens backend svarer. Tjenesten kjører som `project2`, så `.env` får gruppen `project2` og
  modus 640 i stedet for at hele katalogen skifter eier (importene kjører som deploy-brukeren og
  skriver til `data/`). Apache lastes på nytt til slutt.
