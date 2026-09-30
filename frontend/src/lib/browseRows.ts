import {
  EMPTY_STATE,
  serializeSearchState,
  toFilters,
  toSort,
  type SearchState,
} from './searchState';

export interface BrowseRow {
  id: string;
  heading: string;
  /** Radens søk. Variablene og «Se alle»-lenken utledes begge herfra, så de aldri kan skille lag. */
  state: SearchState;
}

const row = (id: string, heading: string, patch: Partial<SearchState>): BrowseRow => ({
  id,
  heading,
  state: { ...EMPTY_STATE, ...patch },
});

// Sortering og filtrering gjøres av serveren via variablene under; klienten sorterer aldri selv.
export const BROWSE_ROWS: BrowseRow[] = [
  row('popular', 'Mest populære', { sort: 'RELEVANCE' }),
  // Høyt oppe fordi dette er det eneste i appen man faktisk kan spille av.
  row('free', 'Se gratis nå', { available: true, sort: 'RELEVANCE' }),
  row('top-movies', 'Høyest rangerte filmer', { types: ['MOVIE'], sort: 'RATING' }),
  row('series', 'Populære serier', { types: ['SERIES'], sort: 'RELEVANCE' }),
  row('action', 'Action', { genres: ['Action'] }),
  row('comedy', 'Komedie', { genres: ['Comedy'] }),
  row('drama', 'Drama', { genres: ['Drama'] }),
  row('scifi', 'Science fiction', { genres: ['Sci-Fi'] }),
];

export const ROW_SIZE = 20;

export function rowVariables(state: SearchState) {
  return {
    query: null,
    filters: toFilters(state),
    sort: toSort(state),
    first: ROW_SIZE,
  };
}

export function seeAllSearch(state: SearchState): string {
  return `/?${serializeSearchState(state).toString()}`;
}
