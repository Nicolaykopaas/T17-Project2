import { describe, expect, it } from 'vitest';
import {
  isPlausibleTitleId,
  parseUserId,
  validateFilters,
  validateFirst,
  validateQuery,
  validateReview,
} from './validation.js';

describe('parseUserId', () => {
  it('godtar UUID og normaliserer til små bokstaver', () => {
    expect(parseUserId('3F2504E0-4F89-41D3-9A0C-0305E82C3301')).toBe(
      '3f2504e0-4f89-41d3-9a0c-0305e82c3301',
    );
  });
  it.each([
    undefined,
    null,
    '',
    'abc',
    '3f2504e0-4f89-41d3-9a0c-0305e82c330',
    "'; DROP TABLE x;--",
  ])('gir null for %j', (v) => expect(parseUserId(v)).toBeNull());
});

describe('validateFirst', () => {
  it('bruker 20 som standard og godtar 1–50', () => {
    expect(validateFirst(undefined)).toBe(20);
    expect(validateFirst(1)).toBe(1);
    expect(validateFirst(50)).toBe(50);
  });
  it.each([0, 51, -1, 1.5, NaN])('avviser %s', (n) => expect(() => validateFirst(n)).toThrow());
});

describe('validateQuery', () => {
  it('trimmer og gjør tom streng til null', () => {
    expect(validateQuery('  dark ')).toBe('dark');
    expect(validateQuery('   ')).toBeNull();
    expect(validateQuery(null)).toBeNull();
  });
  it('avviser for lange strenger og NUL, men teller emoji som ett tegn', () => {
    expect(() => validateQuery('a'.repeat(201))).toThrow();
    expect(() => validateQuery('a\0b')).toThrow();
    expect(validateQuery('🎬'.repeat(200))).not.toBeNull();
  });
});

describe('validateFilters', () => {
  it('normaliserer typer og fjerner duplikater', () => {
    expect(
      validateFilters({ types: ['MOVIE', 'MOVIE', 'SERIES'], genres: ['Drama', 'Drama'] }),
    ).toMatchObject({
      types: ['movie', 'series'],
      genres: ['Drama'],
    });
  });
  it.each([1995, 1790, 2200])('avviser tiår %s', (d) =>
    expect(() => validateFilters({ decades: [d] })).toThrow(),
  );
  it.each([-1, 10.1, NaN])('avviser minRating %s', (r) =>
    expect(() => validateFilters({ minRating: r })).toThrow(),
  );
  it('minRating 0 betyr ingen grense', () => {
    expect(validateFilters({ minRating: 0 }).minRating).toBeNull();
  });
});

describe('validateReview', () => {
  const ok = { titleId: 'tt1', author: ' Kari ', rating: 5, text: ' Bra! ' };
  it('trimmer', () => expect(validateReview(ok)).toMatchObject({ author: 'Kari', text: 'Bra!' }));
  it('avviser ugyldige felt', () => {
    expect(() => validateReview({ ...ok, author: '   ' })).toThrow();
    expect(() => validateReview({ ...ok, author: 'x'.repeat(51) })).toThrow();
    expect(() => validateReview({ ...ok, rating: 0 })).toThrow();
    expect(() => validateReview({ ...ok, rating: 6 })).toThrow();
    expect(() => validateReview({ ...ok, text: 'x'.repeat(2001) })).toThrow();
  });
});

describe('isPlausibleTitleId', () => {
  it.each(['tt0111161', 'tt1234567', 'tt12345678', 'tt1234567890'])('godtar %s', (id) =>
    expect(isPlausibleTitleId(id)).toBe(true),
  );
  it.each([
    '',
    'tt',
    'tt123456',
    'tt12345678901',
    'TT0111161',
    'nm0000001',
    '0111161',
    'tt011116a',
    'tt0111161\n',
    ' tt0111161',
    'tt0111161\0',
    "tt0111161' OR 1=1",
    'tt' + '1'.repeat(1000),
  ])('avviser %j', (id) => expect(isPlausibleTitleId(id)).toBe(false));
});
