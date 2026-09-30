# Deploy til it2810-17.idi.ntnu.no

Stegene under kjøres av Nicolay på VM-en (krever NTNU-VPN og `sudo`). Agentene har ikke kjørt dem.
Ferdige filer ligger i `deploy/`.

**Enklest (én linje, også fra PowerShell):**
`ssh -t <brukernavn>@it2810-17.idi.ntnu.no bash T17-Project2/deploy/oppdater.sh [TMDB-nøkkel]`.
Den henter siste kode og kjører `setup-vm.sh`. Nøkkelen trengs bare første gang.

**Raskeste vei fra VM-en selv:** `bash deploy/setup-vm.sh` fra en klon av repoet på VM-en gjør alle stegene under
automatisk (genererer også databasepassord i `.env`). Stegene under er det samme, gjort for hånd.

## 1. PostgreSQL

```bash
sudo apt update && sudo apt install -y postgresql postgresql-contrib   # contrib gir pg_trgm
sudo -u postgres createuser project2 --pwprompt                         # velg et sterkt passord
sudo -u postgres createdb project2 --owner project2
# pg_trgm må opprettes av en superbruker første gang (migreringen bruker IF NOT EXISTS):
sudo -u postgres psql -d project2 -c 'CREATE EXTENSION IF NOT EXISTS pg_trgm;'
```

## 2. Kode, bygg og data

```bash
sudo useradd --system --no-create-home --shell /usr/sbin/nologin project2
sudo mkdir -p /opt/project2 && sudo chown "$USER" /opt/project2
git clone <repo-url> /opt/project2 && cd /opt/project2
npm ci
cp .env.example .env    # sett DATABASE_URL=postgres://project2:<passord>@localhost:5432/project2
chmod 600 .env
npm run build
npm run db:migrate

# Ekte IMDb-data (ca. 250 MB nedlasting):
wget -P data https://datasets.imdbws.com/title.basics.tsv.gz https://datasets.imdbws.com/title.ratings.tsv.gz
npm run db:seed
sudo chown -R project2:project2 /opt/project2
sudo chmod 600 /opt/project2/.env
```

## 3. Backend som tjeneste

```bash
sudo cp deploy/project2-backend.service /etc/systemd/system/
sudo systemctl daemon-reload
sudo systemctl enable --now project2-backend
curl -s -X POST localhost:3001/graphql -H 'content-type: application/json' \
  -d '{"query":"{ search(first: 1) { totalCount } }"}'
```

## 4. Apache

```bash
sudo mkdir -p /var/www/html/project2
sudo cp -r frontend/dist/* /var/www/html/project2/
sudo cp deploy/apache-project2.conf /etc/apache2/conf-available/
sudo a2enmod proxy proxy_http rewrite headers expires deflate
sudo a2enconf apache-project2
sudo apachectl configtest && sudo systemctl reload apache2
```

Åpne <http://it2810-17.idi.ntnu.no/project2/>.

## Oppdatering senere

```bash
cd /opt/project2 && git pull && npm ci && npm run build && npm run db:migrate
sudo cp -r frontend/dist/* /var/www/html/project2/
sudo systemctl restart project2-backend
```
