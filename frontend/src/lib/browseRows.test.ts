import { describe, expect, it } from 'vitest';
import { BROWSE_ROWS, rowVariables, seeAllSearch } from './browseRows';
import { isBrowseState, parseSearchState, toFilters, toSort, EMPTY_STATE } from './searchState';

describe('BROWSE_ROWS', () => {
  it('har unike id-er og ingen rad som selv er bla-modus (Se alle må gi søkemodus)', () => {
    expect(new Set(BROWSE_ROWS.map((r) => r.id)).size).toBe(BROWSE_ROWS.length);
    for (const row of BROWSE_ROWS) expect(isBrowseState(row.state)).toBe(false);
  });

  it('«Se alle» gir nøyaktig samme filtre og sortering som radens variabler', () => {
    for (const row of BROWSE_ROWS) {
      const url = new URL(seeAllSearch(row.state), 'http://x');
      const parsed = parseSearchState(url.searchParams);
      const vars = rowVariables(row.state);
      expect(toFilters(parsed)).toEqual(vars.filters);
      expect(toSort(parsed)).toEqual(vars.sort);
      expect(vars.first).toBe(20);
      expect(vars.query).toBeNull();
    }
  });

  it('kjenner igjen bla-modus', () => {
    expect(isBrowseState(EMPTY_STATE)).toBe(true);
    expect(isBrowseState({ ...EMPTY_STATE, q: 'x' })).toBe(false);
    expect(isBrowseState({ ...EMPTY_STATE, sort: 'TITLE' })).toBe(false);
    expect(isBrowseState({ ...EMPTY_STATE, minRating: 7 })).toBe(false);
  });
});
