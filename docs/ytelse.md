# Ytelse

## Databasesøk: `EXPLAIN ANALYZE` før og etter indekser

> **Merk:** Tallene er målt på det syntetiske datasettet (`npm run db:fixture -w backend`:
> 120 000 titler, PostgreSQL 16, lokal maskin, `jit = off`, andre kjøring/varm cache). Med de ekte
> IMDb-dataene (flere titler, andre tittelfordelinger) blir absolutt-tidene annerledes, men forholdet
> mellom «uten indeks» og «med indeks» skal være det samme. Målingen kan gjentas med
> et `EXPLAIN (ANALYZE, BUFFERS)` på spørringene under.

«Før» er målt ved å slette alle indekser på `titles` unntatt primærnøkkelen inne i en transaksjon som
rulles tilbake (`BEGIN; DROP INDEX …; ANALYZE titles; EXPLAIN ANALYZE …; ROLLBACK;`), slik at
databasen er uendret etterpå. «Etter» er skjemaet fra `backend/migrations/001_init.sql`.

Spørringene er de samme som API-et bygger (`backend/src/search.ts`), med `LIMIT 21` (= `first: 20` + 1
for å avgjøre `hasNextPage`).

| Scenario                                                       | Uten indekser (ms) | Med indekser (ms) | Plan etter                                                 |
| -------------------------------------------------------------- | -----------------: | ----------------: | ---------------------------------------------------------- |
| Søk «dark» (1 774 treff), sortert på rating, `LIMIT 21`        |               76,7 |               3,1 | Index Scan Backward `titles_rating_idx`                    |
| Søk «dark», sortert på relevans (`similarity`), `LIMIT 21`     |               82,4 |               8,9 | Bitmap OR av begge trigram-indeksene + top-N sort          |
| `count(*)` for «dark» (`totalCount`)                           |               76,3 |               3,0 | Bitmap OR av begge trigram-indeksene                       |
| Ingen søketekst, sortert på rating, `LIMIT 21`                 |               24,2 |              0,03 | Index Scan Backward `titles_rating_idx`                    |
| Filter sjanger Drama+Crime, tiår 1990/2000, sortert på stemmer |               25,6 |               2,5 | Index Scan Backward `titles_votes_idx` (filter i skanning) |

### Tolkning

- **Uten indekser** leser Postgres alle 120 000 rader (`Seq Scan`) og evaluerer `lower(...) LIKE '%dark%'`
  på begge titlene for hver rad. Kostnaden vokser lineært med tabellen, så ~77 ms her blir mange
  hundre ms med flere titler, og den betales for hver tastetrykk-debounce og for hver `totalCount`.
- **Trigram-GIN** (`gin (lower(primary_title) gin_trgm_ops)` og tilsvarende for `original_title`) gjør
  at `LIKE '%…%'` går via indeksen (bitmap-skann) i stedet for å lese hele tabellen. Uttrykket i
  spørringen må være identisk med indeksuttrykket (`lower(t.primary_title)`), ellers brukes ikke indeksen.
  Derfor lager vi `lower()`-indekser i stedet for å bruke `ILIKE` på råkolonnen.
- **Sortering på rating/år/stemmer/tittel** dekkes av btree-indekser på nøyaktig samme uttrykk og
  kolonnerekkefølge som `ORDER BY` og cursor-sammenligningen (`(COALESCE(average_rating,-1), num_votes, id)`).
  Postgres kan da hente de 21 første radene direkte fra indeksen uten å sortere, og keyset-paginering
  (`(a, b, id) < ($1, $2, $3)`) bruker samme indeks for side 2, 3, … uten OFFSET-kostnad.
- **Sjanger- og tiårfilter** bruker GIN på `genres text[]` (`@>`) og `start_decade`. Her velger
  planleggeren likevel å gå baklengs på stemmeindeksen og filtrere underveis, fordi mange rader
  oppfyller filteret og 21 treff finnes raskt. Med et sjeldnere filter tar bitmap-skannet over.
- **Relevanssortering** må beregne `similarity()` for alle treff før den kan sortere, så den er dyrere
  (8,9 ms) enn sortering på lagret kolonne, men trigram-indeksen holder antall rader nede
  (1 774 av 120 000). Ved svært vanlige søkeord («the») er dette den tregeste spørringen.
- **Grenser vi kjenner til:** søketekst på 1–2 tegn har ingen trigrammer for delstrengsøk. De løses
  som prefiksmatch (se «Aksentfolding og korte søk» under). `totalCount` og fasetter regnes ut på hele treffmengden hver gang og er derfor den dyreste delen
  av et bredt søk; `totalCount` beregnes bare når klienten ber om feltet.

### Rådata (utdrag)

Søk «dark», sortert på rating. Uten indekser:

```
Limit (actual time=76.668..76.673 rows=21 loops=1)
  ->  Sort  Sort Key: (COALESCE(average_rating, '-1'::numeric)) DESC, num_votes DESC, id DESC
        Sort Method: top-N heapsort  Memory: 27kB
        ->  Seq Scan on titles t (actual time=0.032..75.964 rows=1774 loops=1)
Execution Time: 76.697 ms
```

Med indekser:

```
Limit (actual time=0.052..3.065 rows=21 loops=1)
  ->  Index Scan Backward using titles_rating_idx on titles t (actual time=0.051..3.060 rows=21 loops=1)
Execution Time: 3.083 ms
```

Søk «dark», relevans, med indekser:

```
Limit (actual time=8.910..8.915 rows=21 loops=1)
  ->  Sort  Sort Key: (GREATEST(similarity(lower(primary_title), 'dark'), similarity(lower(original_title), 'dark'))) DESC, num_votes DESC, id DESC
        ->  Bitmap Heap Scan on titles t (actual time=0.575..8.616 rows=1774 loops=1)
              ->  BitmapOr
                    ->  Bitmap Index Scan on titles_primary_title_trgm_idx (rows=1774)
                    ->  Bitmap Index Scan on titles_original_title_trgm_idx (rows=1600)
Execution Time: 8.949 ms
```

## Aksentfolding og korte søk (issue #15)

Migrering `004_unaccent_search.sql` gjør søket aksentuavhengig og endrer 1–2 tegns søk til
ordprefiks («ma» finner «The Matrix»). Målt på samme syntetiske datasett (120 000 titler,
PostgreSQL 16.15, lokal maskin, `jit = off`, `VACUUM ANALYZE` før måling). Hver tid er median av 7
kjøringer av `EXPLAIN (ANALYZE)` på spørringene `searchTitles` faktisk bygger (`LIMIT 21`), én gang
for siden og én for `totalCount`, og tabellen er gjennomsnittet av to hele måleomganger. «Før» er
koden og indeksene fra før migreringen, «etter» er samme database etter migreringen.

> **Merk:** Maskinen delte CPU med andre prosesser under målingen, så tall under ca. 5 ms og alle
> forskjeller på under ca. 20 % bør leses som «omtrent lik». Størrelsesforholdene er reproduserbare
> på tvers av kjøringer; absolutt-tidene er det ikke. Datasettet er syntetisk, så hvor mange titler
> som har et ord som begynner på «a» eller «th» er ikke det samme som i ekte IMDb-data.

| Søk (sortering)         |  Side før (ms) | Side etter (ms) | `totalCount` før (ms) | `totalCount` etter (ms) |
| ----------------------- | -------------: | --------------: | --------------------: | ----------------------: |
| «a» (relevans), 1 tegn  |          314,0 |            0,18 |                  46,1 |                    11,5 |
| «a» (rating)            |           0,05 |            0,15 |                  43,3 |                    12,2 |
| «ma» (relevans), 2 tegn |           83,7 |            0,31 |                  48,8 |                     8,6 |
| «ma» (rating)           |            0,6 |            0,35 |                  48,0 |                    10,1 |
| «br» (relevans), 2 tegn |           78,7 |            0,24 |                  50,1 |                     7,8 |
| «th» (relevans), 2 tegn |          195,3 |           0,052 |                  44,8 |                    16,8 |
| «the» (relevans)        |          210,1 |           142,1 |                  30,8 |                    22,9 |
| «dark» (relevans)       |           21,7 |            16,9 |                   3,4 |                     2,6 |
| «dark» (rating)         |            3,1 |             1,0 |                   3,3 |                     2,5 |
| «amelie» (relevans)     | 0,05 (0 treff) |            18,5 |        0,05 (0 treff) |                     2,9 |

Rader med «rating» som sortering var allerede raske før, fordi planleggeren kunne gå baklengs på
ratingindeksen og stoppe etter 21 treff; for dem er det bare `totalCount` som forbedres. For «amelie» ga
søket 0 treff før, fordi aksenten ikke ble foldet; tallene er derfor ikke sammenlignbare.

### Hva som ble gjort og hvorfor

- **Aksentfolding:** `unaccent` via en IMMUTABLE innpakning `f_unaccent(text)` (Postgres godtar ikke
  den STABLE `unaccent()` i indekser). Normalisert tittel (`lower(f_unaccent(tittel))`) lagres som
  genererte kolonner `primary_title_norm` og `original_title_norm`, og trigram-GIN-indeksene ligger
  på dem. Søketeksten normaliseres med samme uttrykk i SQL, og FØRST etter det escapes `%`, `_` og
  `\` (unaccent mapper fullbreddetegn som `％` til `%`, så rekkefølgen er sikkerhetsrelevant).
- **Hvorfor kolonner og ikke et indeksuttrykk:** vi prøvde først ren `lower(f_unaccent(col))` som
  indeksuttrykk i spørringen (slik `lower(col)` var før). Indeksene ble brukt, men `unaccent` kjøres
  da på nytt for hver rad som leses i recheck, filter og relevansberegning. Mot 120 000 titler ga det
  en tydelig regresjon på brede søk: «the» (relevans) 237 → ca. 400 ms og «dark» (rating) 1,9 → 6,5 ms.
  Med genererte kolonner er alle tallene på høyde med eller bedre enn før.
- **Korte søk (1–2 tegn):** ordprefiks mot en generert `tsvector` (`title_words`, `'simple'`-konfig
  over normalisert primær- og originaltittel) med GIN-indeks. Søket er
  `title_words @@ to_tsquery('simple', '<søketekst>:*')`, og relevans = popularitet (stemmer, så id) i
  stedet for likhet. Før lå kostnaden i å regne `similarity`/`word_similarity` på nesten alle rader
  (314 ms for «a»). Nå leser planleggeren de 21 første radene baklengs fra stemmeindeksen
  (`Index Scan Backward using titles_votes_idx`, 0,03–0,4 ms), og `search-index.test.ts` verifiserer at
  `titles_title_words_idx` kan brukes. Søketeksten strippes for tegnsetting før den settes inn i
  tsquery-syntaksen, så `& | ! ( ) : * < > '` og `\` ikke kan gi syntaksfeil.
- **Hvorfor ikke prefiks av hele tittelen:** vi prøvde først `LIKE 'a%'` med `text_pattern_ops`-btree.
  Det er raskt, men finner bare titler som BEGYNNER med søketeksten («ma» fant ikke «The Matrix»).
  Ordprefiks med tsvector er like raskt og finner det brukere venter, og gjør de to btree-indeksene
  overflødige, så de ble tatt ut av migreringen.

Kostnad i plass og migreringstid (120 000 titler): heapen vokste fra 19 til 31 MB (tre genererte
kolonner), `titles_title_words_idx` er 1,3 MB, og trigramindeksene er omtrent like store som før
(6,0 og 6,3 MB). Migreringen tok ca. 3,8 s for `ALTER TABLE` (omskriving av tabellen, med
`ACCESS EXCLUSIVE`-lås) og ca. 1,2 s for de tre indeksene, lokalt. Regn med flere ganger så lenge på
VM-en; se «Låsvindu» i `docs/deploy.md`.

Plan etter, «ma» (relevans), siden:

```
Limit (actual time=0.011..0.257 rows=21 loops=1)
  ->  Index Scan Backward using titles_votes_idx on titles t (actual time=0.010..0.255 rows=21 loops=1)
        Filter: (title_words @@ '''ma'':*'::tsquery)
        Rows Removed by Filter: 349
Execution Time: 0.265 ms
```

Plan etter, «amelie» (relevans): `BitmapOr` av `titles_primary_title_trgm_idx` og
`titles_original_title_trgm_idx` med `Index Cond: (primary_title_norm ~~ '%amelie%'::text)`, altså at
søketeksten uten aksent bruker trigramindeksen på de normaliserte kolonnene.

### Ærlige merknader

- **«The» og andre svært vanlige ord er fortsatt tregt (ca. 140 ms for relevanssortering).** Ca.
  35 000 av 120 000 titler inneholder «the», så planleggeren velger `Parallel Seq Scan` og regner
  likhet for alle treff. Dette er uendret fra før og ikke løst av denne migreringen; en mulig
  forbedring er å rangere vanlige ord etter popularitet først.
- **`totalCount` for «a», «th» og «the» koster 10–25 ms** fordi alle treff må telles. Det er bare
  kostnad når klienten ber om feltet.
- **Korte søk er en funksjonell endring:** «ar» finner ikke «Dark» (ordprefiks, ikke delstreng), og
  tegnsetting i søket ignoreres («a:» betyr «a»). Fra 3 tegn er det delstrengsøk som før. Vi valgte
  det fordi delstrengsøk på 1–2 tegn matcher en stor del av tabellen uansett (ca. 82 500 av 120 000
  titler inneholder «a»), så det gir ikke presise treff.
- **`unaccent` foldes også norske tegn:** «ø» blir «o», «å» blir «a» og «æ» blir «ae». Det er bra for
  «Amélie» og «Café», men betyr at «bla» også finner «Blå».
- Absolutt-tidene gjelder datasettet over; ekte IMDb-data har flere titler og andre ordfordelinger.

## Importtid

`npm run db:seed -w backend` importerer 120 000 syntetiske titler (162 000 linjer i `basics`) på ca.
17 s, inkludert oppdatering av alle indekser. Fila strømmes (gunzip + readline) og skrives i
batcher på 2 000 rader; bare rating-rader over stemmegrensen holdes i minnet.

## Lighthouse

### Måling 2026-10-06 (etter ytelsesrunden)

**Oppsett.** Produksjonsbygg (`npm run build -w frontend`) servert av en liten Node-server som etterligner
`deploy/apache-project2.conf`: gzip for samme MIME-typer, samme sikkerhetsheadere og CSP, samme cache-headere,
SPA-fallback, proxy til backend og 404 utenfor `/project2/` (som Apache). Backend i produksjonsmodus med
20 000 syntetiske titler, falsk TMDB (bildene er små SVG-er på localhost) og falsk Archive. Lighthouse 12,
Chromium headless, standard simulert struping (mobil: 4x CPU, simulert 4G; desktop: ingen CPU-struping).
Format: Performance / Accessibility / Best Practices / SEO. Skriptene ligger ikke i repoet; oppsettet er
beskrevet her så det kan gjentas.

| Side                 | Mobil før        | Mobil etter       | Desktop før          | Desktop etter   |
| -------------------- | ---------------- | ----------------- | -------------------- | --------------- |
| Forside              | 76/100/100/91-92 | 93-96/100/100/100 | 99-100/100/100/91-92 | 100/100/100/100 |
| Detalj (`/title/…`)  | 82/100/100/91-92 | 98/100/100/100    | 99-100/100/100/91-92 | 100/100/100/100 |
| Min liste            | 96/100/100/91-92 | 97/100/100/100    | 99-100/100/100/91-92 | 100/100/100/100 |
| Søk (`/?q=dark`)     | 71/100/100/91-92 | 96-97/100/100/100 | 99-100/100/100/91-92 | 100/100/100/100 |
| Spiller (`/watch/…`) | 95/100/100/91-92 | 97/100/100/100    | 99-100/100/100/91-92 | 100/100/100/100 |

«Før» er `main` før denne grenen (første måling i oppsettet). Etter at serveren også gzippet GraphQL-svar
ga `main` selv 89 på forside og søk på mobil (TBT ca. 300 ms), så en del av forskjellen på forsiden/søk skyldes
Apache-konfigen og ikke bare frontenden. Intervallene (f.eks. 93-96) er variasjon mellom gjentatte kjøringer;
mobil TBT svinger fra ca. 40 til 200 ms på samme bygg.

**Tiltak som ga effekt**

- `startTransition` rundt første `root.render` og `useDeferredValue` for radenes titler: React tidsdeler
  rendringen (5 ms per bit) i stedet for én lang oppgave. TBT på forsiden mobil gikk fra ca. 300-500 til 70-200 ms. Dette var
  det tiltaket som flyttet mobilscoren mest.
- Søkevisningen (filtre, sortering, trefflisten) er lazy-lastet, så forsiden slipper den. Plakatene over folden
  på søk er `loading="eager"`, den første med `fetchpriority="high"` (fjernet `lcp-lazy-loaded`).
- Gzip av `application/graphql-response+json` (Apollo 4 ber om den; Yoga svarer med den, og den ble tidligere
  sendt ukomprimert) og `text/javascript` i `deploy/apache-project2.conf`.
- `robots.txt` (SEO 91-92 til 100) og tilgjengelig navn på spol-knappene i spilleren (`label-content-name-mismatch`).
- Heltebanneret har fast høyde på mobil (38 rem) og tittel/sammendrag er avkortet med `line-clamp`, så det ikke
  vokser når dataene kommer. Målt med Chromium: 608 px både med vanlige og ekstremt lange tekster, ved 320-412 px bredde.
- Statisk app-skall i `index.html` (header og heltebanner-plassholder) og `preconnect` til TMDB. Skallet er
  skjult for hjelpemidler, uten lenker, og skiftes ut av `createRoot`. Det gir ekte tidlig maling
  (observert FCP ca. 85 ms), men se merknaden om simulert FCP under.
- Vendor-chunks (react, router, apollo) endrer ikke mengden JS (ca. 170 kB gzip initialt), men de endres sjelden og
  kan derfor ligge i nettleserens cache etter en deploy.
- `theme-init.js` har en dags cache i Apache-konfigen. `Cross-Origin-Opener-Policy` er fjernet fra konfigen
  (ignoreres på http og gir bare konsollmelding).

**Ærlige merknader**

- **Simulert FCP står på ca. 2,0 s på mobil, selv om observert FCP er under 100 ms.** Lighthouse' simulering
  regner JS-bunten som nødvendig for første maling når den har lastet og kjørt før malingen i sporet. På
  localhost skjer alt på noen få millisekunder, så JS rekker det. Et skall som maler før JS er lastet,
  ville gitt lavere FCP på et ekte tregt nett, men det kan ikke måles slik her. Vi har ikke forsøkt å lure
  målingen (f.eks. forsinke JS kunstig).
- **LCP er ca. 2,3 s på mobil** fordi appen er klient-rendret: HTML, JS, GraphQL-kall, så render av heltebanneret
  (`.hero__overview`). Kjeden kan bare kortes ved å forhåndshente spørringen (krever GET-persisted queries) eller
  server-rendre, og begge deler er større endringer enn prosjektet tillater. Dette, sammen med TBT, er grunnen til at mobil
  Performance ligger på 93-98 og ikke 100. Desktop er 100.
- Lighthouse-revisjonene `unused-javascript`, `render-blocking-resources` (CSS og `theme-init.js`) og
  `uses-long-cache-ttl` står igjen som anbefalinger, men telles ikke i scoren. `theme-init.js` må være
  blokkerende for å unngå temablink, og CSS er blokkerende med vilje.
- **Best Practices 100 gjelder lokalt.** På VM-en serveres appen over http, og der får Best Practices trekk for
  `is-on-https` (og eventuelt andre https-avhengige revisjoner). Det kan ikke fikses uten https på VM-en.
- **`robots.txt`:** Lighthouse leser `/robots.txt` på rotadressen, mens appen ligger under `/project2/`. Filen
  (`frontend/public/robots.txt`, `Allow: /`) havner derfor på `/project2/robots.txt`. I målingen svarer serveren 404
  på `/robots.txt`, som Lighthouse behandler som «ingen robots.txt» (OK). På VM-en avhenger resultatet av hva Apache
  svarer på rotadressen; en egen `/robots.txt` på VM-roten ligger utenfor repoet.
- Søk på desktop har CLS 0,02 (nye resultater erstatter skjelettet); under grensen på 0,1.
- Detaljsiden: waterfall chunk til spørring ble ikke endret. Detaljsiden scorer 98 på mobil, så
  forhåndslasting gir for lite til å forsvare mer kode.
- Prøvd og forkastet: `async` på modulskriptet (ingen målbar effekt på FCP, og det kan kjøre før `#root` finnes).

### Måling 2026-09-30 (historisk, før M7)

**Målt 2026-09-30, før M7** (`/watch/:id` ble ikke målt). Lighthouse (Chromium, headless) mot produksjonsbygget servert av `vite preview`
og backend med det syntetiske datasettet (120 000 titler). Format: Performance / Accessibility /
Best Practices / SEO.

| Side                        | Mobil          | Desktop         |
| --------------------------- | -------------- | --------------- |
| `/project2/`                | 94/100/100/100 | 97/100/100/100  |
| `/project2/title/tt0468569` | 96/100/100/100 | 100/100/100/100 |
| `/project2/my-list`         | 96/100/100/100 | 100/100/100/100 |

- `vite preview` komprimerer ikke. Med gzip (som Apache-konfigen i `deploy/` slår på) ble forsiden
  97 på mobil og 99 på desktop.
- Performance varierer 1–3 poeng mellom kjøringer, mest på forsiden på mobil (Total Blocking Time).
- Før fiksen lå Performance på 72–79. Årsaken var layoutskift: footeren startet midt i
  viewporten og ble skjøvet ned når innholdet kom, og rullefeltet flyttet siden sideveis. Løst med
  `#root` som flex-kolonne med `min-height: 100vh` og `scrollbar-gutter: stable`.
- Initial JS var ca. 166 kB gzip (2026-09-30; 2026-10-06 målt til ca. 172 kB, se `docs/beslutninger.md`) (React, Apollo Client med rxjs, React Router). Detaljside og
  «Min liste» lazy-lastes. Videre kutt ville krevd å bytte ut Apollo, som er fastsatt i CLAUDE.md.
