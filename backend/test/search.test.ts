import { describe, expect, it } from 'vitest';
import { TITLES, TITLE_COUNT } from './fixtures.js';
import { setupApi } from './helpers.js';
import { SEARCH } from './queries.js';

const env = setupApi();

const idsMatching = (pred: (t: (typeof TITLES)[number]) => boolean) =>
  TITLES.filter(pred)
    .map((t) => t.id)
    .sort();

const search = async (vars: Record<string, unknown>) => {
  const res = await env.gql(SEARCH, { first: 50, ...vars });
  const conn = res.data?.search;
  return {
    res,
    ids: (conn?.edges ?? []).map((e: { node: { id: string } }) => e.node.id) as string[],
    total: conn?.totalCount as number | undefined,
    titles: (conn?.edges ?? []).map(
      (e: { node: { primaryTitle: string } }) => e.node.primaryTitle,
    ) as string[],
  };
};

describe('search: tekst', () => {
  it('finner delstrenger case-insensitivt i primær- og originaltittel', async () => {
    const expected = idsMatching((t) =>
      `${t.primary} ${t.original ?? ''}`.toLowerCase().includes('dark'),
    );
    for (const q of ['dark', 'DARK', 'DaRk']) {
      const r = await search({ query: q });
      expect([...r.ids].sort()).toEqual(expected);
      expect(r.total).toBe(expected.length);
    }
    expect(expected.length).toBeGreaterThanOrEqual(5);
  });

  it('rangerer eksakt treff først ved relevans', async () => {
    const r = await search({ query: 'dark' });
    expect(r.titles[0]).toBe('Dark');
  });

  it('søker i originaltittel', async () => {
    expect((await search({ query: 'fabuleux' })).titles).toEqual(['Amélie']);
    expect((await search({ query: 'Ça' })).titles).toEqual(['It']);
  });

  it.each([null, '', '   ', '\t\n'])('tomt søk %j gir alle titler', async (q) => {
    const r = await search({ query: q, first: 50 });
    expect(r.total).toBe(TITLE_COUNT);
    expect(r.ids).toHaveLength(TITLE_COUNT);
  });

  it('gir tomt resultat uten feil når ingenting treffer', async () => {
    const res = await env.gql(SEARCH, { query: 'zzzqqqxxx', first: 10 });
    expect(res.errors).toBeUndefined();
    expect(res.data!.search).toEqual({
      totalCount: 0,
      pageInfo: { hasNextPage: false, endCursor: null },
      edges: [],
    });
  });

  it.each([
    ['%', ['100% Pure']],
    ['_', ['Under_score Story']],
    ['0% P', ['100% Pure']],
    ['er_sc', ['Under_score Story']],
    ["'", ['Amélie', "Don't Look Up", "O'Brien's Odyssey"]],
    ['"', ['Say "Cheese"']],
    ['\\', ['Back\\Slash']],
    ['🎬', ['Emoji 🎬 Night']],
    ['amélie', ['Amélie']],
    ['CAFÉ', ['Café Society']],
    ["Don't", ["Don't Look Up"]],
  ])('behandler spesialtegn %j som vanlig tekst', async (q, expected) => {
    const r = await search({ query: q });
    expect(r.res.errors).toBeUndefined();
    expect([...r.titles].sort()).toEqual([...expected].sort());
  });

  it('er immun mot SQL-injeksjon i søketeksten', async () => {
    for (const q of ["'; DROP TABLE titles; --", "' OR '1'='1", '") OR 1=1 --']) {
      const r = await search({ query: q });
      expect(r.res.errors).toBeUndefined();
      expect(r.total).toBe(0);
    }
    expect((await search({})).total).toBe(TITLE_COUNT);
  });

  it('avviser query over 200 tegn, godtar nøyaktig 200', async () => {
    for (const len of [201, 10_000]) {
      const res = await env.gql(SEARCH, { query: 'a'.repeat(len), first: 5 });
      expect(res.errors?.[0]?.extensions?.code).toBe('BAD_USER_INPUT');
      expect(res.data).toBeNull();
    }
    const ok = await env.gql(SEARCH, { query: 'a'.repeat(200), first: 5 });
    expect(ok.errors).toBeUndefined();
  });

  it('avviser NUL-tegn i søketeksten som brukerfeil', async () => {
    const res = await env.gql(SEARCH, { query: 'a\u0000b', first: 5 });
    expect(res.errors?.[0]?.extensions?.code).toBe('BAD_USER_INPUT');
  });
});

describe('search: filtre', () => {
  it('genres krever ALLE valgte sjangre', async () => {
    const drama = await search({ filters: { genres: ['Drama'] } });
    expect([...drama.ids].sort()).toEqual(idsMatching((t) => t.genres.includes('Drama')));
    const both = await search({ filters: { genres: ['Crime', 'Drama'] } });
    expect([...both.ids].sort()).toEqual(
      idsMatching((t) => t.genres.includes('Crime') && t.genres.includes('Drama')),
    );
    expect(both.total).toBe(3);
  });

  it('ukjent sjanger gir 0 treff', async () => {
    expect((await search({ filters: { genres: ['Finnes Ikke'] } })).total).toBe(0);
  });

  it('decades: flere tiår er ELLER', async () => {
    const one = await search({ filters: { decades: [1990] } });
    expect([...one.ids].sort()).toEqual(
      idsMatching((t) => t.year !== null && t.year >= 1990 && t.year < 2000),
    );
    const two = await search({ filters: { decades: [1990, 2010] } });
    expect([...two.ids].sort()).toEqual(
      idsMatching((t) => t.year !== null && [1990, 2010].includes(Math.floor(t.year / 10) * 10)),
    );
  });

  it('types: MOVIE, SERIES og begge', async () => {
    const series = await search({ filters: { types: ['SERIES'] } });
    expect([...series.ids].sort()).toEqual(idsMatching((t) => t.type === 'series'));
    expect((await search({ filters: { types: ['MOVIE', 'SERIES'] } })).total).toBe(TITLE_COUNT);
    expect((await search({ filters: { types: ['MOVIE'] } })).total).toBe(
      TITLES.filter((t) => t.type === 'movie').length,
    );
  });

  it('minRating er >= og utelater titler uten rating', async () => {
    const r = await search({ filters: { minRating: 8 } });
    expect([...r.ids].sort()).toEqual(idsMatching((t) => t.rating !== null && t.rating >= 8));
    expect(r.ids).not.toContain('tt0000019');
    // 0 betyr ingen grense, også for titler uten rating
    expect((await search({ filters: { minRating: 0 } })).total).toBe(TITLE_COUNT);
  });

  it('kombinerer søketekst og alle filtre', async () => {
    const filters = { genres: ['Drama'], decades: [2000, 2010], types: ['MOVIE'], minRating: 7 };
    const r = await search({ query: 'dark', filters });
    expect(r.titles.sort()).toEqual(['Dark Waters', 'The Dark Knight']);
    const none = await search({ query: 'dark', filters: { ...filters, minRating: 9.5 } });
    expect(none.total).toBe(0);
  });

  it.each([
    ['tiår som ikke er helt', { decades: [1995] }],
    ['tiår utenfor rimelig område', { decades: [3000] }],
    ['minRating over 10', { minRating: 10.5 }],
    ['negativ minRating', { minRating: -1 }],
    ['tom sjangerstreng', { genres: [''] }],
  ])('avviser ugyldig filter: %s', async (_navn, filters) => {
    const res = await env.gql(SEARCH, { filters, first: 5 });
    expect(res.errors?.[0]?.extensions?.code).toBe('BAD_USER_INPUT');
  });

  it('tomme filterlister betyr «ingen filter»', async () => {
    const r = await search({ filters: { genres: [], decades: [], types: [] } });
    expect(r.total).toBe(TITLE_COUNT);
  });
});

describe('search: felter og feil', () => {
  it('returnerer alle kontraktsfeltene', async () => {
    const r = await env.gql(SEARCH, { query: 'Breaking Bad', first: 1 });
    expect(r.data!.search.edges[0].node).toEqual({
      id: 'tt0000015',
      primaryTitle: 'Breaking Bad',
      originalTitle: 'Breaking Bad',
      type: 'SERIES',
      startYear: 2008,
      endYear: 2013,
      genres: ['Crime', 'Drama', 'Thriller'],
      averageRating: 9.5,
      numVotes: 2200000,
    });
  });

  it('null i valgfrie felt (år, rating)', async () => {
    const r = await search({ query: 'Unknown Year' });
    expect(r.ids).toEqual(['tt0000018']);
    const res = await env.gql(SEARCH, { query: 'Unrated Film', first: 1 });
    expect(res.data!.search.edges[0].node.averageRating).toBeNull();
  });

  it.each([0, 51, -3, 1000])('avviser first=%s', async (first) => {
    const res = await env.gql(SEARCH, { first });
    expect(res.errors?.[0]?.extensions?.code).toBe('BAD_USER_INPUT');
  });

  it('bruker first=20 som standard, og godtar grensene 1 og 50', async () => {
    const def = await env.gql(`{ search { edges { cursor } pageInfo { hasNextPage } } }`);
    expect(def.data!.search.edges).toHaveLength(20);
    expect(def.data!.search.pageInfo.hasNextPage).toBe(true);
    expect((await search({ first: 1 })).ids).toHaveLength(1);
    expect((await search({ first: 50 })).ids).toHaveLength(TITLE_COUNT);
  });

  it.each(['ikke-en-cursor', '%%%', 'e30', Buffer.from('{"s":"x","v":[]}').toString('base64url')])(
    'avviser ugyldig cursor %j',
    async (after) => {
      const res = await env.gql(SEARCH, { first: 5, after });
      expect(res.errors?.[0]?.extensions?.code).toBe('BAD_USER_INPUT');
    },
  );

  it('avviser cursor brukt med en annen sortering eller søketekst', async () => {
    const first = await env.gql(SEARCH, { first: 2, sort: { field: 'RATING' } });
    const cursor = first.data!.search.pageInfo.endCursor as string;
    for (const other of [
      { sort: { field: 'YEAR' } },
      { sort: { field: 'RATING', direction: 'ASC' } },
      { sort: { field: 'RATING' }, query: 'dark' },
    ]) {
      const res = await env.gql(SEARCH, { first: 2, after: cursor, ...other });
      expect(res.errors?.[0]?.extensions?.code).toBe('BAD_USER_INPUT');
    }
  });

  it('gir syntaks- og valideringsfeil uten å krasje', async () => {
    const syntax = await env.gql('{ search( ');
    expect(syntax.errors).toBeDefined();
    const unknown = await env.gql('{ finnesIkke }');
    expect(unknown.errors).toBeDefined();
    const badEnum = await env.gql(SEARCH, { sort: { field: 'PRICE' } });
    expect(badEnum.errors).toBeDefined();
  });
});
