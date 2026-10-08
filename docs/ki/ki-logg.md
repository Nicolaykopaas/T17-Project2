# KI-logg

Én linje per fullført oppgave: dato – hva – hvem (agent) – verifisering.

- 2026-09-30 – M0 oppsett: monorepo, TS strict, ESLint/Prettier, Husky + lint-staged, GitLab CI – leder – lint, typecheck, test og build grønne.
- 2026-09-30 – M1 database, migreringer, strømmende import og syntetisk datasett – backend-utvikler – 184 backend-tester grønne, EXPLAIN før/etter i ytelse.md.
- 2026-09-30 – M2 GraphQL-API (search, title, facets, myList, addReview, toggleList, validering, dybdegrense) – backend-utvikler – API-tester grønne, leder gikk gjennom SQL-parameterisering.
- 2026-09-30 – M3 frontend og komponenttester – frontend-utvikler – 74 tester grønne, leder testet mot ekte backend i nettleser.
- 2026-09-30 – Relevanssortering vektet med popularitet (klassikere øverst) – leder – test oppdatert, 184 grønne.
- 2026-09-30 – Layoutskift fikset, Lighthouse ≥ 94 overalt – frontend-utvikler – leder målte på nytt.
- 2026-09-30 – M4 Playwright E2E + axe + 320 px + scroll-bevaring – leder – 32 E2E-tester grønne.
- 2026-09-30 – M4 ren klon (`npm ci`): lint, typecheck, test og build grønne – leder.
- 2026-09-30 – M5 deploy-skript, systemd og Apache – leder – ikke kjørt mot VM (krever Nicolay).
- 2026-09-30 – Fiks: appen feilet på VM-en (http) fordi crypto.randomUUID mangler utenfor sikre kontekster – leder – regresjonstest + verifisert i nettleser over http.
- 2026-09-30 – TMDB-plakater (backend) og kinoaktig UI (frontend) – backend-utvikler + frontend-utvikler – 209 backend-, 111 komponent- og 48 E2E-tester grønne mot ekte backend og falsk TMDB.
- 2026-09-30 – README.md med funksjonalitet, arkitektur, testing, a11y, bærekraft, KI-bruk og VM-lenke – leder – på forespørsel fra Nicolay.
- 2026-09-30 – M6 lovlig strømming fra Internet Archive: import, filter, «Se gratis nå», videospiller – backend-utvikler + frontend-utvikler – 259 backend-, 167 komponent- og 69 E2E-tester grønne (én E2E-test var ustabil én gang og besto ved omkjøring, reproduserte ikke i to nye kjøringer).
- 2026-10-06 – #13 Tydelig feiltilstand når API-et ikke nås: global banner, error link, `/health`, deploy-oppdateringer – frontend-utvikler – 272 backend-, 186 komponent- og 76 av 77 E2E-tester grønne (den ene var den ustabile watch.spec.ts:40, årsaken er funnet og rettet i #14).
- 2026-10-06 – #14 Filteretikett «Kun filmer som kan strømmes gratis», kategorinavigasjon og rotårsak til ustabil checkbox (flushSync), PR #18 – frontend-utvikler, review av kritiker-agent – watch.spec ustabil ikke lenger, E2E grønn i CI-modus.
- 2026-10-06 – #15 Backend-herding: memoisert kostnads- og dybdegrense, rate limit, deleteReview, unaccent (genererte kolonner), tsvector-ordprefiks for 1–2 tegn, PR #20 – backend-utvikler, review av kritiker-agent – 414–415 backend-tester grønne, målinger i ytelse.md.
- 2026-10-06 – #16 Frontend-gjennomgang: Hero inMyList, listeknapp uten aria-pressed, «Last flere»-feil, kodepunkt-telling, Stars-opplesning, fokus til h1, ROW_QUERY uten totalCount, tema-bryter, slett egen anmeldelse, RATE_LIMITED, PR #21 – frontend-utvikler, review av kritiker-agent – 236 komponenttester grønne.
- 2026-10-06 – #17 CI med build og E2E (failOnFlakyTests) og CSP fra Apache verifisert i E2E, PR #22 – tester, review av kritiker-agent – E2E 97 bestått, 3 hoppet over, 0 ustabile (ren database, CI-modus).
- 2026-10-06 – #23 Kommentarer for eksterne lesere og konsistensgjennomgang av docs (status, oppsett, PLAN, beslutninger), PR #24 m.fl. – leder og subagent, review av kritiker-agent – lint og formatsjekk grønne; bundle målt på nytt.
