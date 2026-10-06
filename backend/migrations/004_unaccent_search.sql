-- Aksentuavhengig søk («amelie» finner «Amélie») og prefiksindekser for korte søk (1–2 tegn).

CREATE EXTENSION IF NOT EXISTS unaccent;

-- unaccent() er bare STABLE (ordlisten kan byttes), og Postgres krever IMMUTABLE i indeksuttrykk og
-- genererte kolonner. Standardgrepet er en IMMUTABLE innpakning som peker på ordlisten med fullt
-- kvalifisert navn, slik at den ikke avhenger av search_path. Ordlisten endres i praksis aldri;
-- skulle den gjøre det, må kolonnene og indeksene bygges på nytt. STRICT lar planleggeren folde kall
-- med konstant argument (søketeksten), slik at indeksene kan brukes.
CREATE FUNCTION f_unaccent(text) RETURNS text
  LANGUAGE sql IMMUTABLE PARALLEL SAFE STRICT
  AS $$ SELECT public.unaccent('public.unaccent', $1) $$;

-- Normalisert tittel (små bokstaver, uten aksenter) som lagrede, genererte kolonner. Et rent
-- indeksuttrykk `lower(f_unaccent(primary_title))` ville også virket, men da regnes unaccent ut
-- på nytt for hver rad som leses i recheck, filter og relevansberegning (målt: ca. 2x tregere på
-- brede søk som «the»; se docs/ytelse.md). Prisen er ca. 2 x tittellengde ekstra lagring per rad.
ALTER TABLE titles
  ADD COLUMN primary_title_norm  text GENERATED ALWAYS AS (lower(f_unaccent(primary_title)))  STORED,
  ADD COLUMN original_title_norm text GENERATED ALWAYS AS (lower(f_unaccent(original_title))) STORED;

-- Trigramindeksene byttes til de normaliserte kolonnene (se src/search.ts).
DROP INDEX titles_primary_title_trgm_idx;
DROP INDEX titles_original_title_trgm_idx;
CREATE INDEX titles_primary_title_trgm_idx
  ON titles USING gin (primary_title_norm gin_trgm_ops);
CREATE INDEX titles_original_title_trgm_idx
  ON titles USING gin (original_title_norm gin_trgm_ops);

-- Søk på 1–2 tegn ble tidligere delstrengsøk uten bruk av indeks. De gjøres nå om til prefiksmatch
-- (LIKE 'a%'), som en btree med text_pattern_ops kan svare på uavhengig av collation.
CREATE INDEX titles_primary_title_prefix_idx  ON titles (primary_title_norm text_pattern_ops);
CREATE INDEX titles_original_title_prefix_idx ON titles (original_title_norm text_pattern_ops);
