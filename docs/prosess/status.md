# Status

Oppdatert 2026-10-13.

## Hva er gjort

Alle punktene i `plan.md` (M0–M7) er gjort og verifisert i utviklingsmiljøet. Integrasjonsgrenen
`claude/adoring-brown-3nct5k` er merget til `main` via PR #31. Appen kjører på
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
- **Etter 2026-10-06 (PR #31):** `npm run setup` og `npm run dev` gir oppsett og oppstart med én
  kommando (falsk TMDB og Archive når nøkkel mangler), `npm run screenshots` lager bilder til
  dokumentasjonen, Archive-importen er begrenset av `ARCHIVE_LIMIT` (standard 500) og lagrer treff
  per side, `npm run db:measure -w backend` måler søkespørringer med `EXPLAIN ANALYZE`, og
  `robots.txt` serveres fra domenerot. Prosess- og KI-dokumenter er flyttet til `docs/prosess/` og
  `docs/ki/`, README er gjort kort, og detaljer ligger i `docs/`.
- **Tester** (verifisert 2026-10-13, CI-modus, etter fasett-cachen):
  - lint og typecheck: grønne
  - backend: 502 tester i 24 filer (Vitest mot testdatabase)
  - frontend: 288 komponenttester i 27 filer (Vitest + Testing Library)
  - E2E: 101 bestått, 15 hoppet over, 0 ustabile (Playwright). De hoppede er 12 skjermbildetester
    som må slås på eksplisitt, og 3 statiske CSP-sjekker som bare kjøres på desktop.
- **Ytelse:** Lighthouse og `EXPLAIN` i `docs/ytelse.md` (målt før M7, på syntetiske data).
- **Deploy:** `deploy/setup-vm.sh`, `deploy/oppdater.sh`, systemd-enhet og Apache-konfig, beskrevet
  i `docs/deploy.md`.

## Hva gjenstår for gruppa

Se «M8 – Klargjøring for sluttinnlevering» i `plan.md`. Punktene gruppa må gjøre selv:

- G1: flytte repoet til git.ntnu.no og få CI grønn der.
- G2: kjøre `deploy/oppdater.sh` og `deploy/mal-ytelse.sh` på VM-en, og lime tabellen inn i `docs/ytelse.md`.
- G3: kjøre Lighthouse mot VM-adressen fra egen maskin på VPN og lime inn resultatet.
- G4: hvert medlem gjør review av sin del og leverer minst én egen commit/MR.
- G5: fylle ut «Gruppens egen gjennomgang» i `docs/ki/ki-deklarasjon.md`.
- G6: skrive README.md med egne ord.
- G7: levere bidragsfil i Canvas.
- G8: avgjøre commit-forfatter «Claude».

Migrering 004 gir et låsvindu på ca. 10–20 s på VM-en (se `docs/deploy.md`).

README.md er en kort oversikt skrevet av leder-agenten på forespørsel fra Nicolay (se
`docs/ki/ki-deklarasjon.md`); gruppa skriver sin egen (G6). Installasjonssteg ligger i `docs/oppsett.md` og `docs/deploy.md`.

## Kjente begrensninger

- Ingen innlogging: anonym bruker-ID ligger i `localStorage`, så anmeldelser og liste følger
  nettleseren, ikke en person.
- Søk på 1–2 tegn er ordprefiks («ma» finner «The Matrix», men «ar» finner ikke «Dark») og
  rangeres etter popularitet. Fra 3 tegn er det delstrengsøk med likhetsrangering.
- Aksentfolding følger Postgres' `unaccent`: «ø» blir «o» og «å» blir «a», så «bla» finner også «Blå».
- Svært vanlige søk («the») tar ca. 140 ms fordi alle treff må telles (`totalCount`).
- Ytelsestallene i `docs/ytelse.md` er målt på syntetiske data (120 000 titler), ikke på det ekte datasettet.
- Rate limit for mutations ligger i prosessminnet og nullstilles ved restart (greit for én
  systemd-tjeneste).
- VM-en kjører http, ikke https: Lighthouse Best Practices blir lavere, og brotli og HTTP/2 mangler.
- Appen er klient-rendret (ingen SSR): mobil Performance stopper på 95–97.
