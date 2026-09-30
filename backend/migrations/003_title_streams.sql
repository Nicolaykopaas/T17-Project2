-- Lovlige gratisversjoner fra Internet Archive (se docs/beslutninger.md, «Strømming»).
-- Egen tabell, som title_artwork: titles er en reimporterbar IMDb-kopi, mens dette er koblinger
-- vi har bygget selv og som må overleve en ny IMDb-import.
-- Vi lagrer bare pekere (element-id og filnavn). Selve videoen strømmes fra archive.org.
CREATE TABLE title_streams (
  -- Én stream per tittel: PK gir også oppslaget EXISTS(...) i søk og fasetter som ren indeksprobe.
  title_id         text PRIMARY KEY REFERENCES titles (id) ON DELETE CASCADE,
  archive_id       text NOT NULL,
  file_name        text NOT NULL,
  license          text NOT NULL,
  license_url      text,
  duration_seconds integer,
  subtitles_file   text,
  imported_at      timestamptz NOT NULL DEFAULT now()
);
