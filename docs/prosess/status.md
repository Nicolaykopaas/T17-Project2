# Status

Oppdatert 2026-10-06.

## Hva er gjort

Alle punktene i `plan.md` (M0–M7) er gjort og verifisert i utviklingsmiljøet. Appen kjører på
<http://it2810-17.idi.ntnu.no/project2/> med det ekte IMDb-datasettet (190 607 titler med ≥ 100
stemmer, deployet 2026-09-30).

- **Backend:** PostgreSQL-skjema med migreringer, importskript som strømmer IMDb-filene og tåler å
  kjøres på nytt, og GraphQL-API med søk, filtre, fasetter, sortering, cursor-paginering,
  anmeldelser (også sletting av egne) og «min liste». Søk, filtrering og sortering skjer i SQL.
- **Frontend:** React + Apollo Client med søk (300 ms debounce), filterpanel med antall treff,
  aktive filtre som chips, sortering, uendelig scroll + «Last flere», detaljside med
  anmeldelsesskjema, «Min liste», state i URL, tema-bryter (mørk/lys) og responsivt ned til 320 px.
- **Plakater og gratisfilmer:** plakater fra TMDB (lagret i egen tabell), og lovlige filmer fra
  Internet Archive med egen videospiller på `/watch/:id`.
- **M7 (oktober), etter medstudentvurdering:** banner og `/health` når API-et ikke nås (#13),
  filteretikett og kategorinavigasjon, og rettet ustabil checkbox (#14), backend-herding med
  kostnadsgrense, rate limit, aksentuavhengig søk og ordprefiks for korte søk (#15),
  frontend-gjennomgang med blant annet fokus til `h1` ved rutebytte, tema-bryter og
  sletting av egen anmeldelse (#16), CI med build og E2E samt CSP-sjekk (#17), og
  kommentarer og dokumentasjon (#23). Se `plan.md` for PR-nummer. Alle PR-er har review av en
  kritiker-agent og ble rettet før merge.
- **Tester** (siste verifiserte kjøring, ren E2E-database, CI-modus):
  - backend: 441 tester (Vitest mot testdatabase)
  - frontend: 288 komponenttester (Vitest + Testing Library)
  - E2E: 101 bestått, 3 hoppet over, 0 ustabile (Playwright, desktop og mobil). De tre hoppede
    er statiske CSP-sjekker som bare kjøres på desktop, og én mobil-skip.
- **Ytelse:** Lighthouse og `EXPLAIN` i `docs/ytelse.md` (målt før M7, på syntetiske data).
- **Deploy:** `deploy/setup-vm.sh`, `deploy/oppdater.sh`, systemd-enhet og Apache-konfig, beskrevet
  i `docs/deploy.md`.

## Hva gjenstår for gruppa

1. **Flytte repoet til git.ntnu.no** og kjøre CI der (`.gitlab-ci.yml`: lint, typecheck, enhetstester,
   build og E2E). Til nå ligger repoet og PR-ene på GitHub, og CI er ikke kjørt på GitLab.
2. **Merge integrasjonsgrenen `claude/adoring-brown-3nct5k` til `main`** og kjøre
   `deploy/oppdater.sh` på VM-en. Migrering 004 gir et låsvindu på ca. 10–20 s mens kolonner og
   indekser bygges (se `docs/deploy.md`).
3. **Måle Lighthouse og `EXPLAIN ANALYZE` på nytt med ekte data** (VM-adressen). Tallene i
   `docs/ytelse.md` er fra syntetiske data, og Lighthouse er målt før M7.
4. **Fylle ut «Gruppens egen gjennomgang»** i `docs/ki/ki-deklarasjon.md`.
5. **Bidragsfil i Canvas.**

README.md er skrevet av leder-agenten på forespørsel fra Nicolay i oktober (se
`docs/ki/ki-deklarasjon.md`). Installasjonssteg ligger i `docs/oppsett.md` og `docs/deploy.md`.

## Kjente begrensninger

- Ingen innlogging: anonym bruker-ID ligger i `localStorage`, så anmeldelser og liste følger
  nettleseren, ikke en person.
- Søk på 1–2 tegn er ordprefiks («ma» finner «The Matrix», men «ar» finner ikke «Dark») og
  rangeres etter popularitet. Fra 3 tegn er det delstrengsøk med likhetsrangering.
- Aksentfolding følger Postgres' `unaccent`: «ø» blir «o» og «å» blir «a», så «bla» finner også «Blå».
- Svært vanlige søk («the») tar ca. 140 ms fordi alle treff må telles (`totalCount`).
- Alle målinger er gjort på syntetiske data (120 000 titler), ikke på det ekte datasettet.
- Rate limit for mutations ligger i prosessminnet og nullstilles ved restart (greit for én
  systemd-tjeneste).
