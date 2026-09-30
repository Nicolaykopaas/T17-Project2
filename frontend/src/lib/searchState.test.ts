import { describe, expect, it } from 'vitest';
import {
  EMPTY_STATE,
  activeFilterCount,
  isBrowseState,
  parseSearchState,
  serializeSearchState,
  toFilters,
  toSort,
} from './searchState';

const parse = (qs: string) => parseSearchState(new URLSearchParams(qs));

describe('searchState', () => {
  it('leser alle parametre', () => {
    expect(
      parse(
        'q=alien&genres=Action,Drama&decades=1990,2000&types=film,serie&minRating=7&available=1&sort=ar&dir=asc',
      ),
    ).toEqual({
      q: 'alien',
      genres: ['Action', 'Drama'],
      decades: [1990, 2000],
      types: ['MOVIE', 'SERIES'],
      minRating: 7,
      available: true,
      sort: 'YEAR',
      dir: 'ASC',
    });
  });

  it('ignorerer ugyldige verdier i stedet for å krasje', () => {
    const state = parse('decades=abc,1990,99999&types=bok&minRating=-3&sort=x&dir=opp');
    expect(state).toMatchObject({
      decades: [1990],
      types: [],
      minRating: null,
      sort: null,
      dir: null,
    });
    expect(parse('minRating=NaN').minRating).toBeNull();
    expect(parse('minRating=11').minRating).toBeNull();
  });

  it('runder tur uten tap', () => {
    const state = parse('q=x&genres=Action&sort=tittel&dir=desc&minRating=8');
    expect(parseSearchState(serializeSearchState(state))).toEqual(state);
  });

  it('leser available=1 fra URL, og bare akkurat 1', () => {
    expect(parse('available=1').available).toBe(true);
    expect(parse('available=true').available).toBe(false);
    expect(parse('available=0').available).toBe(false);
    expect(parse('').available).toBe(false);
  });

  it('available gir availableOnly som filter, teller som aktivt filter og runder tur', () => {
    const state = parse('available=1');
    expect(toFilters(state)).toEqual({ availableOnly: true });
    expect(activeFilterCount(state)).toBe(1);
    expect(isBrowseState(state)).toBe(false);
    expect(serializeSearchState(state).toString()).toBe('available=1');
    expect(toFilters({ ...EMPTY_STATE, available: false })).toBeUndefined();
  });

  it('serialiserer bare det som er satt', () => {
    expect(serializeSearchState(EMPTY_STATE).toString()).toBe('');
  });

  it('utelater tomme filtre og sortering som variabler', () => {
    expect(toFilters(EMPTY_STATE)).toBeUndefined();
    expect(toSort(EMPTY_STATE)).toBeUndefined();
  });

  it('bruker feltets standardretning når bare felt er valgt', () => {
    expect(toSort({ ...EMPTY_STATE, sort: 'TITLE' })).toEqual({ field: 'TITLE', direction: 'ASC' });
    expect(toSort({ ...EMPTY_STATE, sort: 'RATING' })).toEqual({
      field: 'RATING',
      direction: 'DESC',
    });
  });
});
