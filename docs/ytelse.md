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
- **Grenser vi kjenner til:** søketekst på 1–2 tegn har færre enn ett trigram og kan ikke bruke
  GIN-indeksen (Postgres faller tilbake til sekvensiell skanning, ca. samme tid som «uten indeks»).
  `totalCount` og fasetter regnes ut på hele treffmengden hver gang og er derfor den dyreste delen
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
