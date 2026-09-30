import { describe, expect, it } from 'vitest';
import { TITLE_COUNT } from './fixtures.js';
import { setupApi } from './helpers.js';
import { collectIds, SEARCH } from './queries.js';

const env = setupApi();

/** Fasit: rekkefølgen Postgres selv gir med samme sorteringsnøkler, uavhengig av cursor-koden. */
const REFERENCE: Record<string, string> = {
  'RATING DESC': 'COALESCE(average_rating,-1) DESC, num_votes DESC, id DESC',
  'RATING ASC': 'COALESCE(average_rating,-1) ASC, num_votes ASC, id ASC',
  'YEAR DESC': 'COALESCE(start_year,0) DESC, num_votes DESC, id DESC',
  'YEAR ASC': 'COALESCE(start_year,0) ASC, num_votes ASC, id ASC',
  'TITLE ASC': 'lower(primary_title) ASC, id ASC',
  'TITLE DESC': 'lower(primary_title) DESC, id DESC',
  'RELEVANCE DESC': 'num_votes DESC, id DESC',
  'RELEVANCE ASC': 'num_votes ASC, id ASC',
};

describe('paginering og sortering', () => {
  it.each(Object.keys(REFERENCE))(
    '%s: alle sider gir hele settet i riktig rekkefølge',
    async (key) => {
      const [field, direction] = key.split(' ') as [string, string];
      const { rows } = await env.pool.query<{ id: string }>(
        `SELECT id FROM titles ORDER BY ${REFERENCE[key]}`,
      );
      const expected = rows.map((r) => r.id);
      for (const pageSize of [1, 7, 50]) {
        const got = await collectIds(env, { sort: { field, direction } }, pageSize);
        expect(got.ids, `pageSize ${pageSize}`).toEqual(expected);
        expect(new Set(got.ids).size).toBe(TITLE_COUNT);
        expect(got.total).toBe(TITLE_COUNT);
      }
    },
  );

  it('standardretning per felt følger kontrakten', async () => {
    const dir = async (field: string, direction?: string) =>
      (await collectIds(env, { sort: { field, direction } }, 50)).ids;
    expect(await dir('RATING')).toEqual(await dir('RATING', 'DESC'));
    expect(await dir('YEAR')).toEqual(await dir('YEAR', 'DESC'));
    expect(await dir('TITLE')).toEqual(await dir('TITLE', 'ASC'));
    expect(await dir('RELEVANCE')).toEqual(await dir('RELEVANCE', 'DESC'));
    const noSort = (await collectIds(env, {}, 50)).ids;
    expect(noSort).toEqual(await dir('RELEVANCE', 'DESC'));
  });

  it('titler uten rating/år er med i sorteringene (ingen forsvunne rader)', async () => {
    for (const field of ['RATING', 'YEAR']) {
      for (const direction of ['ASC', 'DESC']) {
        const { ids } = await collectIds(env, { sort: { field, direction } }, 4);
        expect(ids).toContain(field === 'RATING' ? 'tt0000019' : 'tt0000018');
      }
    }
  });

  it.each(['RELEVANCE', 'RATING', 'YEAR', 'TITLE'])(
    'søk + filter + %s gir stabile sider uten duplikater',
    async (field) => {
      for (const direction of ['ASC', 'DESC']) {
        const vars = {
          query: 'a',
          filters: { types: ['MOVIE', 'SERIES'], minRating: 3 },
          sort: { field, direction },
        };
        const single = await collectIds(env, vars, 50);
        const paged = await collectIds(env, vars, 5);
        expect(paged.ids).toEqual(single.ids);
        expect(new Set(paged.ids).size).toBe(paged.ids.length);
        expect(paged.total).toBe(single.ids.length);
      }
    },
  );

  it('relevans med søketekst følger vektet ord-likhet, likhet og popularitet, deretter stemmer', async () => {
    // Uavhengig gjengivelse av formelen i search.ts – fanger opp utilsiktede endringer i rangeringen.
    const { rows } = await env.pool.query<{ id: string; rel: number; num_votes: number }>(
      `SELECT id, num_votes,
              (0.6 * GREATEST(word_similarity('dark', lower(primary_title)), word_similarity('dark', lower(original_title)))
               + 0.2 * GREATEST(similarity(lower(primary_title), 'dark'), similarity(lower(original_title), 'dark'))
               + 0.2 * LEAST(log(GREATEST(num_votes, 1)) / 7.0, 1.0))::float8 AS rel
       FROM titles WHERE lower(primary_title) LIKE '%dark%' OR lower(original_title) LIKE '%dark%'
       ORDER BY rel DESC, num_votes DESC, id DESC`,
    );
    const paged = await collectIds(env, { query: 'dark', sort: { field: 'RELEVANCE' } }, 2);
    expect(paged.ids).toEqual(rows.map((r) => r.id));
    const asc = await collectIds(
      env,
      { query: 'dark', sort: { field: 'RELEVANCE', direction: 'ASC' } },
      2,
    );
    expect(asc.ids).toEqual([...rows].reverse().map((r) => r.id));
  });

  it('siste side har hasNextPage=false og endCursor for siste rad', async () => {
    const r = await env.gql(SEARCH, { first: TITLE_COUNT });
    expect(r.data!.search.pageInfo.hasNextPage).toBe(false);
    const edges = r.data!.search.edges;
    expect(r.data!.search.pageInfo.endCursor).toBe(edges[edges.length - 1].cursor);
    const beyond = await env.gql(SEARCH, { first: 5, after: edges[edges.length - 1].cursor });
    expect(beyond.data!.search.edges).toEqual([]);
    expect(beyond.data!.search.pageInfo).toEqual({ hasNextPage: false, endCursor: null });
  });

  it('exakt fullt sett (first == antall) gir hasNextPage=false', async () => {
    const r = await env.gql(SEARCH, { first: 50, filters: { types: ['SERIES'] } });
    expect(r.data!.search.pageInfo.hasNextPage).toBe(false);
  });
});
