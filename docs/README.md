# Dokumentasjon

Indeks over alt som ligger i `docs/`. Start med [`forklaring.md`](forklaring.md) hvis du vil forstå
hvordan appen virker, eller [`oppsett.md`](oppsett.md) hvis du vil kjøre den.

## Bruk og drift

- [`oppsett.md`](oppsett.md): kjør prosjektet lokalt, fra rask start til ekte IMDb-data, plakater og gratisfilmer.
- [`deploy.md`](deploy.md): oppsett og oppdatering på VM-en (PostgreSQL, systemd, Apache, CSP, CI).

## Teknisk

- [`forklaring.md`](forklaring.md): gjennomgang av hvordan appen virker, fra tastetrykk til database, med sannsynlige sensorspørsmål.
- [`api.md`](api.md): GraphQL-kontrakten (typer, spørringer, mutations, feilkoder og grenser).
- [`beslutninger.md`](beslutninger.md): tekniske valg med begrunnelse, komponentoversikt, biblioteker og hvorfor vi ikke bruker SSR.
- [`ytelse.md`](ytelse.md): målinger av søk og indekser (`EXPLAIN ANALYZE`) og Lighthouse.
- [`readme-fakta.md`](readme-fakta.md): faktagrunnlag for README (krav mot filer, tall, hovedvalg, installasjon). README skrives av gruppa.

## Prosess og KI

- [`prosess/plan.md`](prosess/plan.md): milepælene (M0–M8) agentene jobbet mot.
- [`prosess/status.md`](prosess/status.md): hva som er gjort, hva som gjenstår og hva gruppa må gjøre.
- [`prosess/blokkeringer.md`](prosess/blokkeringer.md): ting agentene ikke kunne løse alene.
- [`prosess/review-guide.md`](prosess/review-guide.md): hva Sturla, Brage og Daniel skal gå gjennom av koden, med øvelser, sjekklister og sensorspørsmål.
- [`prosess/grener-og-pr.md`](prosess/grener-og-pr.md): grenmodell og tabell over issues og pull requests.
- [`prosess/gitlab.md`](prosess/gitlab.md): flytting fra GitHub til NTNU GitLab, CI, VM-en, og hvilke GitHub-issues og PR-er som hører til hvilke merge-commits.
- [`ki/ki-deklarasjon.md`](ki/ki-deklarasjon.md): hvordan KI er brukt, hva mennesker bestemte og kontrollerte, og hvilke feil KI-en gjorde.
- [`ki/ki-logg.md`](ki/ki-logg.md): én linje per oppgave utført av agentene.

Bilder til README ligger i `img/`.
