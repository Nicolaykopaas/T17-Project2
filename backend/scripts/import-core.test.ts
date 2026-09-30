import { describe, expect, it } from 'vitest';
import {
  isHeaderLine,
  mapTitleType,
  parseBasicsLine,
  parseRatingLine,
  type Rating,
} from './import-core.js';

const ratings = new Map<string, Rating>([
  ['tt1', { averageRating: 8.1, numVotes: 5000 }],
  ['tt2', { averageRating: 5, numVotes: 99 }],
]);

const basics = (o: Partial<Record<string, string>> = {}) =>
  [
    o.tconst ?? 'tt1',
    o.type ?? 'movie',
    o.primary ?? 'Amélie',
    o.original ?? 'Le Fabuleux Destin d’Amélie Poulain',
    '0',
    o.start ?? '2001',
    o.end ?? '\\N',
    o.runtime ?? '122',
    o.genres ?? 'Comedy,Romance',
  ].join('\t');

describe('parseRatingLine', () => {
  it('parser gyldig linje', () => {
    expect(parseRatingLine('tt0111161\t9.3\t2900000')).toEqual({
      tconst: 'tt0111161',
      rating: { averageRating: 9.3, numVotes: 2900000 },
    });
  });
  it.each(['', 'tt1\t9.3', 'tt1\tabc\t5', 'tt1\t9.3\t-5', 'tt1\t11.0\t5', 'tt1\t\\N\t\\N'])(
    'forkaster %j',
    (line) => expect(parseRatingLine(line)).toBeNull(),
  );
});

describe('parseBasicsLine', () => {
  it('parser en film', () => {
    expect(parseBasicsLine(basics(), ratings, 100)).toEqual({
      id: 'tt1',
      titleType: 'movie',
      primaryTitle: 'Amélie',
      originalTitle: 'Le Fabuleux Destin d’Amélie Poulain',
      startYear: 2001,
      endYear: null,
      runtimeMinutes: 122,
      averageRating: 8.1,
      numVotes: 5000,
      genres: ['Comedy', 'Romance'],
    });
  });
  it('mapper tvSeries og tvMiniSeries til series', () => {
    expect(parseBasicsLine(basics({ type: 'tvSeries', end: '2013' }), ratings, 100)).toMatchObject({
      titleType: 'series',
      endYear: 2013,
    });
    expect(parseBasicsLine(basics({ type: 'tvMiniSeries' }), ratings, 100)?.titleType).toBe(
      'series',
    );
  });
  it.each(['tvEpisode', 'short', 'video', 'videoGame', 'tvMovie', 'tvSpecial'])(
    'hopper over typen %s',
    (type) => expect(parseBasicsLine(basics({ type }), ratings, 100)).toBeNull(),
  );
  it('hopper over titler med for få stemmer eller uten rating', () => {
    expect(parseBasicsLine(basics({ tconst: 'tt2' }), ratings, 100)).toBeNull();
    expect(parseBasicsLine(basics({ tconst: 'tt2' }), ratings, 50)).not.toBeNull();
    expect(parseBasicsLine(basics({ tconst: 'tt404' }), ratings, 1)).toBeNull();
  });
  it('håndterer \\N som null', () => {
    const row = parseBasicsLine(
      basics({ start: '\\N', runtime: '\\N', genres: '\\N', original: '\\N' }),
      ratings,
      100,
    );
    expect(row).toMatchObject({
      startYear: null,
      runtimeMinutes: null,
      genres: [],
      originalTitle: 'Amélie',
    });
  });
  it('forkaster ødelagte linjer og ugyldige tall blir null', () => {
    expect(parseBasicsLine('tt1\tmovie\tBare tre', ratings, 100)).toBeNull();
    expect(parseBasicsLine(basics({ primary: '\\N' }), ratings, 100)).toBeNull();
    expect(parseBasicsLine(basics({ start: 'abcd' }), ratings, 100)?.startYear).toBeNull();
  });
  it('fjerner duplikate sjangre og bevarer spesialtegn i tittel', () => {
    const row = parseBasicsLine(
      basics({ genres: 'Drama,Drama, Crime', primary: 'Don\'t "Q"; DROP' }),
      ratings,
      100,
    );
    expect(row?.genres).toEqual(['Drama', 'Crime']);
    expect(row?.primaryTitle).toBe('Don\'t "Q"; DROP');
  });
});

describe('hjelpefunksjoner', () => {
  it('kjenner igjen overskrift', () => {
    expect(isHeaderLine('tconst\ttitleType\tprimaryTitle')).toBe(true);
    expect(isHeaderLine('tt1\tmovie')).toBe(false);
  });
  it('mapTitleType', () => {
    expect(mapTitleType('movie')).toBe('movie');
    expect(mapTitleType('tvEpisode')).toBeNull();
  });
});
