-- Bilder og handling fra TMDB, hentet ved første behov og lagret her (se docs/beslutninger.md).
-- Egen tabell i stedet for kolonner på titles: titles er en ren IMDb-kopi som kan importeres
-- på nytt, mens dette er hentet fra en ekstern tjeneste med egen levetid.
CREATE TABLE title_artwork (
  title_id      text PRIMARY KEY REFERENCES titles (id) ON DELETE CASCADE,
  -- 'missing' huskes slik at titler TMDB ikke kjenner ikke slås opp igjen ved hvert søk.
  status        text NOT NULL CHECK (status IN ('found', 'missing')),
  poster_path   text,
  backdrop_path text,
  overview      text,
  fetched_at    timestamptz NOT NULL DEFAULT now()
);
