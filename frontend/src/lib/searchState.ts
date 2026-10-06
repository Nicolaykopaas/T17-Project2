import type {
  SearchFilters,
  SortDirection,
  SortField,
  SortInput,
  TitleType,
} from '../graphql/types';

/** Alt brukeren har valgt i søket. Speiles i URL-en så lenker og «tilbake» virker. */
export interface SearchState {
  q: string;
  genres: string[];
  decades: number[];
  types: TitleType[];
  minRating: number | null;
  /** Bare titler med lovlig strøm («Kun filmer som kan strømmes gratis»). */
  available: boolean;
  /** null = ikke valgt, serveren bruker sin standard (relevans, eller popularitet uten søketekst). */
  sort: SortField | null;
  dir: SortDirection | null;
}

export const EMPTY_STATE: SearchState = {
  q: '',
  genres: [],
  decades: [],
  types: [],
  minRating: null,
  available: false,
  sort: null,
  dir: null,
};

const SORT_TO_URL: Record<SortField, string> = {
  RELEVANCE: 'relevans',
  RATING: 'rating',
  YEAR: 'ar',
  TITLE: 'tittel',
};
const URL_TO_SORT = Object.fromEntries(
  Object.entries(SORT_TO_URL).map(([field, url]) => [url, field as SortField]),
) as Record<string, SortField>;

const TYPE_TO_URL: Record<TitleType, string> = { MOVIE: 'film', SERIES: 'serie' };
const URL_TO_TYPE: Record<string, TitleType> = { film: 'MOVIE', serie: 'SERIES' };

export const DEFAULT_DIRECTION: Record<SortField, SortDirection> = {
  RELEVANCE: 'DESC',
  RATING: 'DESC',
  YEAR: 'DESC',
  TITLE: 'ASC',
};

const list = (value: string | null) =>
  value
    ? value
        .split(',')
        .map((s) => s.trim())
        .filter(Boolean)
    : [];

const unique = <T>(items: T[]) => [...new Set(items)];

export function parseSearchState(params: URLSearchParams): SearchState {
  const rating = Number(params.get('minRating'));
  const minRating =
    params.get('minRating') !== null && Number.isFinite(rating) && rating > 0 && rating <= 10
      ? rating
      : null;
  const dir = params.get('dir');
  return {
    q: (params.get('q') ?? '').trim(),
    genres: unique(list(params.get('genres'))),
    decades: unique(
      list(params.get('decades'))
        .map(Number)
        .filter((n) => Number.isInteger(n) && n >= 1000 && n <= 2999),
    ),
    types: unique(
      list(params.get('types'))
        .map((t) => URL_TO_TYPE[t])
        .filter((t): t is TitleType => t !== undefined),
    ),
    minRating,
    available: params.get('available') === '1',
    sort: URL_TO_SORT[params.get('sort') ?? ''] ?? null,
    dir: dir === 'asc' ? 'ASC' : dir === 'desc' ? 'DESC' : null,
  };
}

export function serializeSearchState(state: SearchState): URLSearchParams {
  const params = new URLSearchParams();
  if (state.q) params.set('q', state.q);
  if (state.genres.length) params.set('genres', state.genres.join(','));
  if (state.decades.length) params.set('decades', state.decades.join(','));
  if (state.types.length) params.set('types', state.types.map((t) => TYPE_TO_URL[t]).join(','));
  if (state.minRating !== null) params.set('minRating', String(state.minRating));
  if (state.available) params.set('available', '1');
  if (state.sort) params.set('sort', SORT_TO_URL[state.sort]);
  if (state.dir) params.set('dir', state.dir === 'ASC' ? 'asc' : 'desc');
  return params;
}

export function activeFilterCount(state: SearchState): number {
  return (
    state.genres.length +
    state.decades.length +
    state.types.length +
    (state.minRating ? 1 : 0) +
    (state.available ? 1 : 0)
  );
}

/** Tomme filtre utelates helt, så «ingen filtre» og «tomme lister» gir samme cache-nøkkel. */
export function toFilters(state: SearchState): SearchFilters | undefined {
  const filters: SearchFilters = {};
  if (state.genres.length) filters.genres = state.genres;
  if (state.decades.length) filters.decades = state.decades;
  if (state.types.length) filters.types = state.types;
  if (state.minRating !== null) filters.minRating = state.minRating;
  if (state.available) filters.availableOnly = true;
  return Object.keys(filters).length ? filters : undefined;
}

export function toSort(state: SearchState): SortInput | undefined {
  if (!state.sort && !state.dir) return undefined;
  const field = state.sort ?? 'RELEVANCE';
  return { field, direction: state.dir ?? DEFAULT_DIRECTION[field] };
}

/** «Bla-modus»: ingenting i URL-en som begrenser eller sorterer, så forsiden viser rader i stedet for treffliste. */
export function isBrowseState(state: SearchState): boolean {
  return (
    state.q === '' && activeFilterCount(state) === 0 && state.sort === null && state.dir === null
  );
}
