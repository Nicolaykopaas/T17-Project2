import type { Pool } from './db.js';
import {
  afterCondition,
  BIGINT_PATTERN,
  decodeCursor,
  encodeCursor,
  orderBy,
  projections,
  TIMESTAMP_PATTERN,
  type Direction,
  type KeyDef,
} from './keyset.js';
import type { Filters } from './validation.js';

export interface TitleRow {
  id: string;
  title_type: 'movie' | 'series';
  primary_title: string;
  original_title: string;
  start_year: number | null;
  end_year: number | null;
  runtime_minutes: number | null;
  average_rating: string | null; // numeric kommer som streng fra pg
  num_votes: number;
  genres: string[];
}

export const TITLE_COLUMNS = `t.id, t.title_type, t.primary_title, t.original_title, t.start_year,
  t.end_year, t.runtime_minutes, t.average_rating, t.num_votes, t.genres`;

export interface Connection<T> {
  edges: { cursor: string; node: T }[];
  pageInfo: { hasNextPage: boolean; endCursor: string | null };
  /** Lazy: beregnes bare hvis klienten faktisk ber om totalCount. */
  totalCount: () => Promise<number>;
}

/** Samler parametere slik at all data går som $n – aldri limt inn i SQL-teksten. */
class Params {
  readonly values: unknown[] = [];
  add(value: unknown): string {
    this.values.push(value);
    return `$${this.values.length}`;
  }
}

/**
 * Normalisert tittel (små bokstaver, uten aksenter) ligger som genererte kolonner, med indekser på
 * dem (004_unaccent_search.sql). Søketeksten må normaliseres med nøyaktig samme uttrykk, og det
 * gjøres i Postgres (`norm`) for at TypeScript og databasen aldri skal uenes om hva «uten aksent»
 * betyr. Kolonnene i stedet for et uttrykk i spørringen unngår at unaccent() kjøres på nytt for
 * hver rad i filter, recheck og relevansberegning.
 */
const norm = (expr: string) => `lower(f_unaccent(${expr}))`;
const TITLE_NORM = 't.primary_title_norm';
const ORIGINAL_NORM = 't.original_title_norm';

/**
 * LIKE-mønster for delstrengsøk der %, _ og \ i søketeksten betyr seg selv. Rekkefølgen er viktig:
 * normaliser FØRST (unaccent), escape ETTERPÅ. unaccent.rules mapper bl.a. fullbreddetegnene
 * `％`, `＿` og `＼` til `%`, `_` og `\`; escapet vi før normaliseringen, ble de jokertegn og
 * traff hele tabellen. Begge trinn gjøres i Postgres. Regex-strengene er vanlige SQL-strenger
 * (standard_conforming_strings = on): `[\\%_]` er en tegnklasse med `\`, `%` og `_`, og `\\\1` i
 * erstatningen er en backslash etterfulgt av treffet.
 */
const likePattern = (param: string) =>
  String.raw`'%' || regexp_replace(${norm(`${param}::text`)}, '([\\%_])', '\\\1', 'g') || '%'`;

/**
 * Søk på 1–2 tegn har ingen trigrammer, så GIN-indeksene kan ikke brukes og delstrengsøk ville
 * lest hele tabellen og regnet likhet på nesten alle rader (ca. 0,5 s på 120 000 titler). Slike
 * søk er derfor ORDprefiks («ma» finner «The Matrix») mot en generert tsvector med GIN-indeks, og
 * rangeres etter popularitet (se docs/ytelse.md).
 *
 * Søketeksten strippes for tegnsetting, mellomrom og kontrolltegn FØR den settes inn i
 * tsquery-syntaksen, fordi `& | ! ( ) : * < > ' \` ellers er operatorer eller gir syntaksfeil. Det
 * som er igjen er bokstaver og sifre, så uttrykket kan ikke kaste feil. Blir ingenting igjen
 * (f.eks. «%» eller «'») gir NULLIF NULL, og dermed ingen treff.
 */
const wordPrefixQuery = (param: string) =>
  `to_tsquery('simple', NULLIF(regexp_replace(${norm(`${param}::text`)}, '[[:punct:][:space:][:cntrl:]]', '', 'g'), '') || ':*')`;

export const SHORT_QUERY_MAX = 2;
export const isShortQuery = (query: string): boolean => [...query].length <= SHORT_QUERY_MAX;

export type Dimension = 'genres' | 'decades' | 'types' | 'available';

// Ett PK-oppslag i title_streams per kandidatrad (semi-join), aldri en skanning av tabellen.
const HAS_STREAM = 'EXISTS (SELECT 1 FROM title_streams s WHERE s.title_id = t.id)';

/**
 * WHERE-betingelser for søketekst + filtre. `skip` utelater ett filter, brukt av fasettene:
 * en dimensjon telles med alle ANDRE filtre aktive.
 */
function filterConditions(
  query: string | null,
  filters: Filters,
  p: Params,
  skip?: Dimension,
): string[] {
  const conds: string[] = [];
  if (query) {
    if (isShortQuery(query)) {
      conds.push(`t.title_words @@ ${wordPrefixQuery(p.add(query))}`);
    } else {
      const like = likePattern(p.add(query));
      conds.push(`(${TITLE_NORM} LIKE ${like} OR ${ORIGINAL_NORM} LIKE ${like})`);
    }
  }
  if (skip !== 'genres' && filters.genres.length > 0) {
    // @> = «inneholder alle»; bruker GIN-indeksen på titles.genres.
    conds.push(`t.genres @> ${p.add(filters.genres)}::text[]`);
  }
  if (skip !== 'decades' && filters.decades.length > 0) {
    conds.push(`t.start_decade = ANY(${p.add(filters.decades)}::int[])`);
  }
  if (skip !== 'types' && filters.types.length > 0) {
    conds.push(`t.title_type = ANY(${p.add(filters.types)}::text[])`);
  }
  if (filters.minRating !== null) {
    conds.push(`t.average_rating >= ${p.add(filters.minRating)}::numeric`);
  }
  if (skip !== 'available' && filters.availableOnly) conds.push(HAS_STREAM);
  return conds;
}

const where = (conds: string[]) => (conds.length ? `WHERE ${conds.join(' AND ')}` : '');

export type SortField = 'RELEVANCE' | 'RATING' | 'YEAR' | 'TITLE';

export const DEFAULT_DIRECTION: Record<SortField, 'ASC' | 'DESC'> = {
  RELEVANCE: 'DESC',
  RATING: 'DESC',
  YEAR: 'DESC',
  TITLE: 'ASC',
};

const VOTES: KeyDef = { expr: 't.num_votes', cast: 'int', kind: 'int' };
const ID: KeyDef = { expr: 't.id', cast: 'text', kind: 'text' };

/**
 * Sorteringsnøkler per felt. Manglende verdier erstattes med en sentinel (COALESCE) slik at
 * radsammenligningen i cursoren aldri møter NULL (NULL < x er ukjent, og rader ville forsvunnet).
 * Konsekvens: titler uten rating/år havner sist i DESC og først i ASC. Uttrykkene må være
 * identiske med indeksene i 001_init.sql.
 */
function sortKeys(field: SortField, query: string | null, p: Params): KeyDef[] {
  switch (field) {
    case 'RELEVANCE': {
      // Korte søk rangeres bare etter popularitet: likhet mot 1–2 tegn er støy, og å regne den ut
      // for alle prefikstreffene var det dyreste ved søket.
      if (!query || isShortQuery(query)) return [VOTES, ID];
      const q = norm(`${p.add(query)}::text`);
      // Likhet alene rangerer obskure titler med identisk navn over klassikerne brukeren som regel
      // mener («Dark Knight», 1 500 stemmer, før «The Dark Knight»). word_similarity gir full score
      // når søkeordene står i tittelen, likhet belønner eksakte treff, og popularitet (log10 av
      // stemmer, mettet ved 10 mill.) skiller resten. Stemmer og id er tiebreak.
      const wordSim = `GREATEST(word_similarity(${q}, ${TITLE_NORM}), word_similarity(${q}, ${ORIGINAL_NORM}))`;
      const sim = `GREATEST(similarity(${TITLE_NORM}, ${q}), similarity(${ORIGINAL_NORM}, ${q}))`;
      const pop = `LEAST(log(GREATEST(t.num_votes, 1)) / 7.0, 1.0)`;
      const rel = `(0.6 * ${wordSim} + 0.2 * ${sim} + 0.2 * ${pop})`;
      return [{ expr: rel, select: `(${rel})::float8`, cast: 'float8', kind: 'float' }, VOTES, ID];
    }
    case 'RATING':
      return [
        {
          expr: 'COALESCE(t.average_rating, -1)',
          select: '(COALESCE(t.average_rating, -1))::float8',
          cast: 'numeric',
          kind: 'float',
        },
        VOTES,
        ID,
      ];
    case 'YEAR':
      return [{ expr: 'COALESCE(t.start_year, 0)', cast: 'int', kind: 'int' }, VOTES, ID];
    case 'TITLE':
      return [{ expr: 'lower(t.primary_title)', cast: 'text', kind: 'text' }, ID];
  }
}

/** Kutter den ekstra raden (first+1) og bygger edges med en cursor per rad. */
function buildPage<Row extends { [k: string]: unknown }, Node>(
  rows: Row[],
  first: number,
  keys: KeyDef[],
  signature: string,
  toNode: (row: Row) => Node,
  totalCount: () => Promise<number>,
): Connection<Node> {
  const hasNextPage = rows.length > first;
  const edges = rows.slice(0, first).map((row) => ({
    cursor: encodeCursor(
      signature,
      keys.map((_, i) => row[`k${i}`]),
    ),
    node: toNode(row),
  }));
  return {
    edges,
    pageInfo: { hasNextPage, endCursor: edges.at(-1)?.cursor ?? null },
    totalCount,
  };
}

export interface SearchArgs {
  query: string | null;
  filters: Filters;
  field: SortField;
  direction: Direction;
  first: number;
  after: string | null;
}

type KeyedTitleRow = TitleRow & { [k: string]: unknown };

export async function searchTitles(pool: Pool, args: SearchArgs): Promise<Connection<TitleRow>> {
  const { query, filters, field, direction, first, after } = args;
  const p = new Params();
  const conds = filterConditions(query, filters, p);
  const keys = sortKeys(field, query, p);
  // Korte søk har andre sorteringsnøkler enn vanlige (ingen likhetskolonne), så cursorene må
  // ikke kunne byttes mellom dem.
  const queryKind = !query ? '-' : isShortQuery(query) ? 's' : 'q';
  const signature = `search:${field}:${direction}:${queryKind}`;
  const rowConds = [...conds];
  if (after !== null) {
    const values = decodeCursor(after, signature, keys);
    rowConds.push(afterCondition(keys, values, direction, (v) => p.add(v)));
  }
  const limit = p.add(first + 1);
  const { rows } = await pool.query<KeyedTitleRow>(
    `SELECT ${TITLE_COLUMNS}, ${projections(keys)}
     FROM titles t
     ${where(rowConds)}
     ORDER BY ${orderBy(keys, direction)}
     LIMIT ${limit}`,
    p.values,
  );

  const countTotal = async () => {
    const cp = new Params();
    const { rows: c } = await pool.query<{ n: string }>(
      `SELECT count(*) AS n FROM titles t ${where(filterConditions(query, filters, cp))}`,
      cp.values,
    );
    return Number(c[0]?.n ?? 0);
  };
  return buildPage(rows, first, keys, signature, (r) => r, memoize(countTotal));
}

function memoize<T>(fn: () => Promise<T>): () => Promise<T> {
  let cached: Promise<T> | undefined;
  return () => (cached ??= fn());
}

export interface FacetCount {
  value: string;
  count: number;
}

export interface FacetsResult {
  genres: FacetCount[];
  decades: FacetCount[];
  types: FacetCount[];
  available: number;
}

export async function getFacets(
  pool: Pool,
  query: string | null,
  filters: Filters,
): Promise<FacetsResult> {
  const run = async (dim: Dimension, select: string, from: string, extra: string, tail: string) => {
    const p = new Params();
    const conds = filterConditions(query, filters, p, dim);
    if (extra) conds.push(extra);
    const { rows } = await pool.query<{ value: string; count: number }>(
      `SELECT ${select} FROM ${from} ${where(conds)} ${tail}`,
      p.values,
    );
    return rows;
  };
  const countAvailable = async () => {
    const p = new Params();
    const conds = [...filterConditions(query, filters, p, 'available'), HAS_STREAM];
    const { rows } = await pool.query<{ n: number }>(
      `SELECT count(*)::int AS n FROM titles t ${where(conds)}`,
      p.values,
    );
    return rows[0]?.n ?? 0;
  };
  const [genres, decades, types, available] = await Promise.all([
    run(
      'genres',
      'g AS value, count(*)::int AS count',
      'titles t CROSS JOIN LATERAL unnest(t.genres) AS g',
      '',
      'GROUP BY g ORDER BY count DESC, g',
    ),
    run(
      'decades',
      't.start_decade::text AS value, count(*)::int AS count',
      'titles t',
      't.start_decade IS NOT NULL',
      'GROUP BY t.start_decade ORDER BY t.start_decade',
    ),
    run(
      'types',
      't.title_type AS value, count(*)::int AS count',
      'titles t',
      '',
      'GROUP BY t.title_type ORDER BY t.title_type',
    ),
    countAvailable(),
  ]);

  // Valgte verdier vises alltid, også med 0 treff, slik at brukeren ser hva som er valgt.
  const withSelected = (rows: FacetCount[], selected: string[]): FacetCount[] => {
    const have = new Set(rows.map((r) => r.value));
    return [...rows, ...selected.filter((s) => !have.has(s)).map((value) => ({ value, count: 0 }))];
  };
  return {
    genres: withSelected(genres, filters.genres),
    decades: withSelected(decades, filters.decades.map(String)).sort(
      (a, b) => Number(a.value) - Number(b.value),
    ),
    types: withSelected(
      types.map((t) => ({ value: t.value.toUpperCase(), count: t.count })),
      filters.types.map((t) => t.toUpperCase()),
    ),
    available,
  };
}

export async function getTitle(pool: Pool, id: string): Promise<TitleRow | null> {
  const { rows } = await pool.query<TitleRow>(
    `SELECT ${TITLE_COLUMNS} FROM titles t WHERE t.id = $1`,
    [id],
  );
  return rows[0] ?? null;
}

export async function getGenres(pool: Pool): Promise<string[]> {
  const { rows } = await pool.query<{ name: string }>('SELECT name FROM genres ORDER BY name');
  return rows.map((r) => r.name);
}

const LIST_KEYS: KeyDef[] = [
  {
    expr: 'li.added_at',
    select: 'li.added_at::text',
    cast: 'timestamptz',
    kind: 'text',
    pattern: TIMESTAMP_PATTERN,
  },
  { expr: 'li.title_id', cast: 'text', kind: 'text' },
];

export async function getMyList(
  pool: Pool,
  userId: string | null,
  first: number,
  after: string | null,
): Promise<Connection<TitleRow>> {
  if (!userId) {
    return {
      edges: [],
      pageInfo: { hasNextPage: false, endCursor: null },
      totalCount: async () => 0,
    };
  }
  const p = new Params();
  const conds = [`li.user_id = ${p.add(userId)}::uuid`];
  if (after !== null) {
    const values = decodeCursor(after, 'myList', LIST_KEYS);
    conds.push(afterCondition(LIST_KEYS, values, 'DESC', (v) => p.add(v)));
  }
  const limit = p.add(first + 1);
  const { rows } = await pool.query<KeyedTitleRow>(
    `SELECT ${TITLE_COLUMNS}, ${projections(LIST_KEYS)}
     FROM list_items li JOIN titles t ON t.id = li.title_id
     ${where(conds)}
     ORDER BY ${orderBy(LIST_KEYS, 'DESC')}
     LIMIT ${limit}`,
    p.values,
  );
  const total = memoize(async () => {
    const { rows: c } = await pool.query<{ n: string }>(
      'SELECT count(*) AS n FROM list_items WHERE user_id = $1::uuid',
      [userId],
    );
    return Number(c[0]?.n ?? 0);
  });
  return buildPage(rows, first, LIST_KEYS, 'myList', (r) => r, total);
}

export interface ReviewRow {
  id: string;
  title_id: string;
  user_id: string;
  author: string;
  rating: number;
  body: string;
  created_at: Date;
}

const REVIEW_KEYS: KeyDef[] = [
  // Tidsstempelet leses som tekst: JS Date har bare millisekunder, Postgres mikrosekunder, og et
  // avrundet tidsstempel i cursoren ville gitt hopp eller duplikater mellom sidene.
  {
    expr: 'r.created_at',
    select: 'r.created_at::text',
    cast: 'timestamptz',
    kind: 'text',
    pattern: TIMESTAMP_PATTERN,
  },
  { expr: 'r.id', select: 'r.id::text', cast: 'bigint', kind: 'text', pattern: BIGINT_PATTERN },
];

export async function getReviews(
  pool: Pool,
  titleId: string,
  first: number,
  after: string | null,
): Promise<Connection<ReviewRow>> {
  const p = new Params();
  const conds = [`r.title_id = ${p.add(titleId)}`];
  if (after !== null) {
    const values = decodeCursor(after, 'reviews', REVIEW_KEYS);
    conds.push(afterCondition(REVIEW_KEYS, values, 'DESC', (v) => p.add(v)));
  }
  const limit = p.add(first + 1);
  const { rows } = await pool.query<ReviewRow & { [k: string]: unknown }>(
    `SELECT r.id::text AS id, r.title_id, r.user_id, r.author, r.rating, r.body, r.created_at,
            ${projections(REVIEW_KEYS)}
     FROM reviews r
     ${where(conds)}
     ORDER BY ${orderBy(REVIEW_KEYS, 'DESC')}
     LIMIT ${limit}`,
    p.values,
  );
  const total = memoize(async () => {
    const { rows: c } = await pool.query<{ n: string }>(
      'SELECT count(*) AS n FROM reviews WHERE title_id = $1',
      [titleId],
    );
    return Number(c[0]?.n ?? 0);
  });
  return buildPage(rows, first, REVIEW_KEYS, 'reviews', (r) => r, total);
}
