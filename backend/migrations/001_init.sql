-- Skjema for titler, sjangre, anmeldelser og «min liste».

-- pg_trgm gir trigram-indekser som kan brukes av LIKE '%tekst%' (vanlig btree kan ikke det)
-- og similarity() for relevanssortering.
CREATE EXTENSION IF NOT EXISTS pg_trgm;

CREATE TABLE titles (
  id              text PRIMARY KEY,                       -- IMDb tconst, f.eks. tt0111161
  title_type      text NOT NULL CHECK (title_type IN ('movie', 'series')),
  primary_title   text NOT NULL,
  original_title  text NOT NULL,
  start_year      integer,
  end_year        integer,
  runtime_minutes integer,
  average_rating  numeric(3,1) CHECK (average_rating BETWEEN 0 AND 10),
  num_votes       integer NOT NULL DEFAULT 0,
  -- Denormalisert kopi av sjangrene (kilden er title_genres). Gir sjangerfilter med
  -- `genres @> ARRAY[...]` + GIN uten join, og sjangre til en hel resultatside uten ekstra spørring.
  genres          text[] NOT NULL DEFAULT '{}',
  -- Tiår som lagret kolonne: filtrering på tiår blir likhet på en indeksert kolonne i stedet for
  -- range-uttrykk, og fasettene kan gruppere direkte på den.
  start_decade    integer GENERATED ALWAYS AS (start_year / 10 * 10) STORED
);

CREATE TABLE genres (
  id   integer GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  name text NOT NULL UNIQUE
);

CREATE TABLE title_genres (
  title_id text    NOT NULL REFERENCES titles (id) ON DELETE CASCADE,
  genre_id integer NOT NULL REFERENCES genres (id) ON DELETE CASCADE,
  PRIMARY KEY (title_id, genre_id)
);

CREATE TABLE reviews (
  id         bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  title_id   text        NOT NULL REFERENCES titles (id) ON DELETE CASCADE,
  user_id    uuid        NOT NULL,
  author     text        NOT NULL CHECK (char_length(author) BETWEEN 1 AND 50),
  rating     smallint    NOT NULL CHECK (rating BETWEEN 1 AND 5),
  body       text        NOT NULL DEFAULT '' CHECK (char_length(body) <= 2000),
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE list_items (
  user_id  uuid        NOT NULL,
  title_id text        NOT NULL REFERENCES titles (id) ON DELETE CASCADE,
  added_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, title_id)
);

-- Tekstsøk: uttrykkene må være identiske med de i søkespørringen (lower(...)) for at
-- planleggeren skal kunne bruke indeksene (erstattet av 004_unaccent_search.sql).
CREATE INDEX titles_primary_title_trgm_idx  ON titles USING gin (lower(primary_title)  gin_trgm_ops);
CREATE INDEX titles_original_title_trgm_idx ON titles USING gin (lower(original_title) gin_trgm_ops);

-- Filtre.
CREATE INDEX titles_genres_gin_idx ON titles USING gin (genres);
CREATE INDEX titles_decade_idx     ON titles (start_decade);
CREATE INDEX titles_type_idx       ON titles (title_type);

-- Sorteringer. Uttrykkene speiler ORDER BY / keyset-sammenligningen i src/search.ts, og id som
-- siste kolonne er tiebreakeren. btree kan skannes begge veier, så én indeks dekker ASC og DESC.
CREATE INDEX titles_votes_idx  ON titles (num_votes, id);
CREATE INDEX titles_rating_idx ON titles ((COALESCE(average_rating, -1)), num_votes, id);
CREATE INDEX titles_year_idx   ON titles ((COALESCE(start_year, 0)), num_votes, id);
CREATE INDEX titles_title_idx  ON titles ((lower(primary_title)), id);

-- title_genres slås opp fra sjangersiden (PK dekker title_id -> genre_id).
CREATE INDEX title_genres_genre_idx ON title_genres (genre_id, title_id);

-- Anmeldelser: nyeste først per tittel, og aggregater (antall/snitt) per tittel.
CREATE INDEX reviews_title_created_idx ON reviews (title_id, created_at DESC, id DESC);

-- «Min liste»: sist lagt til først per bruker.
CREATE INDEX list_items_user_added_idx ON list_items (user_id, added_at DESC, title_id DESC);
