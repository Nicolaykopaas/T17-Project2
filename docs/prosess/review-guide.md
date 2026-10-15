# Review-guide for gruppa

Mye av koden er skrevet av KI-agenter. Oppgaveteksten krever at gruppa viser **egen kontroll**
gjennom issues, merge requests og kodegjennomgang. Denne guiden gir Sturla, Brage og Daniel hver sin
del av koden å sette seg inn i, vurdere og forbedre. Målet er at hver av dere kan forklare delen
deres for sensor, og at git-historikken viser en review og minst én endring fra hver av dere.

Regn med 2–3 timer per person. Delene er uavhengige, så dere kan jobbe samtidig.

## Slik gjør du det

1. **Sett opp lokalt** (én gang, ca. 5 min): `npm ci`, `npm run setup`, `npm run dev`. Appen
   kjører på <http://localhost:5173/project2/>. Detaljer står i [`oppsett.md`](../oppsett.md).
2. **Lag et issue** fra malen «Oppgave»: «Review av <din del>», tildelt deg selv.
3. **Les filene** i rekkefølgen under. Les kommentarene: de forklarer _hvorfor_ koden ser ut som den
   gjør.
4. **Gjør øvelsen.** Ødelegg noe med vilje og se hvilken test som fanger det. Det er den raskeste
   måten å forstå koden og testene på. Rull tilbake etterpå (`git checkout -- <fil>`).
5. **Gå gjennom sjekklista** og noter funn: hva som er bra, hva som er uklart, og hva som er feil.
6. **Lag en gren og en MR** (`review/<navn>-<del>`) med minst én egen forbedring, for eksempel en
   ny test for et kanttilfelle, en tydeligere kommentar, en rettet feil eller en presisering i
   `docs/`. Skriv funnene dine i MR-beskrivelsen eller som kommentarer på linjene i koden.
7. **Få en annen i gruppa til å godkjenne MR-en**, og merge den til `main`.
8. **Skriv din del** av «Gruppens egen gjennomgang» i
   [`ki-deklarasjon.md`](../ki/ki-deklarasjon.md), med egne ord.

Før du pusher: `npm run lint && npm run typecheck && npm test`. Pre-commit-hooken kjører ESLint og
Prettier på filene du endrer.

**Ikke la KI-en skrive reviewen eller svarene i ki-deklarasjonen for deg.** Bruker du KI til å
forklare kode, så skriv det i ki-deklarasjonen. Poenget er at du selv kan stå for det du skriver.

Fant du noe som er for stort å rette selv? Lag et eget issue med funnet og hvor i koden det er.

---

## Sturla – backend: søk, paginering og database

Du eier delen som avgjør om appen skalerer: at søk, filter og sortering skjer i SQL på hele
datasettet, og at pagineringen er like rask på side 1000 som på side 1.

### Les i denne rekkefølgen

| Fil                                                                                    | Hva du skal forstå                                                                  |
| -------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------- |
| `backend/migrations/001_init.sql`                                                      | Tabellene, og hvilke indekser som finnes (GIN-trigram, btree for sortering)         |
| `backend/migrations/004_unaccent_search.sql`                                           | Genererte kolonner for aksentfri tittel, og `tsvector` for korte søk                |
| `backend/src/search.ts`                                                                | `filterConditions`, `sortKeys`, `searchTitles` og `getFacets`. Kjernen i hele appen |
| `backend/src/keyset.ts`                                                                | Cursor: hvordan den kodes, valideres og blir til `(a, b, id) < ($1, $2, $3)`        |
| `backend/src/validation.ts`                                                            | Hvilke input API-et avviser, og hvorfor                                             |
| `backend/src/typeDefs.ts`, `backend/src/resolvers/index.ts`                            | GraphQL-kontrakten og hvordan resolverne kaller `search.ts`                         |
| `backend/src/complexityLimit.ts`, `depthLimit.ts`, `rateLimit.ts`                      | Hvordan API-et beskyttes mot dyre eller mange spørringer                            |
| `backend/scripts/import-core.ts`, `import-imdb.ts`                                     | Strømmende import som tåler å kjøres på nytt                                        |
| [`docs/ytelse.md`](../ytelse.md), [`docs/beslutninger.md`](../beslutninger.md) (M1–M2) | Målingene og begrunnelsene                                                          |

### Øvelse

1. Kjør `psql project2` og `EXPLAIN ANALYZE` på et søk med og uten indeks. Spørringen står i
   `docs/ytelse.md`. Se at planen bytter fra `Seq Scan` til `Bitmap Index Scan`.
2. Fjern `ID` fra sorteringsnøklene for `YEAR` i `sortKeys` og kjør `npm test -w backend`. Hvilken
   test feiler, og hvorfor gir manglende unik siste nøkkel hull eller duplikater mellom sidene?
3. Bytt `regexp_replace(...)` i `likePattern` med bare søketeksten og kjør testene. Hva skjer med
   søk på `%` og `_`?

### Sjekkliste

- [ ] All brukerdata går som parametere (`$n`). Finnes det et sted der tekst limes inn i SQL?
- [ ] Filtrering og sortering skjer i SQL, aldri i JavaScript etter at radene er hentet.
- [ ] Sorteringsuttrykkene i `sortKeys` er identiske med indeksene i migreringene. Ellers brukes ikke
      indeksen.
- [ ] Cursoren avvises hvis den brukes med en annen sortering eller et annet søk (`signature`).
- [ ] `totalCount` beregnes bare når klienten ber om det (lazy og memoisert).
- [ ] Fasettene teller hver dimensjon med de _andre_ filtrene aktive. Er det riktig oppførsel for
      brukeren?
- [ ] Hva skjer med 10 eller 100 ganger så mye data? Hvilke spørringer vokser lineært
      (relevanssortering, `totalCount`, fasetter)?
- [ ] Importen: kan den kjøres to ganger uten duplikater? Leser den hele fila inn i minnet?

### Spørsmål sensor kan stille deg

- Hvorfor cursor og ikke `OFFSET`? Hva skjer med `OFFSET 20000`?
- Hvordan virker trigramsøk, og hvorfor fungerer det ikke for søk på 1–2 tegn?
- Hvorfor er søket uavhengig av store/små bokstaver og aksenter, og hvor skjer det?
- Hvordan hindrer dere SQL-injeksjon og dyre GraphQL-spørringer?
- Hva er den tregeste spørringen, og hvordan ville dere gjort den raskere?

### Forslag til egen MR

- En test for et kanttilfelle du mener mangler, for eksempel søk med bare mellomrom, emoji eller
  `minRating` på grensen.
- `EXPLAIN ANALYZE` på VM-en med ekte data (`deploy/mal-ytelse.sh`) og tabellen limt inn i
  `docs/ytelse.md`. Det er punkt G2 i [`plan.md`](plan.md).

---

## Brage – frontend og tilgjengelighet

Du eier det brukeren ser: søkeopplevelsen, tilstanden i URL-en, og at alt virker med tastatur og
skjermleser (WCAG 2.1 AA).

### Les i denne rekkefølgen

| Fil                                                                                | Hva du skal forstå                                                                   |
| ---------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------ |
| `frontend/src/routes.tsx`, `frontend/src/components/Layout.tsx`                    | Ruter som lastes ved behov, skip-lenke, og fokus til `h1` ved rutebytte              |
| `frontend/src/lib/searchState.ts`, `frontend/src/hooks/useSearchState.ts`          | Søketilstanden ligger i URL-en: lesing, skriving, `push` mot `replace`               |
| `frontend/src/components/SearchBox.tsx`, `hooks/useDebouncedCallback.ts`           | 300 ms debounce, og hvorfor tomme og uendrede søk aldri gir request                  |
| `frontend/src/components/SearchView.tsx`, `SearchResults.tsx`                      | Antall treff i `aria-live`, «Last flere», tom- og feiltilstander                     |
| `frontend/src/hooks/useInfiniteScroll.ts`, `hooks/useMoreButtonFocus.ts`           | Uendelig scroll, og hvor fokus havner når nye rader kommer                           |
| `frontend/src/components/FilterPanel.tsx`, `ActiveFilters.tsx`, `SortControls.tsx` | Skjemaelementer, etiketter og `flushSync`-fiksen                                     |
| `frontend/src/apollo/cache.ts`, `apollo/client.ts`, `apollo/apiStatus.ts`          | Apollo-cachen, sammenslåing av sider, og reactive vars for nedetid                   |
| `frontend/src/components/ReviewForm.tsx`, `DeleteReviewButton.tsx`                 | Skjemavalidering, feilmeldinger koblet til felt, bekreftelse og fokus etter sletting |
| `frontend/src/styles/global.css`                                                   | Fargetokener, lys og mørk modus, `:focus-visible`, `prefers-reduced-motion`          |
| [`docs/beslutninger.md`](../beslutninger.md) (M3 og #16)                           | Begrunnelsene                                                                        |

### Øvelse

1. **Bare tastatur:** Bruk appen uten mus i fem minutter. Søk, filtrer, sorter, åpne en film,
   skriv en anmeldelse, slett den og legg filmen i «Min liste». Noter hvor fokus blir borte eller er
   vanskelig å se.
2. **Skjermleser:** Slå på VoiceOver (Cmd+F5 på Mac) eller NVDA (Windows). Søk, og hør at antall
   treff leses opp. Gå gjennom filterpanelet og hør at etikettene gir mening.
3. **Zoom og smal skjerm:** 200 % zoom i nettleseren og 320 px bredde i DevTools.
4. Fjern `flushSync: true` i `useSearchState.ts`, kjør `npm run test:e2e`, og se hvilken test som
   blir ustabil. Forklaringen står i kommentaren.

### Sjekkliste

- [ ] Alle interaktive elementer kan nås og brukes med tastatur, og fokus er synlig i lys og mørk
      modus.
- [ ] Hver side har én `h1`, og overskriftsnivåene hopper ikke.
- [ ] Skjemafelt har synlige etiketter, og feilmeldinger er koblet til feltet (`aria-describedby`).
- [ ] Ikoner uten tekst har tilgjengelig navn.
- [ ] Antall treff og status (lagret, slettet, feil) annonseres med `aria-live`, uten at det blir
      for mye prat.
- [ ] Kontrast er minst 4,5:1 for tekst. Sjekk særlig grå tekst på plakatbilder og i lys modus.
- [ ] Animasjoner respekterer `prefers-reduced-motion`.
- [ ] Videospilleren (`VideoPlayer.tsx`) kan styres med tastatur og har undertekster når de finnes.
- [ ] Tilbake-knappen gir forventet resultat i søk, detaljside og spiller.
- [ ] Bærekraft: lastes bilder og rader først når de trengs? Er det tunge biblioteker vi kunne
      unngått?

### Spørsmål sensor kan stille deg

- Hvorfor ligger søketilstanden i URL-en og ikke i en egen store? Hva bruker dere Apollo til?
- Hvordan unngår dere unødvendige requests ved søk?
- Hvordan vet en skjermleserbruker at resultatet har endret seg?
- Hvor havner fokus når man bytter side, sletter en anmeldelse eller laster flere resultater?
- Hvilke valg i designet gjør appen grønnere?

### Forslag til egen MR

- Rett noe du fant i tastatur- eller skjermlesertesten, eller skriv funnet som et issue.
- Skriv en kort seksjon i `docs/` om den manuelle tilgjengelighetstesten: hva du testet, med hvilket
  verktøy og hva du fant. Det er noe axe ikke kan gjøre, og det styrker vurderingen av
  tilgjengelighet.

---

## Daniel – testing og kvalitet

Du eier bevisene for at appen virker: testene, CI og at de faktisk tester typisk og utypisk bruk.
Oppgaveteksten krever komponenttester (Vitest), E2E og API-tester, og vurderer «utførlig testet for
typisk og utypisk bruk».

### Les i denne rekkefølgen

| Fil                                                                                         | Hva du skal forstå                                                                  |
| ------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------- |
| `.gitlab-ci.yml`                                                                            | Hvilke jobber som kjører i CI, og hvorfor E2E har egen Postgres og Playwright-bilde |
| `backend/vitest.config.ts`, `backend/test/global-setup.ts`, `helpers.ts`, `fixtures.ts`     | Testdatabasen: nullstilles og migreres før kjøringen; hvorfor ikke parallelt        |
| `backend/test/search.test.ts`, `pagination.test.ts`                                         | API-tester for søk, filtre, sortering og paginering uten hull eller duplikater      |
| `backend/test/mutations.test.ts`, `rate-limit.test.ts`, `server.test.ts`                    | Mutations, rate limit og oppførsel når databasen er nede                            |
| `frontend/src/test/utils.tsx`, `test/setup.ts`                                              | Hvordan komponenter rendres med falsk Apollo og router                              |
| `frontend/src/components/SearchBox.test.tsx`, `FilterPanel.test.tsx`, `ReviewForm.test.tsx` | Komponenttester: debounce, filtre, skjemavalidering                                 |
| `playwright.config.ts`, `e2e/global-setup.ts`                                               | Falsk TMDB og Archive, egen E2E-database, `failOnFlakyTests`                        |
| `e2e/flow.spec.ts`, `e2e/a11y.spec.ts`, `e2e/api-unavailable.spec.ts`                       | Lange flyter, axe på alle sider i lys og mørk modus, API nede                       |
| [`docs/forklaring.md`](../forklaring.md#9-testoppsett)                                      | Oversikten over testoppsettet                                                       |

### Øvelse

1. Kjør alt selv fra ren klon: `npm ci`, `npm run lint`, `npm run typecheck`, `npm test`,
   `npm run test:e2e`. Noter tid og antall tester, og sammenlign med README.
2. Introduser en feil, for eksempel `SEARCH_DEBOUNCE_MS = 0` i `SearchBox.tsx` eller fjern
   `.trim()` i `commit`, og se om en test fanger den. Fanger ingen test feilen, har du funnet et hull.
3. Åpne HTML-rapporten (`npx playwright show-report`) og en trace for én test, så du kan vise
   sensor hvordan dere feilsøker E2E.

### Sjekkliste

- [ ] Tester de oppførsel (det brukeren ser og API-kontrakten) og ikke implementasjonsdetaljer?
- [ ] Utypisk bruk: tomt søk, ingen treff, spesialtegn, SQL-injeksjon, veldig lange strenger,
      ugyldig cursor, nettverksfeil, database nede, samtidige kall. Finn testen for hver, og noter
      hvilke som mangler.
- [ ] Er det tester som bare sjekker at noe rendres, uten å sjekke resultatet?
- [ ] Bruker E2E faste ventetider (`waitForTimeout`) som kan gjøre dem ustabile?
- [ ] Er testene uavhengige av hverandre og av rekkefølgen?
- [ ] Hva tester _ikke_ axe? Hvilke tilgjengelighetskrav må testes manuelt?
- [ ] Kjører CI-pipelinen på GitLab grønt etter flyttingen (punkt G1 i [`plan.md`](plan.md))?

### Spørsmål sensor kan stille deg

- Hva er forskjellen på komponenttestene, API-testene og E2E-testene, og hvorfor trengs alle tre?
- Hvorfor tester dere mot ekte PostgreSQL og ikke en mock?
- Hvordan tester dere utypisk bruk? Vis et eksempel.
- Hvordan håndterte dere ustabile tester?
- Hvordan vet dere at testene ville fanget en feil? (Svar med øvelse 2.)

### Forslag til egen MR

- En ny test for et hull du fant i øvelse 2 eller sjekklista.
- Kjør `npm run test:e2e` på GitLab-pipelinen etter flyttingen, og lenk til en grønn pipeline i
  ki-deklarasjonen.
