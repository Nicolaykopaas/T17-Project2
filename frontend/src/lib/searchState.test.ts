import { describe, expect, it } from 'vitest';
import {
  EMPTY_STATE,
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
        'q=alien&genres=Action,Drama&decades=1990,2000&types=film,serie&minRating=7&sort=ar&dir=asc',
      ),
    ).toEqual({
      q: 'alien',
      genres: ['Action', 'Drama'],
      decades: [1990, 2000],
      types: ['MOVIE', 'SERIES'],
      minRating: 7,
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
