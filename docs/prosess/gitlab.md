# Flytte repoet fra GitHub til NTNU GitLab

Repoet ligger i dag på GitHub (`github.com/Nicolaykopaas/T17-Project2`). Innleveringen skal ligge på
NTNU GitLab (`git.ntnu.no`). Denne fila er en sjekkliste for gruppa. Agentene har ikke tilgang til
`git.ntnu.no` eller VM-en, så ingen av stegene under er prøvd av dem.

I kommandoene står `<GITLAB-URL>` for adressen til prosjektet gruppa har laget, for eksempel
`https://git.ntnu.no/<gruppe>/t17-project2.git` (HTTPS) eller `git@git.ntnu.no:<gruppe>/t17-project2.git` (SSH).

## 0. Før du starter

- Prosjektet på `git.ntnu.no` må være **tomt**: ikke huk av for «Initialize repository with a
  README» når det opprettes. Ellers avviser GitLab pushen av `main` (ulik historikk), og vi bruker
  aldri force-push.
- Du må være _Maintainer_ eller _Owner_ i prosjektet for å endre standardgren og beskyttede grener.
- Innlogging fra terminalen: en SSH-nøkkel lagt inn under _Preferences → SSH Keys_, eller et
  _personal access token_ med `write_repository` brukt som passord over HTTPS.

## 1. Alternativ A: flytt git-historikken med push (anbefalt)

Gir nøyaktig samme commits, grener og tagger. Issues og PR-er følger ikke med, se
[tabellen under](#issues-og-pull-requests-fra-github).

```bash
# Ny, ren klon, så lokale grener og endringer ikke blandes inn
git clone https://github.com/Nicolaykopaas/T17-Project2.git t17-flytting
cd t17-flytting
git remote add gitlab <GITLAB-URL>

# Push alle grener fra GitHub, én om gangen. Uten «+» og uten --force: GitLab avviser
# heller enn å overskrive. origin/HEAD er bare en peker og hoppes over.
for gren in $(git for-each-ref --format='%(refname:lstrip=3)' refs/remotes/origin/ | grep -v '^HEAD$'); do
  git push gitlab "refs/remotes/origin/$gren:refs/heads/$gren"
done

# Alle tagger (repoet har ingen i dag, men kommandoen er trygg å kjøre)
git push gitlab --tags
```

Ikke bruk `git push --mirror`: den kan slette og overskrive grener på mottakersiden.

Kontroll: tallet på grener skal være likt.

```bash
git ls-remote --heads origin | wc -l
git ls-remote --heads gitlab | wc -l
git rev-parse origin/main
git ls-remote gitlab refs/heads/main   # samme commit-hash som linja over
```

## 1. Alternativ B: GitLabs GitHub-importør

GitLab har en importør (_New project → Import project → GitHub_) som også tar med issues, PR-er
(som merge requests), kommentarer og review-tråder. Den trenger et GitHub-token med `repo`-tilgang.

- Importøren **lager et nytt prosjekt**. Den kan ikke fylle et prosjekt som allerede finnes. Bruk
  den i stedet for alternativ A, ikke i tillegg.
- Administratorene på `git.ntnu.no` kan ha slått den av. Står ikke GitHub i lista over kilder, bruk
  alternativ A.
- Forfattere som ikke finnes på `git.ntnu.no`, blir importert som brukeren som kjører importen, med
  opprinnelig navn i teksten.

Selv med importøren bør tabellen under ligge i repoet, så historikken kan leses uten GitLab-prosjektet.

## 2. Standardgren og beskyttet `main`

I prosjektet på `git.ntnu.no`:

1. _Settings → Repository → Branch defaults_: sett **Default branch** til `main`.
2. _Settings → Repository → Protected branches_: beskytt `main` med
   - **Allowed to merge:** Maintainers (eller Developers + Maintainers hvis alle i gruppa skal kunne merge)
   - **Allowed to push and merge:** No one
   - **Allowed to force push:** av
3. _Settings → Merge requests_:
   - **Merge method:** _Merge commit_, så historikken viser grenene slik den gjør i dag.
   - **Merge checks:** huk av for _Pipelines must succeed_ og _All threads must be resolved_.
4. Malene i `.gitlab/` tas i bruk automatisk: `merge_request_templates/Default.md` fylles inn i nye
   merge requests, og `issue_templates/Oppgave.md` kan velges når et issue opprettes.

## 3. CI: hva `.gitlab-ci.yml` trenger

**Ingen CI-variabler må legges inn.** Alt jobbene trenger står i fila selv:

| Jobb (steg)         | Bilde og tjenester                                           | Variabler satt i fila                                                                                |
| ------------------- | ------------------------------------------------------------ | ---------------------------------------------------------------------------------------------------- |
| `lint` (check)      | `node:22`                                                    | `HUSKY=0` (slår av git-hooks under `npm ci`)                                                         |
| `typecheck` (check) | `node:22`                                                    | `HUSKY=0`                                                                                            |
| `unit-tests` (test) | `node:22` + service `postgres:16` (alias `postgres`)         | `POSTGRES_DB=project2_test`, `POSTGRES_USER`, `POSTGRES_HOST_AUTH_METHOD=trust`, `TEST_DATABASE_URL` |
| `build` (test)      | `node:22`                                                    | lagrer `frontend/dist/` som artefakt i en uke                                                        |
| `e2e` (e2e)         | `mcr.microsoft.com/playwright:v1.63.0-noble` + `postgres:16` | `POSTGRES_DB=project2_e2e`, `E2E_DATABASE_URL`; JUnit-rapport og `playwright-report/`                |

Det som må være på plass i GitLab:

- **En runner med Docker-executor.** Jobbene bruker egne bilder og en `postgres:16`-service, så en
  shell-runner virker ikke. Sjekk _Settings → CI/CD → Runners_ at delte runnere (_instance runners_)
  er slått på. Finnes det ingen, må det spørres om hos IDI. Skriv det i `docs/prosess/blokkeringer.md`.
- **`CI=true`** settes automatisk av GitLab. Da bruker Playwright én ny kjøring ved feil, men
  feiler likevel jobben hvis en test bare består på andre forsøk (`failOnFlakyTests`), skriver
  JUnit-rapport og starter egne servere i stedet for å gjenbruke kjørende (se `playwright.config.ts`).
- **Ingen TMDB-nøkkel.** E2E-testene bruker falsk TMDB og falsk Internet Archive som Playwright
  starter selv. Ikke legg en ekte nøkkel inn som CI-variabel.
- **Playwright-versjonen** i bildenavnet (`v1.63.0`) må være lik `@playwright/test` i
  `package-lock.json` (1.63.0 i dag). Oppgraderes pakken, må bildet i `.gitlab-ci.yml` følge med.
- Standard jobbtidsgrense (60 min) holder. E2E bygger frontend og kjører testene på desktop og mobil.

## 4. Sjekk at pipelinen er grønn

1. Etter pushen starter en pipeline for hver gren. Åpne _Build → Pipelines_ (eller _CI/CD →
   Pipelines_). Starter den ikke, trykk _Run pipeline_ og velg `main`.
2. Pipelinen for `main` skal ha tre steg og fem jobber, alle grønne: `lint`, `typecheck` →
   `unit-tests`, `build` → `e2e`.
3. Åpne fanen _Tests_ på pipelinen. Den viser JUnit-rapporten fra `e2e`. Forventet er rundt 101
   beståtte og 15 hoppet over, 0 feilet (siste lokale kjøring, se `docs/prosess/status.md`).
4. Feiler `e2e`, last ned artefakten `playwright-report/` fra jobben og åpne `index.html`, eller
   kjør `npx playwright show-trace test-results/<test>/trace.zip` lokalt.
5. Lag en liten test-MR (for eksempel en skrivefeil i `docs/`) mot `main` og se at malen fylles inn,
   at pipelinen kjører på MR-en, og at _Merge_ er sperret til den er grønn.

Lokalt tilsvarer pipelinen `npm run lint && npm run typecheck && npm test && npm run build && npm run test:e2e`.

## 5. Pek VM-en på GitLab

`deploy/oppdater.sh` kjører `git pull --ff-only` i klonen den ligger i (`~/T17-Project2` på VM-en),
og `deploy/setup-vm.sh` kopierer derfra til `/opt/project2` med `rsync`. Det er derfor bare klonen i
hjemmekatalogen som må bytte remote. `/opt/project2` har ingen `.git` som må endres.

**Innlogging fra VM-en.** Et privat GitLab-prosjekt krever innlogging også for `git pull`. Bruk en
skrivebeskyttet _deploy key_ (SSH), så ingen personlige tokens ligger på VM-en:

```bash
ssh <bruker>@it2810-17.idi.ntnu.no
ssh-keygen -t ed25519 -f ~/.ssh/gitlab_deploy -N '' -C 'it2810-17 deploy'
cat ~/.ssh/gitlab_deploy.pub
```

Lim inn den offentlige nøkkelen under _Settings → Repository → Deploy keys_ i GitLab, uten
skrivetilgang. Legg så dette i `~/.ssh/config` på VM-en:

```
Host git.ntnu.no
  IdentityFile ~/.ssh/gitlab_deploy
  IdentitiesOnly yes
```

Bytt remote og sjekk at `main` følger GitLab:

```bash
cd ~/T17-Project2
git remote -v                                   # viser github.com i dag
git remote set-url origin git@git.ntnu.no:<gruppe>/t17-project2.git
git fetch origin
git switch main
git branch --set-upstream-to=origin/main main
git status                                      # «Your branch is up to date with 'origin/main'»
```

Siden historikken er den samme, går neste `git pull --ff-only` rett gjennom. Oppdater så som før:

```bash
ssh -t <bruker>@it2810-17.idi.ntnu.no bash T17-Project2/deploy/oppdater.sh
```

Kontroll: `git -C ~/T17-Project2 log -1 --oneline` skal vise samme commit som `main` på GitLab, og
<http://it2810-17.idi.ntnu.no/project2/> skal svare. Feiler `git pull` med `Permission denied
(publickey)`, er deploy-nøkkelen ikke lagt inn eller `~/.ssh/config` peker feil.

## 6. Etter flyttingen

- Arkiver GitHub-repoet (_Settings → Archive this repository_), så det ikke finnes to steder å pushe til.
- Oppdater lenker i dokumentasjonen som peker til GitHub, for eksempel «Issues og PR-er på GitHub»
  i `docs/beslutninger.md` og avsnittet om CI i `docs/deploy.md`.

## Issues og pull requests fra GitHub

GitHub-issues og -PR-er flyttes ikke med `git push`. Tabellene under bevarer koblingen mellom
oppgave, gren, PR og merge-commit, så historikken kan følges i git alene. Merge-commitene finnes i
GitLab etter flyttingen, og `git show <hash>` viser hele endringen.

### Issues

| Issue | Tittel                                                                 | Løst i PR          |
| ----- | ---------------------------------------------------------------------- | ------------------ |
| #13   | Tydelig feiltilstand når API-et ikke kan nås                           | #19                |
| #14   | Presis filteretikett og kategorinavigasjon på forsiden                 | #18                |
| #15   | Backend: vern av API-et, slett egen anmeldelse og aksentuavhengig søk  | #20                |
| #16   | Frontend: feilrettinger og tilgjengelighet fra kodegjennomgang         | #21                |
| #17   | CI, sikkerhetsheadere og dokumentasjon                                 | #22, #27           |
| #23   | Kommentarkvalitet og dokumentasjonskonsistens etter oktober-endringene | #24, #25, #26, #27 |

Alle issues er lukket. Koblingen issue → PR er hentet fra merge-commit-meldingene.

### Pull requests

| PR  | Tittel                                                                                      | Gren → mål                                    | Issue    | Merge-commit | Dato       |
| --- | ------------------------------------------------------------------------------------------- | --------------------------------------------- | -------- | ------------ | ---------- |
| #18 | Presis filteretikett, kategorinavigasjon og fiks av ustabil filter-checkbox                 | `feat/category-nav-and-label` → integrasjon   | #14      | `c9c2095`    | 2026-10-06 |
| #19 | Ett forklarende banner når API-et ikke kan nås, og /health                                  | `feat/api-unavailable-banner` → integrasjon   | #13      | `2d9123f`    | 2026-10-06 |
| #20 | Backend: vern av API-et, slett egen anmeldelse, aksentuavhengig og raskt kort søk           | `feat/backend-hardening` → integrasjon        | #15      | `27624a4`    | 2026-10-06 |
| #21 | Frontend: feilrettinger, tilgjengelighet, tema-bryter og slett egen anmeldelse              | `fix/frontend-review-findings` → integrasjon  | #16      | `d70aabe`    | 2026-10-06 |
| #22 | CI med build og E2E, Content-Security-Policy verifisert i E2E                               | `chore/ci-e2e-and-csp` → integrasjon          | #17      | `e1da2a3`    | 2026-10-06 |
| #24 | Backend: korrekte kommentarer og vaktbikkjetest mot frontendens faktiske spørringer         | `chore/backend-comment-pass` → integrasjon    | #23      | `97d9ffd`    | 2026-10-06 |
| #25 | Frontend: banner skiller nettverksfeil og nedetid, korrekte kommentarer, a11y-detaljer      | `fix/frontend-polish` → integrasjon           | #23      | `b94e090`    | 2026-10-06 |
| #26 | Docs: oppdatert status, E2E-oppsett, M7 i planen, KI-logg og beslutninger                   | `docs/consistency-pass` → integrasjon         | #23      | `67c3e63`    | 2026-10-06 |
| #27 | README som diskuterer alle viktige valg, og KI-deklarasjon                                  | `docs/readme-og-ki-deklarasjon` → integrasjon | #17, #23 | `2a1f6f7`    | 2026-10-06 |
| #28 | Oktober-arbeidet (#18–#27) inn i `main`                                                     | integrasjon → `main`                          | –        | `7a9e5ad`    | 2026-10-06 |
| #29 | Backend: rettinger fra sluttgjennomgang (DoS, kostnadsgrense, migrering, deploy)            | `fix/backend-final-review` → integrasjon      | –        | `10c9ee1`    | 2026-10-07 |
| #30 | Frontend: fokus, søkepaginering og kontrast fra sluttgjennomgang                            | `fix/frontend-final-review` → integrasjon     | –        | `dac0267`    | 2026-10-07 |
| #31 | Sluttgjennomgang: sikkerhet, tilgjengelighet, Lighthouse, enkel oppstart og ryddig struktur | integrasjon → `main`                          | –        | `7b4efef`    | 2026-10-08 |

«Integrasjon» er grenen `claude/adoring-brown-3nct5k`, se [`grener-og-pr.md`](grener-og-pr.md).
PR #28 heter «Claude/adoring brown 3nct5k» på GitHub. Beskrivelsen over er innholdet. Det finnes
ingen PR #23: nummeret er brukt av et issue, fordi GitHub teller issues og PR-er i samme rekke.
PR #1–#12 er fra september, gikk rett til `main` uten review og har ingen issues.

Review-kommentarene ligger bare på GitHub. Brukes ikke importøren (alternativ B), bør gruppa lagre
dem før GitHub-repoet arkiveres, for eksempel med `gh pr view <nr> --comments > docs/prosess/review/pr-<nr>.md`.
