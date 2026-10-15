# Grener, issues og pull requests

Ferdigstillingen etter medstudentvurderingen er gjort gjennom issues, pull requests og
kodegjennomgang.

| Issue | Innhold                                                    | Pull request |
| ----- | ---------------------------------------------------------- | ------------ |
| #13   | Forklarende banner når API-et ikke kan nås, `/health`      | #19          |
| #14   | Presis filteretikett, kategorinavigasjon, ustabil test     | #18          |
| #15   | API-grenser, slett anmeldelse, aksentuavhengig og kort søk | #20          |
| #16   | Feilrettinger, tilgjengelighet, tema-bryter, slett i UI    | #21          |
| #17   | CI (build og E2E), CSP, dokumentasjon                      | #22, #27     |
| #23   | Kommentarkvalitet og dokumentasjonskonsistens              | #24–#27      |

Hver PR har review-kommentarer med funn rangert som blokkerende, bør fikses og valgfritt. Funnene er
rettet med nye commits før merge.

PR #28 flyttet oktoberarbeidet (#18–#27) inn i `main`. Sluttgjennomgangen gikk som PR #29 og #30 mot
integrasjonsgrenen og PR #31 mot `main`. Full tabell med merge-commits: `docs/prosess/gitlab.md`.

## Grenmodell

```
feat/… · fix/… · chore/… ──PR + review──▶ integrasjonsgren ──PR──▶ main ──▶ VM (oppdater.sh)
```

1. **Oppgavegrener:** hver oppgave får egen gren. Pre-commit kjører ESLint og Prettier på endrede
   filer (Husky og lint-staged).
2. **Integrasjonsgren:** oppgavegrener merges hit via PR når review og alle tester er grønne. Fra
   oktober er det `claude/adoring-brown-3nct5k`, fordi sky-miljøet KI-agentene kjører i bare kan
   pushe til én forhåndsbestemt gren.
3. **`main`:** integrasjonsgrenen merges til `main` av et gruppemedlem. Det er `main` som deployes.

Historikken skrives aldri om (ingen force-push), og merge-commits viser grenene. Begrunnelsen står i
[`beslutninger.md`](../beslutninger.md) under «Git-grener».
