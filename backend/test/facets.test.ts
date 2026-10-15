import { describe, expect, it, vi } from 'vitest';
import { TITLES, TITLE_COUNT } from './fixtures.js';
import { setupApi } from './helpers.js';

const env = setupApi();

const FACETS = /* GraphQL */ `
  query Facets($query: String, $filters: SearchFilters) {
    facets(query: $query, filters: $filters) {
      genres {
        value
        count
      }
      decades {
        value
        count
      }
      types {
        value
        count
      }
    }
  }
`;

const facets = async (vars: Record<string, unknown> = {}) => {
  const res = await env.gql(FACETS, vars);
  expect(res.errors).toBeUndefined();
  const f = res.data!.facets;
  const toMap = (rows: { value: string; count: number }[]) =>
    Object.fromEntries(rows.map((r) => [r.value, r.count]));
  return { genres: toMap(f.genres), decades: toMap(f.decades), types: toMap(f.types), raw: f };
};

describe('facets', () => {
  it('teller alle verdier uten filter', async () => {
    const f = await facets();
    expect(f.types).toEqual({
      MOVIE: TITLES.filter((t) => t.type === 'movie').length,
      SERIES: TITLES.filter((t) => t.type === 'series').length,
    });
    expect(f.genres.Drama).toBe(TITLES.filter((t) => t.genres.includes('Drama')).length);
    expect(f.genres.Western).toBe(TITLES.filter((t) => t.genres.includes('Western')).length);
    // Titler uten år har ingen tiår, så summen er én mindre enn totalen.
    expect(Object.values(f.decades).reduce((a, b) => a + b, 0)).toBe(TITLE_COUNT - 1);
    expect(f.decades['1990']).toBe(
      TITLES.filter((t) => t.year !== null && t.year >= 1990 && t.year < 2000).length,
    );
  });

  it('sorterer sjangre etter antall, tiår kronologisk', async () => {
    const { raw } = await facets();
    const counts = raw.genres.map((g: { count: number }) => g.count);
    expect(counts).toEqual([...counts].sort((a: number, b: number) => b - a));
    const decades = raw.decades.map((d: { value: string }) => Number(d.value));
    expect(decades).toEqual([...decades].sort((a: number, b: number) => a - b));
  });

  it('en dimensjon telles med alle ANDRE filtre, ikke sitt eget', async () => {
    const f = await facets({ filters: { genres: ['Crime'], types: ['SERIES'] } });
    // genres: bare type-filteret gjelder -> alle serier
    const series = TITLES.filter((t) => t.type === 'series');
    expect(f.genres.Drama).toBe(series.filter((t) => t.genres.includes('Drama')).length);
    expect(f.genres.Adventure).toBe(series.filter((t) => t.genres.includes('Adventure')).length);
    // types: bare sjanger-filteret gjelder -> både filmer og serier med Crime
    const crime = TITLES.filter((t) => t.genres.includes('Crime'));
    expect(f.types).toEqual({
      MOVIE: crime.filter((t) => t.type === 'movie').length,
      SERIES: crime.filter((t) => t.type === 'series').length,
    });
    // decades: begge filtre gjelder
    const both = crime.filter((t) => t.type === 'series' && t.year !== null);
    expect(Object.values(f.decades).reduce((a, b) => a + b, 0)).toBe(both.length);
  });

  it('tar hensyn til søketekst og minRating', async () => {
    const f = await facets({ query: 'dark', filters: { minRating: 8 } });
    const expected = TITLES.filter(
      (t) =>
        `${t.primary} ${t.original ?? ''}`.toLowerCase().includes('dark') && (t.rating ?? 0) >= 8,
    );
    expect(Object.values(f.types).reduce((a, b) => a + b, 0)).toBe(expected.length);
    expect(f.genres.Crime).toBe(expected.filter((t) => t.genres.includes('Crime')).length);
  });

  it('viser valgte verdier med 0 treff i stedet for å la dem forsvinne', async () => {
    const f = await facets({
      filters: { genres: ['Western'], decades: [2020], types: ['SERIES'] },
    });
    expect(f.genres.Western).toBe(0);
    expect(f.decades['2020']).toBe(
      TITLES.filter(
        (t) => t.genres.includes('Western') && t.type === 'series' && (t.year ?? 0) >= 2020,
      ).length,
    );
    expect(f.types.SERIES).toBeDefined();
  });

  it('gir tomme lister (ikke feil) når ingenting treffer', async () => {
    const f = await facets({ query: 'zzzqqq' });
    expect(f.raw).toEqual({ genres: [], decades: [], types: [] });
  });

  it('validerer input som search', async () => {
    const long = await env.gql(FACETS, { query: 'a'.repeat(201) });
    expect(long.errors?.[0]?.extensions?.code).toBe('BAD_USER_INPUT');
    const dec = await env.gql(FACETS, { filters: { decades: [1993] } });
    expect(dec.errors?.[0]?.extensions?.code).toBe('BAD_USER_INPUT');
  });

  it('genres-spørringen gir alle sjangre alfabetisk', async () => {
    const res = await env.gql('{ genres }');
    const all = [...new Set(TITLES.flatMap((t) => t.genres))].sort();
    expect(res.data!.genres).toEqual(all);
  });

  // Fasettene uten søketekst er like for alle og koster fire aggregeringer over hele tabellen, så
  // appen holder dem i minnet (facetCache.ts). Her sjekkes at det faktisk sparer databasen.
  it('henter fasetter uten søketekst fra minnet etter første kall, også med filtre', async () => {
    // Appen og cachen deles av hele filen; tøm den så tidligere tester ikke har fylt nøkkelen.
    env.facetCache.clear();
    const spy = vi.spyOn(env.pool, 'query');
    try {
      const first = await facets({ filters: { genres: ['Western'] } });
      const callsAfterFirst = spy.mock.calls.length;
      expect(callsAfterFirst).toBeGreaterThan(0);

      const second = await facets({ filters: { genres: ['Western'] } });
      expect(second.raw).toEqual(first.raw);
      expect(spy.mock.calls.length).toBe(callsAfterFirst);

      // Hvert filter er en del av nøkkelen: å endre ett av dem må telle på nytt.
      let calls = callsAfterFirst;
      const variants = [
        { genres: ['Western'], types: ['MOVIE'] },
        { genres: ['Western'], minRating: 7 },
        { genres: ['Western'], availableOnly: true },
      ];
      for (const filters of variants) {
        await facets({ filters });
        expect(spy.mock.calls.length).toBeGreaterThan(calls);
        calls = spy.mock.calls.length;
      }
    } finally {
      spy.mockRestore();
    }
  });

  it('caches ikke fasetter med søketekst', async () => {
    const spy = vi.spyOn(env.pool, 'query');
    try {
      await facets({ query: 'dark' });
      const callsAfterFirst = spy.mock.calls.length;
      await facets({ query: 'dark' });
      expect(spy.mock.calls.length).toBe(callsAfterFirst * 2);
    } finally {
      spy.mockRestore();
    }
  });
});
