/**
 * Rene funksjoner for IMDb-importen (ingen I/O), slik at parsing og filtrering kan enhetstestes.
 */

export const BASICS_HEADER = [
  'tconst',
  'titleType',
  'primaryTitle',
  'originalTitle',
  'isAdult',
  'startYear',
  'endYear',
  'runtimeMinutes',
  'genres',
];
export const RATINGS_HEADER = ['tconst', 'averageRating', 'numVotes'];

export interface Rating {
  averageRating: number;
  numVotes: number;
}

export interface TitleRow {
  id: string;
  titleType: 'movie' | 'series';
  primaryTitle: string;
  originalTitle: string;
  startYear: number | null;
  endYear: number | null;
  runtimeMinutes: number | null;
  averageRating: number;
  numVotes: number;
  genres: string[];
}

/** IMDb skriver `\N` for manglende verdi. */
const NULL = '\\N';

function optionalInt(value: string | undefined): number | null {
  if (value === undefined || value === NULL || !/^\d{1,9}$/.test(value)) return null;
  return Number(value);
}

/** Tittel-typene vi beholder, og hva de heter hos oss. */
const TYPE_MAP: Record<string, 'movie' | 'series'> = {
  movie: 'movie',
  tvSeries: 'series',
  tvMiniSeries: 'series',
};

export function mapTitleType(imdbType: string): 'movie' | 'series' | null {
  return TYPE_MAP[imdbType] ?? null;
}

/** Overskriftslinjer begynner med feltnavnet, ekte data med tconst (tt…). */
export function isHeaderLine(line: string): boolean {
  return line.startsWith('tconst\t');
}

/** Parser én linje fra title.ratings.tsv. Returnerer null for ugyldige linjer. */
export function parseRatingLine(line: string): { tconst: string; rating: Rating } | null {
  const parts = line.split('\t');
  if (parts.length < 3) return null;
  const [tconst, rating, votes] = parts as [string, string, string];
  if (!tconst || !/^\d+(\.\d+)?$/.test(rating) || !/^\d{1,10}$/.test(votes)) return null;
  const averageRating = Number(rating);
  const numVotes = Number(votes);
  if (averageRating < 0 || averageRating > 10 || numVotes > 2_147_483_647) return null;
  return { tconst, rating: { averageRating, numVotes } };
}

/**
 * Parser én linje fra title.basics.tsv og slår sammen med rating. Returnerer null hvis linjen
 * skal hoppes over (feil type, for få stemmer, ingen rating, ødelagt linje).
 */
export function parseBasicsLine(
  line: string,
  ratings: ReadonlyMap<string, Rating>,
  minVotes: number,
): TitleRow | null {
  const parts = line.split('\t');
  if (parts.length < 9) return null;
  const [tconst, type, primary, original, , start, end, runtime, genres] = parts as [
    string,
    string,
    string,
    string,
    string,
    string,
    string,
    string,
    string,
  ];
  const titleType = mapTitleType(type);
  if (!titleType) return null;
  const rating = ratings.get(tconst);
  if (!rating || rating.numVotes < minVotes) return null;
  // Postgres-tekst kan ikke inneholde NUL-byte; en slik tittel er uansett ødelagt.
  if (!primary || primary === NULL || primary.includes('\0') || original.includes('\0'))
    return null;

  return {
    id: tconst,
    titleType,
    primaryTitle: primary,
    originalTitle: original && original !== NULL ? original : primary,
    startYear: optionalInt(start),
    endYear: optionalInt(end),
    runtimeMinutes: optionalInt(runtime),
    averageRating: rating.averageRating,
    numVotes: rating.numVotes,
    genres:
      genres === NULL || genres === ''
        ? []
        : [
            ...new Set(
              genres
                .split(',')
                .map((g) => g.trim())
                .filter(Boolean),
            ),
          ],
  };
}
