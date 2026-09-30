# Status

Oppdatert 2026-09-30.

## Hva er gjort

Alle punktene i `PLAN.md` er gjort og verifisert i utviklingsmiljøet.

- **Backend:** PostgreSQL-skjema med migreringer, importskript som strømmer IMDb-filene og tåler å
  kjøres på nytt, og GraphQL-API med søk, filtre, fasetter, sortering, cursor-paginering,
  anmeldelser og «min liste». All søk, filtrering og sortering skjer i SQL.
- **Frontend:** React + Apollo Client med søk (300 ms debounce), filterpanel med antall treff,
  aktive filtre som chips, sortering, uendelig scroll + «Last flere», detaljside med
  anmeldelsesskjema, «Min liste», state i URL, mørk modus og responsivt ned til 320 px.
- **Tester:**
  - 184 backend-tester (Vitest mot testdatabase)
  - 74 komponenttester (Vitest + Testing Library)
  - 32 E2E-tester (Playwright på desktop og mobil), blant annet hele hovedflyten, axe uten
    brudd på alle sider i lys og mørk modus, og ingen horisontal scroll ved 320 px
- **Ytelse:** Lighthouse ≥ 94 i Performance og 100 i de andre kategoriene på alle sider (se
  `docs/ytelse.md`).
- **Deploy:** `deploy/setup-vm.sh`, systemd-enhet og Apache-konfig for `it2810-17.idi.ntnu.no`,
  beskrevet i `docs/deploy.md`.

## Hva gjenstår / hva Nicolay må gjøre

1. **Deploy på VM-en:** logg inn og kjør `bash deploy/setup-vm.sh`. Skriptet laster ned de ekte
   IMDb-filene, noe utviklingsmiljøet ikke fikk lov til (se `BLOCKERS.md`).
2. **Sjekk med ekte data:** søk, filtre og ytelse er målt på et syntetisk datasett på 120 000
   titler. Det ekte datasettet får omtrent like mange titler etter filteret (≥ 100 stemmer), men
   tallene i `docs/ytelse.md` bør måles på nytt på VM-en.
3. **GitLab:** repoet ligger på GitHub. Skal det inn på NTNU GitLab, pusher du det dit, og
   `.gitlab-ci.yml` kjører lint, typecheck og enhetstester. Issues og MR-er er ikke opprettet
   (se `docs/beslutninger.md`).
4. **README.md** skrives av gruppa, jf. CLAUDE.md. Fakta og installasjonssteg ligger i
   `docs/oppsett.md` og `docs/deploy.md`.

## Kjente begrensninger

- Søk folder ikke aksenter: «cafe» finner ikke «Café». Store og små bokstaver er dekket.
- Søk på 1–2 tegn kan ikke bruke trigram-indeksen og er tregere (se `docs/ytelse.md`).
- Anonym bruker-ID ligger i `localStorage`. Anmeldelser og liste følger nettleseren, ikke en
  innlogget bruker.
