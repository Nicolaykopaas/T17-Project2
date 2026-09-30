# Blokkeringer som krever Nicolay

Punkter her kan ikke løses av agentene alene. Hvert punkt sier hva som trengs.

- **IMDb-datasettet kunne ikke lastes ned i utviklingsmiljøet.** Sky-containeren agentene kjørte i har
  en nettverkspolicy som blokkerer `datasets.imdbws.com` (HTTP 403 fra proxyen). Importskriptet er
  skrevet for de ekte filene og testet mot et syntetisk datasett i samme format
  (`npm run db:fixture -w backend`). Last ned de ekte filene selv og kjør importen, se `docs/oppsett.md`.
