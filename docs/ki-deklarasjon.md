# KI-deklarasjon

Denne fila beskriver hvordan gruppa har brukt kunstig intelligens (KI) i prosjekt 2, hva KI-en
har laget, hva mennesker har bestemt og kontrollert, og hvilke feil og begrensninger vi har sett.
Den utfyller [`ki-logg.md`](ki-logg.md) (én linje per oppgave) og
[`beslutninger.md`](beslutninger.md) (alle tekniske valg med begrunnelse).

## Kort oppsummert

- Prosjektet er utviklet med **Claude Code** (Anthropic) som KI-assistent i hele løpet: plan,
  kode, tester, dokumentasjon og kodegjennomgang.
- **Det meste av koden er skrevet av KI-agenter.** Mennesker har bestemt mål, datasett, rammer og
  prioriteringer, godkjent planer før arbeid startet, satt opp og driftet VM-en, og vurdert
  tilbakemeldinger fra medstudenter.
- **Ingen KI-kode er tatt inn uten kontroll.** Hver endring har gått gjennom automatiske tester
  (lint, typecheck, komponent-, API- og E2E-tester med axe) og en egen KI-kodegjennomgang før
  merge. Fra oktober skjer dette synlig i issues og pull requests med review-kommentarer.
- Vi har ikke latt KI-en skjule feil: kjente feil, avvik og begrensninger står i
  [Feil KI-en gjorde](#feil-ki-en-gjorde-og-hvordan-de-ble-oppdaget) og
  [Begrensninger](#begrensninger-og-ting-vi-ikke-har-kunnet-verifisere).

## Verktøy

| Verktøy                       | Brukt til                                                                                                                            |
| ----------------------------- | ------------------------------------------------------------------------------------------------------------------------------------ |
| Claude Code (CLI og sky-økt)  | All KI-assistert utvikling: planlegging, kode, tester, dokumentasjon, kodegjennomgang                                                |
| Claude-modeller fra Anthropic | En kraftigere modell som «leder» og kritiker, en raskere modell for avgrensede utvikleroppgaver                                      |
| GitHub (issues, PR, review)   | Sporbar plan og kodegjennomgang fra oktober. Repoet flyttes til NTNU GitLab ved innlevering                                          |
| Ingen andre KI-verktøy        | Vi har ikke brukt KI til bilder, tekst i appen fra eksterne kilder eller generering av testdata ut over skriptet i `backend/scripts` |

Agentenes roller og instrukser ligger i repoet, så de kan inspiseres:

- [`CLAUDE.md`](../CLAUDE.md): regler for alle agenter (tekniske rammer, krav til testing,
  tilgjengelighet, bærekraft, git-flyt og hva som krever et menneske).
- [`.claude/agents/`](../.claude/agents/): rollebeskrivelser for `backend-utvikler`,
  `frontend-utvikler`, `tester` og `reviewer`.
- [`PLAN.md`](../PLAN.md): milepælene (M0–M6) som agentene jobbet mot, krysset av når verifisert.

## Arbeidsflyt

```
Menneske: mål, rammer, godkjenning av plan
        │
        ▼
Leder-agent ──▶ issue per oppgave ──▶ utvikler-agent i egen git-worktree (egen gren)
        ▲                                     │
        │                                     ▼
        │                          tester lokalt (lint, typecheck, Vitest, Playwright + axe)
        │                                     │
        │                                     ▼
        │                          pull request ──▶ kritiker-agent: review på PR-en
        │                                     │            │
        │                                     │◀── funn ───┘ (rettes med nye commits)
        │                                     ▼
        └──────────────────── leder verifiserer, merger, lukker issue, oppdaterer logg
```

1. **Mennesket setter retningen.** Nicolay skrev `CLAUDE.md` med rammene (monorepo, PostgreSQL uten
   Docker, søk/filter/sortering alltid i SQL, cursor-paginering, debounce 300 ms, WCAG 2.1 AA,
   bærekraft, testkrav) og valgte datasett og mål. Planer fra KI-en ble lagt fram og **godkjent
   eller avvist** før arbeid startet. Planen for ferdigstilling i oktober ble for eksempel
   underkjent i første runde og justert to ganger før godkjenning.
2. **Leder-agenten deler opp arbeidet.** Den skriver ikke produksjonskode selv, men lager issues
   med tydelige ferdigkriterier og delegerer til utvikler-agenter.
3. **Utvikler-agenter jobber isolert.** Hver oppgave kjøres i en egen git-worktree og gren, slik at
   parallelle oppgaver ikke ødelegger for hverandre.
4. **Kritiker-agenten gjennomgår hver PR** og poster funn som review-kommentarer, rangert som
   blokkerende, bør fikses eller valgfritt. Funn rettes med nye commits (ingen omskriving av
   historikk), og kritikeren gjør en ny runde ved større endringer.
5. **Merge først når alt er grønt.** Leder kjører testene selv, svarer på review-trådene, merger og
   lukker issue.
6. **Målløkke.** Til slutt vurderte kritikeren hele appen opp mot vurderingskriteriene i
   oppgaveteksten, og funnene ble nye issues (#15–#17) som gikk gjennom samme løkke.

## Hva KI-en har laget

- **Backend:** skjema og migreringer, strømmende IMDb-import, GraphQL-API (søk, fasetter,
  cursor-paginering, anmeldelser, «min liste», slett egen anmeldelse), validering, feilmasking,
  dybde- og kostnadsgrense, rate limiting, `/health`, TMDB- og Internet Archive-integrasjon.
- **Frontend:** alle sider og komponenter, Apollo-oppsett og cache-policyer, URL-styrt
  søketilstand, videospiller, kategorinavigasjon, feilbanner, tema-bryter.
- **Tester:** API-tester mot ekte PostgreSQL, komponenttester, Playwright E2E med axe på desktop og
  mobil, i lys og mørk modus og ved 320 px.
- **Drift og dokumentasjon:** deploy-skript, systemd-enhet, Apache-konfig, CI-oppsett og
  dokumentene i `docs/`, inkludert README og denne fila.

## Hva mennesker har gjort og bestemt

- **Valg av domene og datasett:** film og serier fra IMDb sine åpne datasett, med plakater fra TMDB
  og lovlige gratisfilmer fra Internet Archive.
- **Rammer og kvalitetskrav** i `CLAUDE.md`, og godkjenning eller avvisning av planer.
- **Drift av VM-en:** installasjon av PostgreSQL, import av det ekte datasettet (190 607 titler),
  kjøring av deploy-skriptet og feilsøking på `it2810-17.idi.ntnu.no`. KI-en har ikke hatt tilgang
  til VM-en eller NTNU-nettet.
- **Vurdering av medstudenttilbakemeldinger.** Nicolay fant at feilen medstudenten så («Kunne ikke
  hente denne raden») skyldtes at testeren ikke var på NTNU-nettet, ikke en feil på VM-en. Det ga
  oppgaven om ett forklarende banner i stedet for mock-data (#13).
- **Prioritering:** hvilke tilbakemeldinger som skulle tas (etikett, kategorinavigasjon,
  feiltilstand) og i hvilken rekkefølge.
- **Prosesskrav til KI-en:** ingen KI-signaturer i commits og PR-er, og at historikk ikke skrives
  om.

Den enkeltes bidrag i gruppa dokumenteres i egen fil i Canvas, ikke her, jf. oppgaveteksten.

## Hvordan vi kontrollerte KI-ens arbeid

- **Automatiske tester er porten.** Ingen endring er merget uten grønn lint, typecheck,
  komponenttester, API-tester mot PostgreSQL og E2E med axe. Tallene står i README og
  `ki-logg.md`.
- **Uavhengig kodegjennomgang.** En egen kritiker-agent, med en kraftigere modell enn
  utvikler-agentene, leste hver diff med eksplisitte sjekkpunkter: SQL-sikkerhet, ytelse,
  tilgjengelighet, testkvalitet og kommentarkvalitet. Reviewene ligger på PR-ene.
- **Rotårsak, ikke omkjøring.** En ustabil test skal forklares, ikke kjøres på nytt til den blir
  grønn. Testen i `watch.spec.ts` viste seg å avsløre en ekte feil (se under).
- **Målinger i stedet for påstander.** Ytelsespåstander er dokumentert med `EXPLAIN ANALYZE` i
  [`ytelse.md`](ytelse.md), med åpen merknad om at tallene er fra et syntetisk datasett.

## Feil KI-en gjorde, og hvordan de ble oppdaget

Utvalg av feil fra KI-generert kode som ble fanget av tester eller review før de nådde brukerne:

| Feil                                                                                                                     | Oppdaget av                         | Rettet i |
| ------------------------------------------------------------------------------------------------------------------------ | ----------------------------------- | -------- |
| Appen krasjet over http på VM-en fordi `crypto.randomUUID` bare finnes i sikre kontekster                                | Nicolay ved deploy                  | M5       |
| Avkrysningsboksene for filter «hoppet tilbake» i ca. 20 ms etter klikk (React-transition). Testen var ustabil i lang tid | Rotårsaksanalyse av ustabil E2E     | #18      |
| `Requires=postgresql.service` i systemd ville latt backend stå stoppet etter en omstart av databasen                     | Kritiker-review                     | #19      |
| Database nede ga fortsatt én feilmelding per rad, fordi backenden svarte HTTP 200 med maskert feil                       | Kritiker-review                     | #19      |
| Et 636 byte stort GraphQL-dokument med nøstede fragmenter brukte ca. 60 s CPU (også i den eldre dybdegrensen)            | Kritiker-review                     | #20      |
| Fullbreddetegn (`％`, `＿`) ble til jokertegn etter aksentfolding, så søk kunne treffe hele tabellen                     | Kritiker-review                     | #20      |
| Korte søk matchet bare starten av tittelen («ma» fant ikke «The Matrix»)                                                 | Kritiker-review                     | #20      |
| Hero-knappen viste alltid «Legg i min liste», også for titler som allerede var i lista                                   | Kritiker-gjennomgang mot kriteriene | #16      |
| Hopp til en tom rad i kategorinavigasjonen mistet tastaturfokus                                                          | Kritiker-review                     | #18      |

## Avvik i selve KI-prosessen

Vi tar med disse fordi de viser hvor KI-arbeid må passes på:

- **Commit-forfatter.** I sky-miljøet var git-identiteten forhåndsinnstilt til «Claude». Noen få
  commits fra 6. oktober har derfor feil forfatter. Det ble oppdaget av leder-agenten, identiteten
  ble rettet for alle senere commits, og omskriving av allerede pushet historikk ble stoppet av
  miljøets sikkerhetsregler. Det er lagt fram for Nicolay som avgjør.
- **Delte porter mellom parallelle agenter.** E2E-testene bruker faste porter. Da flere agenter
  kjørte testene samtidig, gjenbrukte Playwright en annen agents server og ga falske feil. Løst
  med en felles lås for testkjøring. Feilene var ikke kodefeil, men viser at «grønt hos agenten»
  må verifiseres på nytt etter merge.
- **Instrukser som ikke ble fulgt fullt ut.** En kritiker-agent byttet gren i hovedkatalogen under
  review (rettet straks, ingen filer endret). Leder skjerpet instruksen for neste runde.

## Begrensninger og ting vi ikke har kunnet verifisere

- **Ytelse er målt på syntetiske data** (120 000 titler) i utviklingsmiljøet. VM-en har det ekte
  datasettet, men KI-en har ikke nettverkstilgang dit.
- **GitLab CI er skrevet, men ikke kjørt** av KI-en, fordi repoet ligger på GitHub fram til
  innlevering.
- **KI-ens egne vurderinger** av kontrast, opplesning og brukervennlighet er støttet av axe og
  tester, men erstatter ikke testing med faktiske skjermleserbrukere.

## Personvern, sikkerhet og opphav

- Ingen hemmeligheter i git (`.env` er ignorert, `.env.example` ligger i repoet). KI-agentene har
  ikke fått passord eller VPN-tilgang.
- Ingen personopplysninger er sendt til KI-en ut over navn på gruppemedlemmer i README.
- Data og media brukes i tråd med vilkårene: IMDb non-commercial datasets, TMDB med påkrevd
  attribusjon i footeren, og bare Internet Archive-filmer merket som public domain eller Creative
  Commons (lisens vises under spilleren).

## Refleksjon

- KI-en er rask til å lage mye kode som ser riktig ut. Verdien kom først når den ble kombinert med
  **strenge rammer** (`CLAUDE.md`), **små oppgaver med tydelige ferdigkriterier** og **en uavhengig
  gjennomgang** som leter etter feil. Flere av de alvorligste feilene over ville bestått alle
  testene utvikler-agenten selv skrev.
- Tilbakemeldingene fra medstudenter var verdifulle fordi de kom fra ekte bruk. KI-en kunne ikke
  selv ha oppdaget at testere utenfor NTNU-nettet fikk en uforståelig feilside.
- Prosess må være synlig for å kunne vurderes. Derfor er arbeidet fra oktober gjort gjennom issues,
  pull requests og reviewkommentarer i stedet for direkte commits.
