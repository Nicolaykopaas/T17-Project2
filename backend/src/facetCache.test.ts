import { describe, expect, it, vi } from 'vitest';
import { FacetCache, facetCacheKey } from './facetCache.js';
import type { Filters } from './validation.js';

const NONE: Filters = { genres: [], decades: [], types: [], minRating: null, availableOnly: false };

describe('FacetCache', () => {
  it('laster én gang og gir samme svar til levetiden er ute', async () => {
    let now = 0;
    const cache = new FacetCache<number>({ ttlMs: 1000, now: () => now });
    const load = vi.fn().mockResolvedValueOnce(1).mockResolvedValueOnce(2);

    expect(await cache.get('k', load)).toBe(1);
    now = 999;
    expect(await cache.get('k', load)).toBe(1);
    expect(load).toHaveBeenCalledTimes(1);

    now = 1000;
    expect(await cache.get('k', load)).toBe(2);
    expect(load).toHaveBeenCalledTimes(2);
  });

  it('samtidige kall for samme nøkkel deler én lasting', async () => {
    const cache = new FacetCache<string>();
    let resolve!: (v: string) => void;
    const load = vi.fn(() => new Promise<string>((r) => (resolve = r)));

    const a = cache.get('k', load);
    const b = cache.get('k', load);
    resolve('svar');

    expect(await Promise.all([a, b])).toEqual(['svar', 'svar']);
    expect(load).toHaveBeenCalledTimes(1);
  });

  it('husker ikke feil: neste kall prøver databasen igjen', async () => {
    const cache = new FacetCache<number>();
    const load = vi.fn().mockRejectedValueOnce(new Error('nede')).mockResolvedValueOnce(7);

    await expect(cache.get('k', load)).rejects.toThrow('nede');
    expect(cache.size).toBe(0);
    expect(await cache.get('k', load)).toBe(7);
    expect(load).toHaveBeenCalledTimes(2);
  });

  it('en feilet gammel lasting fjerner ikke en nyere, vellykket oppføring', async () => {
    let now = 0;
    const cache = new FacetCache<number>({ ttlMs: 10, now: () => now });
    let reject!: (e: Error) => void;
    const slow = cache.get('k', () => new Promise<number>((_, r) => (reject = r)));
    now = 10; // den første er utløpt; neste kall laster på nytt
    expect(await cache.get('k', () => Promise.resolve(5))).toBe(5);

    reject(new Error('sent'));
    await expect(slow).rejects.toThrow('sent');
    expect(cache.size).toBe(1);
    expect(await cache.get('k', () => Promise.resolve(6))).toBe(5);
  });

  it('kaster ut minst nylig brukte nøkkel over grensen', async () => {
    const cache = new FacetCache<string>({ maxEntries: 2 });
    await cache.get('a', () => Promise.resolve('a1'));
    await cache.get('b', () => Promise.resolve('b1'));
    await cache.get('a', () => Promise.resolve('a2')); // a blir nylig brukt
    await cache.get('c', () => Promise.resolve('c1')); // b kastes ut

    expect(cache.size).toBe(2);
    expect(await cache.get('a', () => Promise.resolve('a3'))).toBe('a1');
    expect(await cache.get('b', () => Promise.resolve('b2'))).toBe('b2');
  });

  it('clear tømmer alt', async () => {
    const cache = new FacetCache<number>();
    await cache.get('k', () => Promise.resolve(1));
    cache.clear();
    expect(await cache.get('k', () => Promise.resolve(2))).toBe(2);
  });
});

describe('facetCacheKey', () => {
  it('caches ikke når det er søketekst', () => {
    expect(facetCacheKey('dark', NONE)).toBeNull();
  });

  it('gir samme nøkkel uansett rekkefølge i filtrene', () => {
    const a = facetCacheKey(null, {
      ...NONE,
      genres: ['Drama', 'Action'],
      decades: [2000, 1990],
      types: ['series', 'movie'],
    });
    const b = facetCacheKey(null, {
      ...NONE,
      genres: ['Action', 'Drama'],
      decades: [1990, 2000],
      types: ['movie', 'series'],
    });
    expect(a).toBe(b);
  });

  it('slår sammen duplikater i filtrene', () => {
    const dup = facetCacheKey(null, {
      ...NONE,
      genres: ['Drama', 'Drama'],
      decades: [1990, 1990],
      types: ['movie', 'movie'],
    });
    const single = facetCacheKey(null, {
      ...NONE,
      genres: ['Drama'],
      decades: [1990],
      types: ['movie'],
    });
    expect(dup).toBe(single);
  });

  it('skiller på hvert filter', () => {
    const keys = [
      NONE,
      { ...NONE, genres: ['Drama'] },
      { ...NONE, decades: [1990] },
      { ...NONE, types: ['movie' as const] },
      { ...NONE, minRating: 8 },
      { ...NONE, availableOnly: true },
    ].map((f) => facetCacheKey(null, f));
    expect(new Set(keys).size).toBe(keys.length);
  });
});
