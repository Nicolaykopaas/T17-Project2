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
- 2026-10-06 – #13 Tydelig feiltilstand når API-et ikke nås: global banner, error link, `/health`, deploy-oppdateringer – frontend-utvikler – 272 backend-, 186 komponent- og 76 av 77 E2E-tester grønne (den ene er den kjente ustabile watch.spec.ts:40, som også feiler på base).
