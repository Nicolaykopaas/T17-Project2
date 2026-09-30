# Beslutninger

Valg agentene har tatt uten å spørre, med begrunnelse. Nyeste nederst.

- **TypeScript 6.0 i stedet for 7.** `typescript-eslint` støtter bare `typescript <6.1`. Vi valgte
  lint-støtte framfor nyeste kompilator.
- **ESLint 9 i stedet for 10.** `eslint-plugin-jsx-a11y` støtter ikke ESLint 10 ennå, og
  tilgjengelighetslinting er et krav.
- **Git-grener.** CLAUDE.md sier at arbeidet skal skje på grener fra `mvp`. Sky-sesjonen kan bare
  pushe til én gren (`claude/webutvikling-projekt-2-k5lq6q`), så den grenen spiller rollen til
  `mvp`. Hver oppgave lages på en lokal `feat/…`-gren og merges inn med `--no-ff`, slik at historikken
  viser grenene. Ingenting pushes til `main`.
- **Ingen GitLab-issues/MR-er.** `glab` er ikke tilgjengelig i miljøet, så issue- og review-flyten
  loggføres i `docs/ki-logg.md` i stedet, slik CLAUDE.md beskriver.
- **Syntetisk testdatasett.** IMDb-nedlasting er blokkert i miljøet (se `BLOCKERS.md`). Et skript
  genererer filer i nøyaktig samme TSV-format, så importkoden er den samme for ekte og syntetiske
  data.
