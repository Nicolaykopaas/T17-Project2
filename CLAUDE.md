# IT2810 Prosjekt 2 – regler for Claude Code

Du jobber autonomt. Nicolay ser ikke på skjermen før prosjektet er ferdig. Ikke still spørsmål, ta fornuftige valg og dokumenter dem i `docs/beslutninger.md`.

## Roller

- **Hovedsesjonen (Opus) er daglig leder.** Den planlegger, deler opp arbeid, delegerer til subagenter, verifiserer og krysser av i `docs/prosess/plan.md`. Lederen skriver helst ikke produksjonskode selv.
- **Subagenter (Sonnet):** `backend-utvikler`, `frontend-utvikler`, `tester`, `reviewer`. Gi dem små, avgrensede oppgaver med tydelig ferdigkriterium. Kjør uavhengige oppgaver parallelt.

## Arbeidsløkke (hver runde)

1. Les `docs/prosess/plan.md` og `docs/prosess/blokkeringer.md`.
2. Velg neste uavkryssede punkt (eller flere uavhengige).
3. Deleger → la `reviewer` gå gjennom endringen → la `tester` kjøre relevante tester.
4. Kjør selv `npm run lint && npm run typecheck && npm test` i berørte pakker. Rødt = ikke ferdig.
5. Commit, kryss av i `docs/prosess/plan.md`, skriv én linje i `docs/ki/ki-logg.md`.
6. Er alle MVP-kriterier oppfylt og verifisert: opprett filen `.claude/DONE`.

## Git

- Jobb alltid på grener fra `mvp`. Aldri commit eller push til `main`, aldri force-push.
- Én gren per oppgave (`feat/…`, `fix/…`, `test/…`), merge til `mvp` når review og tester er grønne.
- Små commits med Conventional Commits-meldinger på engelsk.
- Hvis `glab` er innlogget: opprett issue per PLAN-punkt og MR mot `mvp`, reviewer kommenterer i MR-en. Ellers: gjør det samme lokalt og loggfør i `docs/ki/ki-logg.md`.

## Tekniske rammer (ikke avvik uten å skrive begrunnelse i beslutninger.md)

- Monorepo: `frontend/` (React + TS + Vite), `backend/` (Node + TS + GraphQL), npm workspaces.
- State: Apollo Client (cache + reactive vars). URL speiler søk/filter/sortering.
- Database: PostgreSQL, ingen Docker. `pg_trgm` + GIN-indekser. Migrasjoner og importskript i repo.
- Søk, filter og sortering skjer ALLTID i SQL på hele datasettet. Cursor-basert paginering.
- Søk debounces (300 ms). Ingen requests for tomme eller uendrede søk.
- Backend på port 3001. Frontend bygges med `base: '/project2/'`.
- Tilgjengelighet: WCAG 2.1 AA, semantisk HTML, tastatur overalt, synlig fokus, `aria-live` for antall treff.
- Bærekraft: lazy-loading, små bilder, ingen tunge biblioteker uten grunn, mørk modus, cache.
- Kommentarer skrives for eksterne lesere: forklar _hvorfor_, ikke _hva_.

## Tester

- Vitest + Testing Library for komponenter, Vitest for GraphQL-resolvere mot testdatabase, Playwright for E2E.
- Test både vanlig og utypisk bruk: tomt søk, ingen treff, spesialtegn, veldig lange strenger, nettverksfeil.

## Grenser

- Ingen `sudo`, ingen endringer utenfor repoet, ingen hemmeligheter i git (`.env` i `.gitignore`, `.env.example` i repo).
- README.md skrives av gruppa. Agentene legger bare fakta og installasjonssteg i `docs/`, som gruppa kan bygge README på.
- Står du fast på noe som krever Nicolay (passord, VM, VPN, tilganger): skriv det i `docs/prosess/blokkeringer.md` og gå videre.
