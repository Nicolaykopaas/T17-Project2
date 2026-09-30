import { badInput } from './errors.js';

export const MAX_FIRST = 50;
export const MAX_QUERY_LENGTH = 200;
export const MAX_AUTHOR_LENGTH = 50;
export const MAX_REVIEW_TEXT_LENGTH = 2000;

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Gyldig UUID -> normalisert (små bokstaver), ellers null («ingen bruker»). */
export function parseUserId(header: string | null | undefined): string | null {
  if (!header || !UUID_RE.test(header)) return null;
  return header.toLowerCase();
}

/** Antall Unicode-tegn (ikke UTF-16-enheter), slik at en emoji teller som 1 for brukeren. */
export function charLength(s: string): number {
  let n = 0;
  for (const _ of s) n++;
  return n;
}

/** Postgres kan ikke lagre NUL-byte i tekst; avvises tidlig i stedet for å bli en databasefeil. */
function assertNoNul(s: string, field: string) {
  if (s.includes('\0')) throw badInput(`${field} inneholder ugyldige tegn.`);
}

export function validateFirst(first: number | null | undefined): number {
  const n = first ?? 20;
  if (!Number.isInteger(n) || n < 1 || n > MAX_FIRST) {
    throw badInput(`first må være mellom 1 og ${MAX_FIRST}.`);
  }
  return n;
}

/** Returnerer trimmet søketekst, eller null hvis tom (= alle titler). */
export function validateQuery(query: string | null | undefined): string | null {
  if (query == null) return null;
  if (charLength(query) > MAX_QUERY_LENGTH) {
    throw badInput(`query kan ikke være lengre enn ${MAX_QUERY_LENGTH} tegn.`);
  }
  assertNoNul(query, 'query');
  const trimmed = query.trim();
  return trimmed === '' ? null : trimmed;
}

export interface FiltersInput {
  genres?: string[] | null;
  decades?: number[] | null;
  types?: ('MOVIE' | 'SERIES')[] | null;
  minRating?: number | null;
}

export interface Filters {
  genres: string[];
  decades: number[];
  types: ('movie' | 'series')[];
  minRating: number | null;
}

export function validateFilters(input: FiltersInput | null | undefined): Filters {
  const genres = input?.genres ?? [];
  if (genres.length > 30) throw badInput('For mange sjangre i filteret.');
  for (const g of genres) {
    if (g.length === 0 || charLength(g) > 50) throw badInput('Ugyldig sjanger i filteret.');
    assertNoNul(g, 'genres');
  }

  const decades = input?.decades ?? [];
  if (decades.length > 30) throw badInput('For mange tiår i filteret.');
  for (const d of decades) {
    if (d < 1800 || d > 2100 || d % 10 !== 0) {
      throw badInput('Ugyldig tiår: bruk hele tiår som 1990.');
    }
  }

  const types = (input?.types ?? []).map((t): 'movie' | 'series' =>
    t === 'MOVIE' ? 'movie' : 'series',
  );

  const minRating = input?.minRating ?? null;
  if (minRating !== null && (!Number.isFinite(minRating) || minRating < 0 || minRating > 10)) {
    throw badInput('minRating må være mellom 0 og 10.');
  }

  return {
    genres: [...new Set(genres)],
    decades: [...new Set(decades)],
    types: [...new Set(types)],
    // 0 betyr «ingen grense»; `>= 0` ville ellers utelatt titler uten rating.
    minRating: minRating && minRating > 0 ? minRating : null,
  };
}

export interface ReviewInput {
  titleId: string;
  author: string;
  rating: number;
  text: string;
}

export function validateReview(input: ReviewInput): ReviewInput {
  const author = input.author.trim();
  const authorLen = charLength(author);
  if (authorLen < 1 || authorLen > MAX_AUTHOR_LENGTH) {
    throw badInput(`author må være 1–${MAX_AUTHOR_LENGTH} tegn.`);
  }
  if (!Number.isInteger(input.rating) || input.rating < 1 || input.rating > 5) {
    throw badInput('rating må være et heltall mellom 1 og 5.');
  }
  const text = input.text.trim();
  if (charLength(text) > MAX_REVIEW_TEXT_LENGTH) {
    throw badInput(`text kan ikke være lengre enn ${MAX_REVIEW_TEXT_LENGTH} tegn.`);
  }
  assertNoNul(author, 'author');
  assertNoNul(text, 'text');
  if (input.titleId.length === 0 || input.titleId.length > 30) {
    throw badInput('Ugyldig titleId.');
  }
  return { titleId: input.titleId, author, rating: input.rating, text };
}

/** ID-er er tconst («tt0111161»); alt annet kan vi avvise uten databasekall. */
export function isPlausibleTitleId(id: string): boolean {
  return id.length > 0 && id.length <= 30 && !id.includes('\0');
}
