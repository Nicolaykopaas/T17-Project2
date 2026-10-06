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

Migrering `004_unaccent_search.sql` gjør søket aksentuavhengig og endrer 1–2 tegns søk til prefiksmatch.
Målt på samme syntetiske datasett (120 000 titler, PostgreSQL 16.15, lokal maskin, `jit = off`,
`VACUUM ANALYZE` før måling). Hver tid er median av 7 kjøringer av `EXPLAIN (ANALYZE)` på spørringene
`searchTitles` faktisk bygger (`LIMIT 21`), én gang for siden og én gang for `totalCount`.
«Før» er koden og indeksene fra før migreringen, kopiert til en egen database.

> **Merk:** Maskinen delte CPU med andre prosesser under målingen, så tall under ca. 5 ms og alle
> forskjeller på under ca. 20 % bør leses som «omtrent lik». Ordenene (størrelsesforholdene) er
> reproduserbare på tvers av kjøringer; absolutt-tidene er det ikke. Datasettet er syntetisk, så
> hvor mange titler som begynner på «a» eller «th» er ikke det samme som i ekte IMDb-data.

| Søk (sortering)         |  Side før (ms) | Side etter (ms) | `totalCount` før (ms) | `totalCount` etter (ms) |
| ----------------------- | -------------: | --------------: | --------------------: | ----------------------: |
| «a» (relevans), 1 tegn  |          462,6 |            0,19 |                  41,4 |                    12,3 |
| «a» (rating)            |           0,07 |            0,28 |                  46,3 |                    19,3 |
| «ma» (relevans), 2 tegn |           81,9 |            0,64 |                  81,8 |                     8,9 |
| «ma» (rating)           |            0,4 |            0,66 |                  83,4 |                     7,9 |
| «br» (relevans), 2 tegn |           82,4 |            0,75 |                  88,0 |                     7,2 |
| «th» (relevans), 2 tegn |          351,0 |           0,034 |                  77,8 |                    24,6 |
| «the» (relevans)        |          237,1 |           201,8 |                  45,5 |                    20,8 |
| «dark» (relevans)       |           20,7 |            17,2 |                   2,9 |                     2,8 |
| «dark» (rating)         |            1,9 |             1,1 |                   2,9 |                     2,1 |
| «amelie» (relevans)     | 0,06 (0 treff) |            17,6 |        0,05 (0 treff) |                     3,1 |

Rader med «rating» som sortering var allerede raske før, fordi planleggeren kunne gå baklengs på
ratingindeksen og stoppe etter 21 treff; for dem er det bare `totalCount` som forbedres. For «amelie» ga
søket 0 treff før, fordi aksenten ikke ble foldet; tallene er derfor ikke sammenlignbare.

### Hva som ble gjort og hvorfor

- **Aksentfolding:** `unaccent` via en IMMUTABLE innpakning `f_unaccent(text)` (Postgres godtar ikke
  den STABLE `unaccent()` i indekser). Normalisert tittel (`lower(f_unaccent(tittel))`) lagres som
  genererte kolonner `primary_title_norm` og `original_title_norm`, og trigram-GIN-indeksene ligger
  på dem. Søketeksten normaliseres med samme uttrykk i SQL.
- **Hvorfor kolonner og ikke et indeksuttrykk:** vi prøvde først ren `lower(f_unaccent(col))` som
  indeksuttrykk i spørringen (slik `lower(col)` var før). Indeksene ble brukt, men `unaccent` kjøres
  da på nytt for hver rad som leses i recheck, filter og relevansberegning. Mot 120 000 titler ga det
  en tydelig regresjon på brede søk: «the» (relevans) 237 → ca. 400 ms og «dark» (rating) 1,9 → 6,5 ms.
  Med genererte kolonner er alle tallene på høyde med eller bedre enn før. Prisen er plass: heapen
  vokste fra 19 til 24 MB, og de to nye prefiksindeksene tar 3,2 MB. Migreringen tok ca. 5 s.
- **Korte søk (1–2 tegn):** prefiksmatch (`LIKE 'a%'`) mot de normaliserte kolonnene, med btree
  `text_pattern_ops`-indekser, og relevans = popularitet (stemmer, så id) i stedet for likhet.
  Før lå kostnaden i å regne `similarity`/`word_similarity` på nesten alle rader (462 ms for «a»);
  nå leser planleggeren de 21 første radene baklengs fra stemmeindeksen (`Index Scan Backward using
titles_votes_idx`, 0,2–0,8 ms) eller bruker prefiksindeksene når treffene er få (søk som ikke treffer
  noe: `BitmapOr` av `titles_primary_title_prefix_idx` og `titles_original_title_prefix_idx`).

Plan etter, «a» (relevans), siden:

```
Limit (actual time=0.012..0.126 rows=21 loops=1)
  ->  Index Scan Backward using titles_votes_idx on titles t (actual time=0.011..0.124 rows=21 loops=1)
        Filter: ((primary_title_norm ~~ 'a%'::text) OR (original_title_norm ~~ 'a%'::text))
        Rows Removed by Filter: 166
```

Plan etter, et 2-tegns søk med få treff, f.eks. «mo» (relevans):

```
Sort Key: num_votes DESC, id DESC
->  Bitmap Heap Scan on titles t
      Recheck Cond: ((primary_title_norm ~~ 'mo%'::text) OR (original_title_norm ~~ 'mo%'::text))
      ->  BitmapOr
            ->  Bitmap Index Scan on titles_primary_title_prefix_idx
            ->  Bitmap Index Scan on titles_original_title_prefix_idx
```

Plan etter, «amelie» (relevans): `BitmapOr` av `titles_primary_title_trgm_idx` og
`titles_original_title_trgm_idx` med `Index Cond: (primary_title_norm ~~ '%amelie%'::text)`, altså at
søketeksten uten aksent bruker trigramindeksen på de normaliserte kolonnene.

### Ærlige merknader

- **«The» og andre svært vanlige ord er fortsatt tregt (ca. 200 ms for relevanssortering).** Ca.
  35 000 av 120 000 titler inneholder «the», så planleggeren velger
  `Parallel Seq Scan` og regner likhet for alle treff. Dette er uendret fra før og ikke løst av
  denne migreringen; en mulig forbedring er å rangere vanlige ord etter popularitet først.
- **`totalCount` for «a», «th» og «the» koster 20–50 ms** fordi alle treff må telles. Det er bare
  kostnad når klienten ber om feltet.
- **Prefiksmatch er en funksjonell endring:** «th» finner «The Matrix» men ikke «Death», og «ar» finner
  ikke «Dark». Fra 3 tegn er det delstrengsøk som før. Vi valgte det fordi delstrengsøk på 1–2 tegn
  matcher en stor del av tabellen uansett (ca. 82 500 av 120 000 titler inneholder «a», mot 11 200 som
  begynner på «a»), så det gir ikke presise treff.
- **`unaccent` foldes også norske tegn:** «ø» blir «o», «å» blir «a» og «æ» blir «ae». Det er bra for
  «Amélie» og «Café», men betyr at «bla» også finner «Blå».
- Absolutt-tidene gjelder datasettet over; ekte IMDb-data har flere titler og andre ordfordelinger.

## Importtid

`npm run db:seed -w backend` importerer 120 000 syntetiske titler (162 000 linjer i `basics`) på ca.
17 s, inkludert oppdatering av alle indekser. Fila strømmes (gunzip + readline) og skrives i
batcher på 2 000 rader; bare rating-rader over stemmegrensen holdes i minnet.

## Lighthouse

Målt 2026-09-30 med Lighthouse (Chromium, headless) mot produksjonsbygget servert av `vite preview`
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
- Initial JS er ca. 166 kB gzip (React, Apollo Client med rxjs, React Router). Detaljside og
  «Min liste» lazy-lastes. Videre kutt ville krevd å bytte ut Apollo, som er fastsatt i CLAUDE.md.
