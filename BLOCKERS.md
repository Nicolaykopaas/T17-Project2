# Blokkeringer som krever Nicolay

Ingen åpne blokkeringer for agentene.

Punkter her kan ikke løses av agentene alene. Hvert punkt sier hva som trengs.

- ~~**IMDb-datasettet kunne ikke lastes ned i utviklingsmiljøet.**~~ Løst: importert på VM-en av Nicolay 2026-09-30. Sky-containeren agentene kjørte i har
  en nettverkspolicy som blokkerer `datasets.imdbws.com` (HTTP 403 fra proxyen). Importskriptet er
  skrevet for de ekte filene og testet mot et syntetisk datasett i samme format
  (`npm run db:fixture -w backend`). Last ned de ekte filene selv og kjør importen, se `docs/oppsett.md`.
- **Avgjørelse for Nicolay: forfatter på noen commits.** Noen commits fra 2026-10-06 har forfatter «Claude <noreply@anthropic.com>» fordi sky-miljøets globale git-identitet var satt slik. Rettet for senere commits. Å skrive om publisert historikk krever force-push, og det er forbudt for agentene; det er opp til Nicolay om det er verdt det.
