-- Aksentuavhengig søk («amelie» finner «Amélie») og ordprefiks for korte søk (1–2 tegn).

CREATE EXTENSION IF NOT EXISTS unaccent;

-- unaccent() er bare STABLE (ordlisten kan byttes), og Postgres krever IMMUTABLE i indeksuttrykk og
-- genererte kolonner. Standardgrepet er en IMMUTABLE innpakning som peker på ordlisten med fullt
-- kvalifisert navn, slik at den ikke avhenger av search_path. Ordlisten endres i praksis aldri;
-- skulle den gjøre det, må kolonnene og indeksene bygges på nytt. Det er IMMUTABLE som lar
-- planleggeren folde kall med konstant argument (søketeksten) til en konstant, slik at indeksene kan
-- brukes; STRICT og PARALLEL SAFE er bare ekstra optimalisering.
CREATE FUNCTION f_unaccent(text) RETURNS text
  LANGUAGE sql IMMUTABLE PARALLEL SAFE STRICT
  AS $$ SELECT public.unaccent('public.unaccent', $1) $$;

-- Normalisert tittel (små bokstaver, uten aksenter) som lagrede, genererte kolonner. Et rent
-- indeksuttrykk `lower(f_unaccent(primary_title))` ville også virket, men da regnes unaccent ut
-- på nytt for hver rad som leses i recheck, filter og relevansberegning (målt: ca. 2x tregere på
-- brede søk som «the»; se docs/ytelse.md). Prisen er ca. 2 x tittellengde ekstra lagring per rad.
--
-- Alle tre kolonnene legges til i ÉN ALTER TABLE, fordi hver slik kolonne skriver om hele tabellen
-- mens den holder ACCESS EXCLUSIVE-lås (ingen lesing eller skriving på titles under migreringen).
-- ca. 4 s lokalt på 120 000 titler (regn med 10–20 s på VM); stopp gjerne backend under migreringen (se docs/deploy.md).
-- title_words er en tsvector av begge titlene til ordprefikssøk (se lenger ned).
ALTER TABLE titles
  ADD COLUMN primary_title_norm  text GENERATED ALWAYS AS (lower(f_unaccent(primary_title)))  STORED,
  ADD COLUMN original_title_norm text GENERATED ALWAYS AS (lower(f_unaccent(original_title))) STORED,
  ADD COLUMN title_words tsvector GENERATED ALWAYS AS (
    to_tsvector('simple', lower(f_unaccent(primary_title)) || ' ' || lower(f_unaccent(original_title)))
  ) STORED;

-- Trigramindeksene byttes til de normaliserte kolonnene (se src/search.ts).
DROP INDEX titles_primary_title_trgm_idx;
DROP INDEX titles_original_title_trgm_idx;
CREATE INDEX titles_primary_title_trgm_idx
  ON titles USING gin (primary_title_norm gin_trgm_ops);
CREATE INDEX titles_original_title_trgm_idx
  ON titles USING gin (original_title_norm gin_trgm_ops);

-- Søk på 1–2 tegn har ingen trigrammer. De gjøres om til ORDprefiks («ma» finner «The Matrix»)
-- mot en lagret tsvector av begge titlene, med GIN. 'simple' (ingen stemming eller stoppord) fordi
-- titler ikke er prosa og «the» skal kunne søkes på. Dette erstatter prefiksindekser på hele
-- tittelen, som bare fant titler som BEGYNTE med søketeksten.
CREATE INDEX titles_title_words_idx ON titles USING gin (title_words);
