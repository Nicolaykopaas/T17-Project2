# Filmsøk – IT2810 prosjekt 2, gruppe 17

Søk, filtrer og anmeld over 190 000 filmer og serier fra IMDb, med plakater fra TMDB.

**🔗 Kjørende versjon:** <http://it2810-17.idi.ntnu.no/project2/> (NTNU-nett eller VPN)

## Arbeidsfordeling

| Navn    | Rolle                                                                |
| ------- | -------------------------------------------------------------------- |
| Nicolay | Prosjektleder. Arkitektur, GraphQL-API og React, frontend og backend |
| Strula  | Backendansvarlig: database, import og resolvere                      |
| Brage   | Frontendansvarlig: komponenter, design og tilgjengelighet            |
| Daniel  | Testansvarlig: enhets-, komponent- og E2E-tester                     |

## Funksjonalitet

- Søk på tittel med 300 ms debounce, uten skille på store og små bokstaver
- Filter på sjanger, tiår, type og rating, med antall treff per valg
- Sortering på relevans, rating, år og tittel, alltid på serveren
- Uendelig scroll med «Last flere»-knapp
- Detaljside, anmeldelser (1–5 stjerner) og «Min liste»
- Søk og filtre i URL-en, mørk og lys modus, responsivt ned til 320 px

## Teknologi

**Frontend:** React, TypeScript, Vite, Apollo Client · **Backend:** Node.js, GraphQL (Yoga) ·
**Database:** PostgreSQL med `pg_trgm` · **Test:** Vitest, Testing Library, Playwright, axe

All søk, filtrering og sortering skjer i SQL med cursor-paginering. API-et er beskrevet i
[`docs/api.md`](docs/api.md).

## Pipeline

```
feature-gren ─▶ pre-commit ─▶ pull request ─▶ CI ─▶ main ─▶ deploy til VM
```

1. **Pre-commit (Husky + lint-staged):** ESLint og Prettier på endrede filer.
2. **CI (`.gitlab-ci.yml`):** lint, typecheck og enhetstester mot PostgreSQL.
3. **Review og merge** til `main`.
4. **Deploy med én kommando:**
   ```bash
   ssh -t <brukernavn>@it2810-17.idi.ntnu.no bash T17-Project2/deploy/oppdater.sh
   ```
   Kommandoen henter siste kode, bygger, migrerer databasen, importerer data, henter plakater og
   starter backend (systemd) og Apache på nytt. Den stopper med feilmelding hvis API-et ikke svarer.

## Kjøre lokalt

```bash
npm ci
cp .env.example .env
npm run db:migrate && npm run db:seed    # krever IMDb-filene i data/ (se docs/oppsett.md)
npm run dev                               # http://localhost:5173/project2/
```

## Testing

| Type                | Antall | Kommando           |
| ------------------- | -----: | ------------------ |
| Backend (API og DB) |    209 | `npm test`         |
| Komponenter         |    111 | `npm test`         |
| E2E + axe           |     48 | `npm run test:e2e` |

E2E-testene dekker hele flyten fra søk til anmeldelse, på desktop og mobil, i lys og mørk
modus.

## Dokumentasjon

[Oppsett](docs/oppsett.md) · [Deploy](docs/deploy.md) · [API](docs/api.md) ·
[Beslutninger](docs/beslutninger.md) · [Ytelse](docs/ytelse.md) · [KI-logg](docs/ki-logg.md)

Prosjektet er utviklet med Claude Code som KI-assistent. Bruken er logget i
[`docs/ki-logg.md`](docs/ki-logg.md).

_Bilder og beskrivelser fra TMDB. Produktet bruker TMDB-API-et, men er ikke godkjent eller
sertifisert av TMDB._
