#!/usr/bin/env bash
# Feilsøking på VM-en: kjører alle sjekkene og skriver resultatet samlet, så det kan limes inn
# i én melding. Endrer ingenting.
Q='{"query":"{ search(first: 1) { totalCount } }"}'
line() { printf '\n===== %s =====\n' "$1"; }

line "1. Backend direkte (port 3001)"
curl -sS -m 10 -X POST http://127.0.0.1:3001/graphql -H 'content-type: application/json' -d "$Q"

line "2. Via Apache (/project2/graphql)"
curl -sS -m 10 -i -X POST http://localhost/project2/graphql -H 'content-type: application/json' -d "$Q" | head -n 20

line "3. Forsiden via Apache"
curl -sS -m 10 -o /dev/null -w 'HTTP %{http_code}\n' http://localhost/project2/

line "4. Apache-moduler og konfig"
apache2ctl -M 2>/dev/null | grep -E 'proxy|rewrite|headers|deflate'
ls /etc/apache2/conf-enabled/ /etc/apache2/sites-enabled/

line "5. Apache-feillogg (siste 20)"
sudo tail -n 20 /var/log/apache2/error.log

line "6. Backend-logg (siste 20)"
sudo journalctl -u project2-backend -n 20 --no-pager -o cat
