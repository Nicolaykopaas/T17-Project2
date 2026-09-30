#!/usr/bin/env bash
# Feilsøking på VM-en: kjører alle sjekkene og skriver resultatet samlet, så det kan limes inn
# i én melding. Endrer ingenting.
# Skriptet setter opp en Ubuntu-server; på Windows/macOS ville det feile halvveis.
if [ "$(uname -s)" != "Linux" ] || ! command -v apt-get >/dev/null; then
  echo "Dette skriptet skal kjøres på VM-en, ikke på din egen maskin." >&2
  echo "Logg inn først:  ssh <ntnu-brukernavn>@it2810-17.idi.ntnu.no" >&2
  exit 1
fi
Q='{"query":"{ search(first: 1) { totalCount } }"}'
line() { printf '\n===== %s =====\n' "$1"; }

line "1. Backend direkte (port 3001)"
curl -sS -m 10 -X POST http://127.0.0.1:3001/graphql -H 'content-type: application/json' -d "$Q"

line "2. Via Apache (/project2/graphql)"
curl -sS -m 10 -i -X POST http://localhost/project2/graphql -H 'content-type: application/json' -d "$Q" | head -n 20

line "7. Samme spørringer som forsiden sender (via Apache)"
UID_HDR='x-user-id: 00000000-0000-4000-8000-000000000000'
curl -sS -m 20 -w '\n(HTTP %{http_code}, %{time_total}s)\n' -X POST http://localhost/project2/graphql \
  -H 'content-type: application/json' -H "$UID_HDR" \
  -d '{"query":"query Search($first:Int,$sort:SortInput){ search(first:$first, sort:$sort){ totalCount pageInfo{hasNextPage endCursor} edges{ cursor node{ id primaryTitle type startYear genres averageRating numVotes } } } }","variables":{"first":20,"sort":{"field":"RELEVANCE","direction":"DESC"}}}' | head -c 600
echo
curl -sS -m 20 -w '\n(HTTP %{http_code}, %{time_total}s)\n' -X POST http://localhost/project2/graphql \
  -H 'content-type: application/json' -H "$UID_HDR" \
  -d '{"query":"{ facets { genres{value count} decades{value count} types{value count} } genres }"}' | head -c 600
echo

line "3. Forsiden via Apache"
curl -sS -m 10 -o /dev/null -w 'HTTP %{http_code}\n' http://localhost/project2/

line "4. Apache-moduler og konfig"
apache2ctl -M 2>/dev/null | grep -E 'proxy|rewrite|headers|deflate'
ls /etc/apache2/conf-enabled/ /etc/apache2/sites-enabled/

line "5. Apache-feillogg (siste 20)"
sudo tail -n 20 /var/log/apache2/error.log

line "6. Backend-logg (siste 20)"
sudo journalctl -u project2-backend -n 20 --no-pager -o cat
