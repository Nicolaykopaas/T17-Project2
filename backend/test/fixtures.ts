import type { Pool } from '../src/db.js';

export interface FixtureTitle {
  id: string;
  type: 'movie' | 'series';
  primary: string;
  original?: string;
  year: number | null;
  endYear?: number | null;
  rating: number | null;
  votes: number;
  genres: string[];
}

const t = (
  id: number,
  primary: string,
  type: 'movie' | 'series',
  year: number | null,
  rating: number | null,
  votes: number,
  genres: string[],
  extra: Partial<FixtureTitle> = {},
): FixtureTitle => ({
  id: `tt${String(id).padStart(7, '0')}`,
  primary,
  type,
  year,
  rating,
  votes,
  genres,
  ...extra,
});

const named: FixtureTitle[] = [
  t(1, 'The Dark Knight', 'movie', 2008, 9.0, 2800000, ['Action', 'Crime', 'Drama']),
  t(2, 'Dark City', 'movie', 1998, 7.6, 300000, ['Sci-Fi', 'Mystery']),
  t(3, 'Dark Waters', 'movie', 2019, 7.6, 150000, ['Drama']),
  t(4, 'Darkman', 'movie', 1990, 6.4, 90000, ['Action', 'Sci-Fi']),
  t(5, 'Amélie', 'movie', 2001, 8.3, 800000, ['Comedy', 'Romance'], {
    original: "Le Fabuleux Destin d'Amélie Poulain",
  }),
  t(6, 'Café Society', 'movie', 2016, 6.7, 100000, ['Comedy', 'Drama', 'Romance']),
  t(7, 'It', 'movie', 2017, 7.3, 600000, ['Horror'], { original: 'Ça' }),
  t(8, '100% Pure', 'movie', 2005, 5.0, 1200, ['Comedy']),
  t(9, 'Under_score Story', 'movie', 2010, 5.5, 2000, ['Drama']),
  t(10, 'UnderXscore Story', 'movie', 2010, 5.5, 1900, ['Drama']),
  t(11, "Don't Look Up", 'movie', 2021, 7.2, 550000, ['Comedy', 'Drama']),
  t(12, 'Say "Cheese"', 'movie', 2012, 4.1, 900, ['Comedy']),
  t(13, 'Back\\Slash', 'movie', 2003, 4.8, 800, ['Drama']),
  t(14, 'Emoji 🎬 Night', 'movie', 2020, 6.0, 700, ['Musical']),
  t(15, 'Breaking Bad', 'series', 2008, 9.5, 2200000, ['Crime', 'Drama', 'Thriller'], {
    endYear: 2013,
  }),
  t(16, 'Dark', 'series', 2017, 8.7, 500000, ['Crime', 'Drama', 'Mystery'], { endYear: 2020 }),
  t(17, 'Bad Banks', 'series', 2018, 7.6, 20000, ['Drama', 'Thriller']),
  t(18, 'Unknown Year Film', 'movie', null, 5.0, 3000, ['Drama']),
  t(19, 'Unrated Film', 'movie', 1999, null, 4000, ['Comedy']),
  t(20, "O'Brien's Odyssey", 'series', 1985, 6.9, 5000, ['Adventure'], { endYear: 1988 }),
];

// Fyllmateriale med bevisst mange likheter i rating/år/stemmer, slik at tiebreaks og
// paginering over like verdier blir testet.
const filler: FixtureTitle[] = Array.from({ length: 27 }, (_, i) =>
  t(
    100 + i,
    `Filler ${String(i).padStart(2, '0')}`,
    i % 4 === 0 ? 'series' : 'movie',
    1950 + (i % 5) * 10 + (i % 3),
    3 + (i % 6),
    1000 + (i % 4) * 100,
    [['Drama'], ['Comedy', 'Drama'], ['Western'], ['War', 'History']][i % 4] as string[],
  ),
);

export const TITLES: FixtureTitle[] = [...named, ...filler];
export const TITLE_COUNT = TITLES.length;

/** Tømmer alle tabeller og setter inn det kontrollerte datasettet. */
export async function resetData(pool: Pool): Promise<void> {
  await pool.query(
    'TRUNCATE reviews, list_items, title_genres, genres, titles RESTART IDENTITY CASCADE',
  );
  // Genres sendes som kommaseparert tekst per rad og pakkes ut til text[] i SQL.
  await pool.query(
    `INSERT INTO titles (id, title_type, primary_title, original_title, start_year, end_year,
                         average_rating, num_votes, genres)
     SELECT id, tt, pt, ot, sy, ey, r, v, string_to_array(g, ',')
     FROM unnest($1::text[], $2::text[], $3::text[], $4::text[], $5::int[], $6::int[],
                 $7::numeric[], $8::int[], $9::text[])
       AS x(id, tt, pt, ot, sy, ey, r, v, g)`,
    [
      TITLES.map((x) => x.id),
      TITLES.map((x) => x.type),
      TITLES.map((x) => x.primary),
      TITLES.map((x) => x.original ?? x.primary),
      TITLES.map((x) => x.year),
      TITLES.map((x) => x.endYear ?? null),
      TITLES.map((x) => x.rating),
      TITLES.map((x) => x.votes),
      TITLES.map((x) => x.genres.join(',')),
    ],
  );
  const all = [...new Set(TITLES.flatMap((x) => x.genres))];
  await pool.query('INSERT INTO genres (name) SELECT unnest($1::text[])', [all]);
}
