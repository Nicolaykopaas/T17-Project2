# Slik virker appen

Dette dokumentet forklarer koden slik at alle på gruppa kan svare på spørsmål fra sensor og
faglærer. Det følger ett søk gjennom hele systemet, går så inn på de delene som er lettest å
spørre om, og ender med en liste over sannsynlige spørsmål med korte svar.

Henvisningene er `fil:linje` mot gjeldende `claude/adoring-brown-3nct5k`. Linjetall flytter seg når
koden endres; søk etter navnet på funksjonen eller konstanten hvis de ikke stemmer. Installasjon
står i [`oppsett.md`](oppsett.md), valgene bak i [`beslutninger.md`](beslutninger.md) og målingene
i [`ytelse.md`](ytelse.md).

1. [Én forespørsel fra tastetrykk til skjerm](#1-én-forespørsel-fra-tastetrykk-til-skjerm)
2. [Søket i databasen](#2-søket-i-databasen)
3. [Keyset-paginering](#3-keyset-paginering)
4. [Fasetter og totalCount](#4-fasetter-og-totalcount)
5. [Vern av API-et](#5-vern-av-api-et)
6. [Frontend-tilstand](#6-frontend-tilstand)
7. [Tilgjengelighet i praksis](#7-tilgjengelighet-i-praksis)
8. [Ytelse](#8-ytelse)
9. [Testoppsett](#9-testoppsett)
10. [Sannsynlige sensorspørsmål](#10-sannsynlige-sensorspørsmål)

## 1. Én forespørsel fra tastetrykk til skjerm

Brukeren skriver «dark» i søkefeltet på forsiden.

```
 Nettleser (React + Apollo)                       VM (it2810-17)
 ──────────────────────────                       ──────────────────────────────────────
 SearchBox          300 ms debounce, trim, uendret tekst = ingen request
    │ onCommit('dark')
 useSearchState     setSearchParams → URL  /project2/?q=dark   (flushSync)
    │ URL → parseSearchState → state
 SearchResults      useQuery(SEARCH_QUERY, { query, filters, sort, first: 20 })
    │ Apollo-cache: nøkkel search({query:"dark"}) – treff = ingen request
    │ miss ↓
 userIdLink → apiStatusLink → HttpLink  POST /project2/graphql
                                   │
                                   ▼
                          Apache (mod_proxy)  ──►  Node :3001 (GraphQL Yoga)
                          legger på X-Forwarded-For      │ 1. body ≤ 64 KiB
                          gzip av svaret  ◄──────────    │ 2. parse, maks 1000 tokens
                                                         │ 3. dybde ≤ 6, kostnad ≤ 2500
                                                         │ 4. kontekst (bruker, IP, loaders)
                                                         │ 5. resolver Query.search (validerer)
                                                         │ 6. searchTitles → ÉN SQL, LIMIT 21
                                                         ▼
                                                    PostgreSQL (pg_trgm GIN, btree)
 Apollo skriver sidene til cachen, normalisert på Title:<id>
    │
 SearchResults      skjelett → «N treff» (aria-live) → plakatkort
    │ IntersectionObserver (400 px før bunnen) → fetchMore({ after: endCursor })
```

1. **Tastetrykk.** `SearchBox` holder teksten i lokal state, så feltet føles direkte
   (`frontend/src/components/SearchBox.tsx:63-66`). Hvert tastetrykk starter en 300 ms timer på nytt
   (`frontend/src/hooks/useDebouncedCallback.ts:17-18`). Først når brukeren stopper, kjører
   `commit` (`SearchBox.tsx:30-36`): teksten trimmes og sammenlignes med det som allerede er meldt
   til URL-en. Samme tekst gir ingen request, så «dark » med mellomrom er samme søk som «dark».
   Enter avbryter timeren og committer med en gang (`:41-45`).
2. **URL.** `HeaderSearch` kaller `update({ q })` på forsiden og navigerer til `/?q=…` fra andre
   sider (`frontend/src/components/HeaderSearch.tsx:19-26`). `useSearchState.update` slår endringen
   sammen med resten av URL-en (`frontend/src/hooks/useSearchState.ts:26-35`), og
   `parseSearchState` lager `SearchState` av den (`frontend/src/lib/searchState.ts:75`).
3. **Visning.** `HomePage` ser at URL-en ikke lenger er «bla-modus» og laster `SearchView` som egen
   JS-chunk (`frontend/src/pages/HomePage.tsx:15,56`). `SearchResults` (`SEARCH_QUERY`) og
   `FilterPanel` (`FACETS_QUERY`) starter hver sin `useQuery`: to uavhengige kall i parallell.
4. **Apollo.** Cache-nøkkelen for `search` er bare `query`, `filters` og `sort`
   (`frontend/src/apollo/cache.ts:15`). Ligger søket i cachen (f.eks. etter «tilbake»), svarer
   Apollo uten nettverk. Ellers går kallet gjennom lenkene (`frontend/src/apollo/client.ts:39`):
   `userIdLink` legger på `x-user-id`, `apiStatusLink` fanger nedetid, `HttpLink` sender
   `POST /project2/graphql` (adressen bygges av Vites `base`, `client.ts:10`).
5. **Apache.** `ProxyPass /project2/graphql http://127.0.0.1:3001/graphql`
   (`deploy/apache-project2.conf:8`). `mod_proxy` legger klientens IP sist i `X-Forwarded-For`.
   Svaret komprimeres (`:53`) og får `Cache-Control: no-store` (`:69-70`).
6. **Yoga** (`backend/src/app.ts`), i denne rekkefølgen: kroppen avvises over 64 KiB (`:145`),
   dokumentet parses med tak på 1 000 tokens (`:110`), valideringsreglene kjører (`:113-121`: dybde,
   antall felt, kostnad), og konteksten bygges per request (`:147-155`, `backend/src/context.ts:31`).
7. **Resolver.** `Query.search` validerer `first` (1–50), `query` (trimmet, maks 200 tegn, ingen
   NUL) og filtre, og bruker `RELEVANCE` som standard (`backend/src/resolvers/index.ts:51-66`,
   `backend/src/validation.ts:28-45`).
8. **SQL.** `searchTitles` bygger én parametrisert spørring med `LIMIT first+1`
   (`backend/src/search.ts:218-240`); `buildPage` kutter den ekstra raden (`:184-205`).
9. **Felt-resolvere.** GraphQL kjører bare resolverne for feltene klienten ba om. `totalCount` gir en
   `count(*)` først nå, og plakat- og strømfelt hentes i batch for alle 20 kort (avsnitt 4).
10. **Svar og visning.** Apollo normaliserer hver tittel og slår siden sammen med tidligere sider.
    `SearchResults` viser skjelett til data er der, deretter «N treff» i en `aria-live`-region og
    kortene (`frontend/src/components/SearchResults.tsx:103,129`). Når sentinel-elementet nærmer
    seg viewport, kalles `fetchMore({ after: endCursor })` (`:58-73`,
    `frontend/src/hooks/useInfiniteScroll.ts`).

Tomt søk er ikke et søk: tømmes feltet, forsvinner `q` fra URL-en, `isBrowseState` blir sann og
forsiden viser radene (som ligger i cachen) i stedet for å sende `search(query: "")`.

## 2. Søket i databasen

All søking, filtrering og sortering skjer i `backend/src/search.ts`, i SQL, over hele `titles`
(190 607 titler i produksjon). Frontend sorterer eller filtrerer aldri selv.

### Genererte kolonner

`backend/migrations/004_unaccent_search.sql:24-29` legger tre lagrede, genererte kolonner på `titles`:

| Kolonne               | Innhold                                              | Brukes av             |
| --------------------- | ---------------------------------------------------- | --------------------- |
| `primary_title_norm`  | `lower(f_unaccent(primary_title))`                   | trigram-GIN, `LIKE`   |
| `original_title_norm` | `lower(f_unaccent(original_title))`                  | trigram-GIN, `LIKE`   |
| `title_words`         | `to_tsvector('simple', <begge normaliserte titler>)` | ordprefiks (1–2 tegn) |

**Hvorfor kolonner og ikke et uttrykk i spørringen?** Som indeksuttrykk ville `unaccent()` kjørt på
nytt for hver rad som leses i recheck, filter og relevansberegning. Som `STORED`-kolonne kjøres den
én gang, når raden skrives (ved importen). Prisen er ca. to ganger tittellengden i lagring per rad,
og at migreringen skriver om tabellen under lås (10–20 s på VM, se `docs/deploy.md`).

**Hvorfor `f_unaccent`?** Postgres krever `IMMUTABLE` i indekser og genererte kolonner, mens
`unaccent()` bare er `STABLE` (ordlisten kan teknisk byttes). `f_unaccent` (`004:11-13`) er en
`IMMUTABLE` innpakning med fullt kvalifisert ordlistenavn. Da blir indeksene lovlige, og
planleggeren kan forhåndsregne `lower(f_unaccent('dark'))` til en konstant slik at indeksen brukes.
Søketeksten normaliseres av **samme uttrykk i Postgres** (`norm`, `search.ts:54`), ikke i
TypeScript, så koden og databasen aldri er uenige om hva «uten aksent» betyr.

### To veier: ≥ 3 tegn og 1–2 tegn

`filterConditions` (`search.ts:95-125`) velger vei etter lengde (`isShortQuery`, `:84`).

- **3 tegn eller mer: trigram-GIN.** `pg_trgm` deler titlene i tretegnssekvenser («dark» → `dar`,
  `ark`), og indeksen peker fra hver sekvens til radene. `col LIKE '%dark%'` slår opp trigrammene og
  kontrollerer bare kandidatene (`titles_primary_title_trgm_idx` og `…original…`, `004:34-37`).
- **1–2 tegn: ordprefiks med tsvector.** «ma» har ingen trigrammer, så GIN kan ikke brukes og
  delstrengsøk ville lest hele tabellen. I stedet søkes `title_words @@ to_tsquery('simple', 'ma:*')`
  (`search.ts:80-81`), som finner ord som _begynner_ på «ma» («The Matrix»). `'simple'` betyr ingen
  stemming og ingen stoppord, så «the» kan søkes på. Prisen er at «ar» ikke finner «Dark».

Teksten renses for tegnsetting, mellomrom og kontrolltegn før den settes inn i tsquery-syntaks,
fordi `& | ! ( ) : * < > '` ellers er operatorer eller gir syntaksfeil. Blir ingenting igjen, gir
`NULLIF` NULL og null treff, ikke en feil (`search.ts:75-81`).

### Normalisering før escaping

I `LIKE` er `%`, `_` og `\` spesialtegn. Brukeren som søker på «100%» mener et prosenttegn, så de
escapes (`likePattern`, `search.ts:66-67`):

```sql
'%' || regexp_replace( lower(f_unaccent($1::text)),   -- 1. normaliser
                       '([\\%_])', '\\\1', 'g' )      -- 2. escape %, _ og \
    || '%'
```

**Rekkefølgen er sikkerhetskritisk.** Postgres' `unaccent.rules` mapper fullbreddetegn: `％`
(U+FF05) blir `%`, `＿` blir `_` og `＼` blir `\`. Escapet vi først og normaliserte etterpå, ville
et fullbredde-`％` slippe forbi escapingen, bli et ekte `%` og la søket treffe hele tabellen.
Normaliserer vi først, er alt som er igjen escapet. Testet i `backend/test/search.test.ts:141-160`.
Selve SQL-injeksjonsvernet er et annet lag: alt fra brukeren går som `$n`-parametre
(`class Params`, `search.ts:39-45`).

### Relevansformelen

For `RELEVANCE` med 3 tegn eller mer (`search.ts:150-163`):

```
relevans = 0,6 · word_similarity(søk, tittel)     -- står søkeordene i tittelen?
         + 0,2 · similarity(tittel, søk)          -- hvor lik er hele tittelen?
         + 0,2 · LEAST(log10(stemmer) / 7, 1)     -- popularitet, mettet ved 10 millioner
```

De to første er `GREATEST` over primær- og originaltittel. Sortering: `relevans DESC,
num_votes DESC, id DESC`. Bare `similarity` ville rangert en obskur tittel som heter «Dark Knight»
(1 500 stemmer) over «The Dark Knight», som brukeren nesten alltid mener. Ved 1–2 tegn er likhet
støy, så da rangeres det bare på stemmer (`:153`).

### Spørringen, forenklet

Side 1 for «dark» sortert på relevans, med én sjanger og ett tiår valgt:

```sql
SELECT t.id, t.primary_title, t.average_rating, t.num_votes, t.genres, …,
       (0.6 * GREATEST(word_similarity(q, t.primary_title_norm), word_similarity(q, t.original_title_norm))
      + 0.2 * GREATEST(similarity(t.primary_title_norm, q),      similarity(t.original_title_norm, q))
      + 0.2 * LEAST(log(GREATEST(t.num_votes, 1)) / 7.0, 1.0))::float8  AS k0,   -- q = norm($2)
       t.num_votes AS k1,  t.id AS k2                                              -- cursor-verdier
FROM titles t
WHERE (t.primary_title_norm  LIKE '%dark%'              -- trigram-GIN (bitmap OR)
    OR t.original_title_norm LIKE '%dark%')
  AND t.genres @> '{Drama}'::text[]                     -- GIN, bare hvis sjanger er valgt
  AND t.start_decade = ANY('{1990}'::int[])             -- bare hvis tiår er valgt
ORDER BY <relevans> DESC, t.num_votes DESC, t.id DESC
LIMIT 21;                                               -- first + 1
```

For `RATING`, `YEAR`, `TITLE` og stemmer finnes btree-indekser på nøyaktig samme uttrykk og
kolonnerekkefølge som `ORDER BY` (`001_init.sql:65-68`), så Postgres leser de 21 første radene rett
fra indeksen og stopper. Relevans har ingen indeks: den regnes ut for alle rader trigramfilteret
slipper gjennom (ca. 1 800 for «dark» på syntetiske data) og sorteres med top-N. Derfor er brede
søk («the», ca. 140 ms) det tregeste vi har.

## 3. Keyset-paginering

Koden ligger i `backend/src/keyset.ts`, sorteringsnøklene i `sortKeys` (`search.ts:148-181`).

Klienten sier ikke «gi meg side 7», men «gi meg radene etter denne raden». Raden identifiseres av
verdiene i sorteringsnøkkelen, og SQL bruker **radsammenligning** (`afterCondition`,
`keyset.ts:34-44`):

```sql
WHERE (COALESCE(t.average_rating, -1), t.num_votes, t.id) < ($4::numeric, $5::int, $6::text)
ORDER BY COALESCE(t.average_rating, -1) DESC, t.num_votes DESC, t.id DESC
LIMIT 21
```

- **Radsammenligning** `(a, b, c) < ($1, $2, $3)` er leksikografisk: først `a`, ved likhet `b`, ved
  likhet `c`. Postgres kan da bruke én btree-indeks på `(a, b, c)` og hoppe rett til posisjonen,
  i stedet for å evaluere en `OR`-kjede.
- **Alle nøkler går i samme retning** (`keyset.ts:7-9`), ellers fungerer ikke radsammenligningen.
- **`id` er alltid siste nøkkel.** Den er unik, så rekkefølgen er total: to rader kan aldri bytte
  plass eller droppes mellom sidene.
- **COALESCE-sentineler.** `NULL < x` er ukjent i SQL, og raden ville stille forsvunnet. Derfor
  `COALESCE(average_rating, -1)` og `COALESCE(start_year, 0)` (`search.ts:168,177`). Titler uten
  rating eller år er med, men havner sist i `DESC` og først i `ASC`.
- **`first + 1`.** Kommer den ekstra raden, finnes det en neste side
  (`hasNextPage = rows.length > first`, `search.ts:192`); den sendes aldri til klienten.

**Cursor-format.** `base64url(JSON.stringify({ s: signatur, v: verdier }))` (`encodeCursor`,
`keyset.ts:50`). Signaturen er sortering + retning + søketype, f.eks. `search:RATING:DESC:q`
(`q` = vanlig søk, `s` = kort søk på 1–2 tegn, `-` = uten tekst; `search.ts:223-226`). Den er en
etikett som hindrer at en cursor fra én sortering brukes på en annen, ikke en kryptografisk
signatur. `decodeCursor` (`keyset.ts:94-108`) gir `BAD_USER_INPUT` for for lang cursor, ugyldig
base64/JSON, feil signatur, feil antall verdier og verdier av feil type (endelige tall, heltall i
int32, tekst uten NUL, tidsstempler som ekte kalenderdatoer, `:63-74`). Alt valideres i
JavaScript, så en dårlig cursor aldri blir en databasefeil (som ville blitt en maskert 500).

### Eksempel: to sider

Søk «dark», sortert på rating (synkende), `first: 2`. Treffene i rekkefølge:

| #   | id          | rating | stemmer |
| --- | ----------- | -----: | ------: |
| 1   | `tt0000500` |    8,6 |  50 000 |
| 2   | `tt0000123` |    8,4 |   1 200 |
| 3   | `tt0000077` |    8,4 |     900 |
| 4   | `tt0000040` |    7,1 |     300 |

**Side 1.** `LIMIT 3` gir rad 1–3. Rad 3 er den ekstra, så `hasNextPage = true`, og bare rad 1 og 2
sendes. `endCursor` er cursoren til rad 2:

```
verdier:  [8.4, 1200, "tt0000123"]
cursor:   eyJzIjoic2VhcmNoOlJBVElORzpERVNDOnEiLCJ2IjpbOC40LDEyMDAsInR0MDAwMDEyMyJdfQ
          = base64url({"s":"search:RATING:DESC:q","v":[8.4,1200,"tt0000123"]})
```

**Side 2.** Klienten sender `after: <cursor>`. Serveren dekoder, sjekker signaturen og legger til
`AND (COALESCE(t.average_rating, -1), t.num_votes, t.id) < (8.4, 1200, 'tt0000123')`. Rad 3 har
samme rating, men færre stemmer (900 < 1 200), så den kommer med. Hadde den også hatt 1 200 stemmer,
hadde `id` avgjort. Rad 1 og 2 er borte uten at databasen har lest forbi dem.

### Hvorfor ikke OFFSET

`OFFSET 10000` betyr at Postgres må finne og kaste 10 000 rader før de 20 vi vil ha, så kostnaden
vokser lineært med hvor langt ned brukeren har scrollet. Legges det inn en ny tittel mens brukeren
leser, skyves alt ett hakk, og en rad vises to ganger (eller forsvinner). Keyset koster det samme
for side 1 som for side 500, og siden er en posisjon i sorteringen, ikke et radnummer.

## 4. Fasetter og totalCount

**Fasetter.** `getFacets` (`search.ts:270-335`) kjører fire tellinger parallelt (`Promise.all`):
sjangre, tiår, type og «kan strømmes». Hver bruker `filterConditions` med `skip` satt til sin egen
dimensjon. Eksempel: «dark» med tiår 1990 valgt. Sjangertallene teller titler som matcher «dark»
**og** 1990. Tiårstallene teller «dark» **uten** tiårsfilteret, så brukeren ser hvor mange som
finnes i 2000-årene mens 1990 er avkrysset. Slik viser tallet ved en avkrysningsboks hva man får
innenfor de andre filtrene. Valgte verdier med 0 treff vises likevel (`withSelected`, `:320-323`),
så brukeren kan fjerne dem. Sjangre telles med `CROSS JOIN LATERAL unnest(t.genres)` + `GROUP BY`
(`:298`), tiår med den genererte kolonnen `start_decade` (`001_init.sql:22`). Frontend sender samme
`query` og `filters` som søket (`frontend/src/components/FilterPanel.tsx:33`) og beholder forrige
fasetter mens nye hentes, så lista ikke blinker. Testet i `backend/test/facets.test.ts:59`.

**totalCount er lazy.** `Connection.totalCount` er en _funksjon_, ikke et tall (`search.ts:35`), og
er `memoize`d (`:253-256`). `TitleConnection.totalCount`-resolveren kaller den
(`resolvers/index.ts:38`), og GraphQL kaller bare resolvere for felt som er med i spørringen. Uten
`totalCount` i spørringen kjører ingen `count(*)`. Forsidens `ROW_QUERY` utelater feltet
(`frontend/src/graphql/operations.ts:71-76`) og sparer åtte helskanninger per visning;
`SEARCH_QUERY` har det, fordi trefflista viser «N treff». Tellingen bruker samme `filterConditions`
uten cursor og `LIMIT`, så den teller hele treffmengden.

**Batch-loader mot N+1.** Uten tiltak ga en side med 20 titler 20 spørringer for anmeldelsessnitt,
20 for «i min liste», 20 for strøm og så videre. `batchLoader` (`backend/src/loaders.ts:6-35`):
`load(key)` legger nøkkelen i en kø, og første kall planlegger `queueMicrotask(flush)` (`:29`).
GraphQL kaller feltresolverne for alle 20 kort synkront, så alle `load()`-kall rekker å havne i
køen før mikrooppgaven kjører. Da gjøres **én** spørring med `WHERE title_id = ANY($1::text[])`
(`backend/src/context.ts:50-72`). Resultatene caches per instans, og instansene lages per request,
så ingenting lekker mellom brukere. Samme mønster for plakater og strømmer. Testet i
`backend/test/title.test.ts:173` (`describe('N+1')`).

## 5. Vern av API-et

Et åpent GraphQL-endepunkt lar klienten bestemme hvor dyr spørringen er. Vi begrenser i lag, fra
billigst (avvis før noe arbeid) til dyrest (sikkerhetsnett):

| Lag                    | Grense                                      | Hvor                              |
| ---------------------- | ------------------------------------------- | --------------------------------- |
| Kroppsstørrelse        | 64 KiB                                      | `app.ts:35,145`                   |
| Tokens i dokumentet    | 1 000                                       | `app.ts:32,110`                   |
| Dybde                  | 6 nivå                                      | `app.ts:18`, `depthLimit.ts:15`   |
| Rotfelt / felt totalt  | 8 / 150                                     | `app.ts:21-22`                    |
| Vektet kostnad         | 2 500                                       | `app.ts:26`, `complexityLimit.ts` |
| `first` / søketekst    | 1–50 / 200 tegn                             | `validation.ts:3-4`               |
| Rate limit (mutations) | 10 anmeldelser/min, 60 andre/min per bruker | `rateLimit.ts:12`                 |
| Databasen              | `statement_timeout` 15 s, pool på 10        | `db.ts:14-18`                     |

**Tokengrensen.** Valideringsregelen `OverlappingFieldsCanBeMerged` i graphql-js er kvadratisk i
antall felt. `{ genres genres … }` med 8 000 felt (55 kB) holdt event-loopen opptatt i ca. 5 s.
Tokengrensen avviser dokumentet under parsing, før noen valideringsregel har kjørt (`app.ts:27-32`).
Frontendens største operasjon har 128 tokens, så det er åtte ganger slingringsmonn.

**Dybdegrensen** er en sikring mot at en fremtidig sirkulær relasjon (f.eks. `Review.title`)
åpner for uendelig nøsting (`depthLimit.ts:1-14`). Skjemaet nøster ikke dypere enn 6 i dag.

**Kostnadsgrensen** (`complexityLimit.ts:49-135`). Dybde stopper bare nøsting, men en flat spørring
med hundre aliasede `search(first: 50)` er like dyr. Vektingen:

- Et listefelt (`search`, `myList`, `reviews`) koster `first` ganger feltene under (`:25`,
  `multiplier` `:138-148`). Eksempel: `search(first: 20) { edges { node { id } } }` gir `node = 2`,
  `edges = 1 + 1·2 = 3`, `search = 1 + 20·3 = 61`.
- **Variabel `first` regnes alltid som 50** (`:147`), også med standardverdi, fordi klienten kan
  overstyre den i `variables`. Ellers kunne `query($n: Int = 1)` sendt med `n = 50` smuget seg forbi.
- `facets` har fast tillegg på 500 (`:32`): hvert kall kjører fire aggregeringer over hele
  tabellen. Med grensen 2 500 rommer en spørring fire; frontend sender én.
- Fragmenter memoiseres (`:61-69`). Uten det kan en kjede der hvert ledd spres ti ganger i neste
  gi eksponentielt mange besøk, og dermed CPU-DoS under valideringen.

Forsidens største spørring ligger på ca. 1 100 av 2 500. En vaktbikkjetest (avsnitt 9) sørger for
at det forblir slik.

**Rate limit** (`backend/src/rateLimit.ts`) gjelder mutations, ikke spørringer. _Token bucket_:
bøtta rommer N tokens, fylles jevnt til full over ett minutt (`:34-57`), og hvert kall koster ett.
En rolig bruker merker aldri grensen, mens en skriptløkke stoppes etter N kall. Svaret er
`RATE_LIMITED` med `retryAfterSeconds`. Det telles både per bruker og per IP (IP-grensen er tre
ganger høyere, fordi en klasse kan dele nett). Minnet er begrenset til 50 000 nøkler (`:28`).

**Hvilken IP?** Bak Apache ligger klientens IP sist i `X-Forwarded-For`; tidligere ledd kan
klienten ha forfalsket, så bare siste ledd brukes. Og headeren stoles på **bare** når selve
TCP-forbindelsen kommer fra loopback, altså fra Apache (`clientIp`, `rateLimit.ts:125-134`). Kommer
den fra en annen adresse, brukes den adressen. Ellers kunne noen nå port 3001 direkte og sette en
ny falsk IP i hver request. I produksjon lytter backend dessuten bare på `127.0.0.1`
(`backend/src/config.ts:37`).

**Feilmasking** (`maskError`, `app.ts:169-181`). Egne, forventede feil (`BAD_USER_INPUT`,
`NOT_FOUND`, …) og protokollfeil under HTTP 500 slippes gjennom. Alt annet blir `Intern feil.`
uten SQL, stack eller vertsnavn; detaljene logges bare på serveren. Unntak: er årsaken at
databasen ikke kan nås (`isDatabaseUnavailable`, `dbErrors.ts:15-40`: `ECONNREFUSED`,
Postgres-kode `57P01`/`57P03`/klasse `08`, pool-timeout), returneres `SERVICE_UNAVAILABLE` med en
generell melding. Frontend bruker koden til å velge banner (avsnitt 6). `/health` gjør `SELECT 1`
med 2 s tidsgrense og svarer 200 eller 503 (`app.ts:60-74,127-138`). Introspeksjon og GraphiQL er av
i produksjon (`:41-52,121,157-158`).

## 6. Frontend-tilstand

### URL-en er eneste kilde

Søketekst, filtre og sortering finnes bare i URL-en (`?q=dark&genres=Drama&sort=rating&dir=desc`).
`parseSearchState` leser den og `serializeSearchState` skriver den
(`frontend/src/lib/searchState.ts`). Ingen komponent har egen kopi, så lenker kan deles, «tilbake»
virker og reload gir samme visning. Unntaket er `SearchBox`, som har lokal tekst mens brukeren
skriver (ellers ville debouncen gjort feltet seigt) og synkroniserer fra URL-en hvis den endres
utenfra (`SearchBox.tsx:21-28`). Hvert tastetrykk og hver avkrysning bruker `replace`, så
historikken ikke fylles; første endring fra forsiden bruker `push`, ellers ville «tilbake» hoppet
forbi forsiden (`useSearchState.ts:29`).

### flushSync-fiksen

Avkrysningsboksene er _kontrollerte_ av URL-en (`checked={state.types.includes(t)}`). React Router
pakker navigasjon i en React-transition som standard. Mens den pågår, rendrer React den gamle
URL-tilstanden for hastende oppdateringer, så boksen ble satt tilbake til gammel verdi og «hoppet
frem igjen» et øyeblikk etter klikket (også synlig for skjermlesere). `flushSync: true`
(`useSearchState.ts:33`) gjør oppdateringen synkron. Det krever at `RouterProvider` importeres fra
`react-router/dom`, som kobler på `ReactDOM.flushSync` (`frontend/src/main.tsx:4-5`). Testhjelperen
gjør det samme (`frontend/src/test/utils.tsx:7-9`), og regresjonstesten står i
`frontend/src/pages/HomePage.test.tsx:227`.

### Apollo-cachen

- **Sider slås sammen.** `relayStylePagination(['query', 'filters', 'sort'])` (`cache.ts:15`) gir én
  cache-oppføring per søk, uavhengig av `first` og `after`. `fetchMore` føyer nye kanter til samme
  liste, og «tilbake» fra en detaljside viser alle innlastede sider uten request.
- **Titler er normalisert** på `Title:<id>`: samme film i flere rader deler ett cache-objekt, og
  `toggleList`/`deleteReview` oppdaterer det ett sted.
- **`ROW_QUERY` uten `totalCount`** deler `search`-nøkkel med `SEARCH_QUERY`. «Se alle» får likevel
  ikke antallet fra cachen: feltet mangler, så `SEARCH_QUERY` gir miss og henter første side på nytt
  (`operations.ts:71-76`).
- **Ingen blanding av søk.** Mens et nytt søk lastes, vises forrige resultat dempet
  (`previousData`, `is-stale`), men paginering bruker bare `data` for gjeldende søk
  (`SearchResults.tsx:30-52`). En cursor fra forrige søk kan aldri kombineres med nye variabler.

### Reaktiv variabel for API-status

`apiUnavailable` og `apiFailureKind` er `makeVar`s (`frontend/src/apollo/apiStatus.ts:12,19`). En
`ErrorLink` setter dem ved ekte nedetid (`client.ts:20-27`). `classifyApiFailure`
(`apiStatus.ts:30-47`) skiller nettverksfeil og 502/503/504 (`network`) fra `SERVICE_UNAVAILABLE`
(`service`), og ignorerer vanlige GraphQL-feil, siden de betyr at serveren svarte. Første
vellykkede svar nullstiller tilstanden (`client.ts:29`). `ApiUnavailableBanner` viser **ett**
banner, og radene og søket viser da ikke egne feil (`SearchResults.tsx:85`). «Prøv igjen» kjører
`client.refetchQueries({ include: 'active' })` (`ApiUnavailableBanner.tsx:23`). Uten dette ville
åtte rader gitt åtte feil uten å forklare hvorfor.

## 7. Tilgjengelighet i praksis

Mål: WCAG 2.1 AA. Det som er lettest å glemme er **fokus** når elementet brukeren står på
forsvinner. Faller fokus til `<body>`, mister tastaturbrukeren plassen og skjermleseren tier.

- **Fokus til h1 ved rutebytte** (`frontend/src/components/Layout.tsx:27-73`). Etter navigasjon
  flyttes fokus til sidens `h1` (`tabIndex = -1`; uten h1 til `<main>`), så skjermleseren leser opp
  hvor man er. Men `h1` finnes ofte ikke ennå, siden siden er lazy-lastet og først viser «Laster …».
  Derfor følger en `MutationObserver` (`:45`) med og flytter fokus til gjeldende `h1` ved hver
  DOM-endring, **så lenge fokus er der vi la det eller er mistet**. Den **gir opp** (`stop`, `:59`)
  så snart brukeren selv gjør noe: `pointerdown`/`keydown` (`:58`), fokus til et annet element
  (`:53`), eller etter 3 s (`:68`). Ellers ville den stjålet fokus fra en som begynner å tabbe. Skriver
  brukeren i søkefeltet, røres fokus ikke (`:32`).
- **`aria-disabled` i stedet for `disabled`.** Chrome fjerner fokus fra en knapp som blir `disabled`,
  så den som trykket «Last flere» med Enter havner på `<body>`. `aria-disabled` beholder fokus og
  leses fortsatt som utilgjengelig; klikkhåndtereren vokter selv mot dobbeltkjøring
  (`busy.current`, `SearchResults.tsx:59`). Brukes bl.a. i `SearchResults.tsx:153`, `ReviewForm`,
  `ApiUnavailableBanner`, `DeleteReviewButton` og `TitleRow` (pilene).
- **Fokus når kontroller fjernes:**
  - _Filter-chips_ (`ActiveFilters.tsx:17-32,79`): fokus går til nabo-chipen, så man kan fjerne
    flere på rad med tastaturet, og til resultatoverskriften når lista blir tom (`focusResults`,
    `frontend/src/lib/focus.ts:6`).
  - _Siste filter fjernes_ og visningen blir forsiden: `useFocusOnViewSwitch` flytter fokus til
    `h1`, men bare hvis det faktisk er mistet (`HomePage.tsx:55`). «Nullstill alle» gjør det samme
    (`SearchView.tsx:19-28`).
  - _«Last flere»_ forsvinner på siste side: `useMoreButtonFocus` husker via `onFocus`/`onBlur` at
    knappen hadde fokus (etterpå er det for sent å spørre) og flytter det til «Viser X av Y»
    (`SearchResults.tsx:56`).
  - _Kategorihopp_ (`CategoryNav.tsx:4-18`): fokus til radens ytre `div` med `role="group"` og
    `aria-label`, ikke til overskriften, siden raden senere kan bli tom og fjerne den.
  - _Sletting av anmeldelse_ (`DeleteReviewButton.tsx:22-30`): knappene byttes ut, så en ref +
    effekt flytter fokus først etter at React har committet.
- **`aria-live` for antall treff.** `<p role="status" aria-live="polite">N treff</p>`
  (`SearchResults.tsx:103`) er den eneste regionen som leses opp ved nytt søk; seksjonen har
  `aria-busy` mens data hentes. Hele trefflista leses ikke opp på nytt.
- **Ett banner.** Nedetid gir ett `role="alert"` (`ApiUnavailableBanner.tsx:39`). Knappen ligger
  utenfor alerten, og et mislykket nytt forsøk meldes i en egen `role="status"`, så alerten ikke
  leses opp på nytt hver gang teksten endres.
- **Ellers:** `<form role="search">` med synlig label, «Hopp til innhold», kort som `<article>` med
  `aria-labelledby` og tomt `alt` (tittelen står som tekst ved siden av), «Se nå» som tekst og ikke
  bare farge, synlig fokusring og `prefers-reduced-motion`. axe kjører i Playwright på alle sider i
  lys og mørk modus, desktop og mobil (`e2e/a11y.spec.ts`).

## 8. Ytelse

- **Statisk app-skall.** `frontend/index.html` har header og heltebanner-plassholder inne i `#root`
  (`:28`ff), så nettleseren kan male før JavaScript har kjørt. `createRoot` erstatter dem. Skallet er
  `aria-hidden` og har ingen lenker. `theme-init.js` (`:18`) kjører synkront før første maling og
  setter lagret tema og `data-hero`, så siden ikke blinker i feil tema.
- **`startTransition` og `useDeferredValue`.** Første rendering er pakket i `startTransition`
  (`main.tsx:19`), så React deler arbeidet i biter på ca. 5 ms og gir kontrollen tilbake til
  nettleseren i stedet for én lang oppgave som blokkerer input. `TitleRow` bruker `useDeferredValue`
  (`TitleRow.tsx:35`): kortene tegnes i en avbrytbar rendering etter at dataene har kommet, og
  skjelettet står til de er klare.
- **Lazy lasting.** Detalj-, spiller- og listesiden er `lazy` (`routes.tsx:10-12`); treffliste og
  filtre er en egen chunk som bare lastes ved søk (`HomePage.tsx:15`). Forsideradene under folden
  henter først data når de nærmer seg viewport (`LazyRow.tsx:14-17`, `skip: !near`), noe som sparer
  både requests og TMDB-oppslag.
- **Vendor-chunks** (`frontend/vite.config.ts:14-30`): `react`, `router` og `apollo` er egne filer.
  De endres sjelden, så nettleseren gjenbruker dem etter en ny deploy mens appkoden får nytt hash.
- **Bilder** (`PosterCard.tsx:41-60`): `srcset` med 185 og 342 px, `sizes` etter layout, faste
  `width`/`height` (ingen layout-hopp) og `decoding="async"`. De seks første plakatene er `eager`
  og den første i tillegg `fetchpriority="high"`; resten er `lazy` (`SearchResults.tsx:22,135`).
  `preconnect` mot `image.tmdb.org` (`index.html:12`). Serveren godtar bare kjente bredder
  (`POSTER_WIDTHS`, `backend/src/artwork.ts`).
- **Smale spørringer.** Listene henter bare feltene kortet trenger (`SUMMARY_FIELDS`,
  `operations.ts:24-25`), ikke `overview` eller bakgrunnsbilder.
- **Caching og komprimering** (`deploy/apache-project2.conf`). `assets/` har innholdshash og caches
  i ett år (`immutable`, `:59`), mens `index.html` alltid revalideres. `mod_deflate` komprimerer
  `application/graphql-response+json` (`:53`), som er det Apollo Client 4 ber om og Yoga svarer
  med; uten den ble hvert GraphQL-svar sendt ukomprimert.

## 9. Testoppsett

- **Backend: mot ekte Postgres.** `backend/test/global-setup.ts` dropper skjemaet i testdatabasen og
  kjører alle migreringer fra scratch, så migreringene testes også. Testene kaller `yoga.fetch()`
  direkte uten nettverksport (`backend/test/helpers.ts:31-50`) og deler én database
  (`fileParallelism: false`). Rene enhetstester (`cursor`, `depthLimit`, `complexityLimit`,
  `validation`, `dbErrors`) ligger ved koden. `search-index.test.ts:70-90` bruker `EXPLAIN` til å
  bevise at trigramindeksen brukes for «dark», ordprefiksindeksen for «da», og at kort søk ikke
  regner likhet.
- **Utypisk bruk testes eksplisitt:** tomt søk, ingen treff, SQL-injeksjon, 200 vs 201 tegn,
  NUL-tegn, fullbreddetegn, ugyldig og gjenbrukt cursor (`search.test.ts`, `pagination.test.ts`).
- **Frontend: Vitest + Testing Library.** `renderApp` (`frontend/src/test/utils.tsx:99`) bruker
  `MockedProvider` med **samme** `createCache()` som produksjon, en minnerouter og
  `react-router/dom`. `buildMocks` (`:74`) lager én handler per operasjon som også logger variablene,
  så testene kan telle requests (debounce gir ett kall, uendret søk gir null). Nettverksfeil,
  tomt resultat og `SERVICE_UNAVAILABLE` har egne tester (`HomePage.offline.test.tsx`).
- **E2E: Playwright**, desktop og mobil (Pixel 7). `playwright.config.ts` starter falsk TMDB (3999),
  falsk Internet Archive (3998), den bygde backenden og `vite preview` av frontend. Preview sender
  **samme CSP som Apache**: `e2e/csp-policy.ts` leser den fra `deploy/apache-project2.conf` med
  verter byttet mot mock-ene, så et nytt eksternt opphav gir testbrudd i stedet for feil i
  produksjon. `global-setup.ts` migrerer en egen E2E-database, fyller den med 20 000 syntetiske
  titler og tømmer anmeldelser og lister før hver kjøring. Ingen test trenger internett.
- **`failOnFlakyTests`** (`playwright.config.ts:22`): i CI får en test ett nytt forsøk for å gi
  trace, men består den bare på forsøk to, teller den som feil. Ustabile tester skal fikses.
- **Vaktbikkjetesten** (`backend/test/server.test.ts:115-178`) leser `frontend/src/graphql/operations.ts`
  _som tekst_, trekker ut hver `gql`-mal med regex og validerer dem mot skjemaet med samme regler og
  grenser som `createApp`. Den sjekker også at antall funnede operasjoner er lik antall
  `gql`-maler i fila (en ny operasjon i et format regexen ikke kjenner kan ikke gli forbi), og at
  hver holder seg under en fjerdedel av tokengrensen. Feiler den, er skjemaet endret uten at
  klienten fulgte med, eller grensene er for stramme for den faktiske klienten.
- **Omfang** (siste verifiserte kjøring, `docs/status.md`): ca. 415 backendtester, 288
  komponenttester og 101 bestått E2E. CI (`.gitlab-ci.yml`) kjører lint, typecheck, enhetstester
  mot Postgres 16, build og E2E.

## 10. Sannsynlige sensorspørsmål

**1. Hvorfor skalerer dette til en udefinert stor datamengde?**
Ingenting leser hele datasettet i hovedløypa. Søk, filter og sortering er indeksdrevne, hver side
er maks 50 rader, og keyset-paginering koster det samme uansett hvor langt ned man er. Svarets
størrelse er uavhengig av tabellstørrelsen. Det som vokser med data er `count(*)` og
relevanssortering, som er lineære i antall _treff_ (ikke tabellen), og de kjøres bare når de
trengs. Ærlig: svært brede søk («the») er dyrest (ca. 140 ms ved 120 000 titler). Ved mye større
data ville vi cachet eller estimert tellingen.

**2. Hva skjer om to titler har lik rating?**
Sorteringsnøkkelen er `(rating, stemmer, id)`. Ved lik rating avgjør stemmer, ved lik begge avgjør
`id`, som er unik. Rekkefølgen er total og stabil, så ingen rad dukker opp to ganger eller
forsvinner mellom sidene (avsnitt 3).

**3. Hvorfor ikke `ILIKE`?**
`ILIKE '%dark%'` på råkolonnen kan ikke bruke en vanlig indeks og leser hele tabellen. Vi bruker
`LIKE` mot en normalisert kolonne (`lower` + `unaccent`) med trigram-GIN. Det er raskere, og det
gjør søket aksentuavhengig («amelie» finner «Amélie»).

**4. Hvorfor ikke SSR?**
Appen er en interaktiv søkeflate som serveres som statiske filer bak Apache. Sidene trenger ikke
indekseres av søkemotorer, og SSR ville krevd en Node-renderer i drift og hydrering for liten
gevinst. Det SSR ville gitt, rask første maling, har vi dekket med statisk app-skall, lazy chunks
og Lighthouse Performance 100 (`docs/ytelse.md`). Svakheten: innholdet finnes ikke uten JavaScript
(`<noscript>` forklarer det).

**5. Hvordan unngår dere unødige requests?**
Debounce på 300 ms, trim og sammenligning mot forrige verdi, så tomt og uendret søk aldri sendes
(`SearchBox.tsx:30-36`). Cache-nøkkel uten `first`/`after`, så «tilbake» ikke henter på nytt. Rader
under folden venter til de er nær viewport. `totalCount` hentes bare der det vises. Testene teller
requests.

**6. Hvordan sikrer dere at sortering skjer på hele settet?**
Sorteringen er `ORDER BY` i SQL mot hele `titles` etter at filtrene er brukt, og cursoren er en
posisjon i den sorteringen. Frontend har ingen `.sort()` på resultater (bare rekkefølgen på
sjanger-_etikettene_ i filterpanelet sorteres klientside). `pagination.test.ts` verifiserer alle
fire sorteringene og at ingen rader forsvinner.

**7. Hvorfor cursor og ikke OFFSET?**
`OFFSET` leser og kaster alle radene foran, så side 500 er 500 ganger dyrere enn side 1, og nye
rader mellom sidene gir duplikater eller hull. Keyset hopper direkte til posisjonen i indeksen.

**8. Er cursoren trygg mot manipulering?**
Den er ikke kryptert eller signert, og trenger ikke å være det: den inneholder bare
sorteringsverdier. En forfalsket cursor kan i verste fall flytte brukeren til en annen posisjon i
samme sortering. Den valideres strengt (type, lengde, signatur mot sortering), og verdiene går som
parametre, så den kan ikke brukes til injeksjon.

**9. Hvordan er SQL-injeksjon forhindret?**
Alle brukerverdier går som `$n`-parametre (`class Params`), og SQL-teksten bygges bare av konstante
biter. Jokertegn i `LIKE` er et eget tema og escapes etter normalisering (avsnitt 2). Testet i
`search.test.ts:83`.

**10. Hvorfor ligger tilstanden i URL-en?**
Lenker kan deles, «tilbake» og reload virker uten ekstra kode, og det finnes aldri to sannheter som
kan komme ut av synk. Apollo-cachen holder serverdata og en reaktiv variabel API-status, men selve
søket bor i URL-en.

**11. Hva skjer hvis databasen går ned?**
Node lever, men spørringene feiler. `maskError` gjenkjenner det og svarer `SERVICE_UNAVAILABLE` uten
interne detaljer. Frontend viser ett banner med «Prøv igjen», og `/health` svarer 503, så
`deploy/sjekk.sh` kan skille «API nede» fra «database nede». Er Node nede, gir Apache 502/503 og
samme banner med litt annen tekst.

**12. Hvordan fungerer søk for skjermleser?**
Feltet har label og ligger i `role="search"`. Når resultatet kommer, leser `aria-live="polite"` opp
«N treff», og bare det. Fjernes et filter eller en knapp, flyttes fokus til et logisk sted i stedet
for å falle til `<body>` (avsnitt 7).

**13. Hvorfor GraphQL og ikke REST?**
Klienten velger feltene: forsiden henter plakat og tittel, detaljsiden henter alt, uten ett
endepunkt per visning. `edges`/`pageInfo` passer cursor-paginering, og Apollo normaliserer cachen.
Prisen er at serveren må forsvare seg mot dyre spørringer, noe avsnitt 5 viser at vi har gjort.

**14. Hva er svakhetene?**

- Ingen innlogging: den anonyme bruker-IDen ligger i `localStorage`, så anmeldelser og liste følger
  nettleseren, ikke en person, og kan i prinsippet forfalskes (derfor rate limit).
- Rate limit ligger i prosessminnet og nullstilles ved restart; det holder for én prosess, ikke
  flere. Spørringer er ikke rate-limitet, bare kostnadsbegrenset.
- Søk på 1–2 tegn er ordprefiks, ikke delstreng («ar» finner ikke «Dark»), og `unaccent` følger
  Postgres' regler («å» blir «a», så «bla» finner også «Blå»).
- Brede søk («the») er dyre fordi alle treff telles og rangeres.
- Cursoren er ikke kryptografisk signert.
- Målingene er gjort på syntetiske data (120 000 titler), ikke det ekte settet.
- Ingen SSR, og innholdet krever JavaScript. VM-en kjører http, så noen sikkerhetsheadere (COOP)
  er utelatt.
