## Oppsummering

<!-- Hva endres, og hvorfor? To–tre setninger holder. -->

## Issue

Closes #

<!-- «Closes #12» lukker issuet automatisk når MR-en merges til standardgrenen. -->

## Slik er det testet

<!-- Hvilke tester er lagt til eller endret? Hva er prøvd for hånd (nettleser, skjermleser, mobil)? -->

-

## Sjekkliste

- [ ] `npm run lint` er grønn
- [ ] `npm run typecheck` er grønn
- [ ] `npm test` er grønn (backend mot PostgreSQL og komponenttester)
- [ ] `npm run test:e2e` er grønn, eller endringen berører ikke brukerflyter
- [ ] Tilgjengelighet: tastatur, synlig fokus og skjermlesertekst er sjekket for nye eller endrede elementer
- [ ] Utypisk bruk er testet der det er relevant: tomt søk, ingen treff, spesialtegn, lange strenger, nettverksfeil
- [ ] Dokumentasjon i `docs/` er oppdatert hvis oppførsel eller oppsett er endret
- [ ] Ingen hemmeligheter (`.env`, nøkler) i diffen

## Review

Reviewer: @

<!-- Reviewer kommenterer i MR-en og merker funn som blokkerende, bør fikses eller valgfritt.
Funn rettes med nye commits, ikke force-push. -->
