/* eslint-disable @typescript-eslint/no-explicit-any -- dynamiske GraphQL-svar */
import { describe, expect, it, vi } from 'vitest';
import { setupApi, type GqlResult, USER_A, USER_B } from './helpers.js';
import { SEARCH } from './queries.js';

const env = setupApi();

const TITLE = /* GraphQL */ `
  query Title($id: ID!, $first: Int, $after: String) {
    title(id: $id) {
      id
      primaryTitle
      type
      startYear
      endYear
      runtimeMinutes
      genres
      averageRating
      numVotes
      userRating
      reviewCount
      inMyList
      reviews(first: $first, after: $after) {
        totalCount
        pageInfo {
          hasNextPage
          endCursor
        }
        edges {
          cursor
          node {
            id
            titleId
            author
            rating
            text
            createdAt
            isMine
          }
        }
      }
    }
  }
`;

describe('title', () => {
  it('returnerer detaljer', async () => {
    const res = await env.gql(TITLE, { id: 'tt0000001' });
    expect(res.errors).toBeUndefined();
    expect(res.data!.title).toMatchObject({
      id: 'tt0000001',
      primaryTitle: 'The Dark Knight',
      type: 'MOVIE',
      startYear: 2008,
      endYear: null,
      genres: ['Action', 'Crime', 'Drama'],
      averageRating: 9,
      numVotes: 2800000,
      userRating: null,
      reviewCount: 0,
      inMyList: false,
    });
    expect(res.data!.title.reviews).toEqual({
      totalCount: 0,
      pageInfo: { hasNextPage: false, endCursor: null },
      edges: [],
    });
  });

  it.each(['tt9999999', '', "'; DROP TABLE titles;--", 'x'.repeat(500), 'tt\u0000'])(
    'gir null (ikke feil) for ukjent id %j',
    async (id) => {
      const res = await env.gql(TITLE, { id });
      expect(res.errors).toBeUndefined();
      expect(res.data!.title).toBeNull();
    },
  );
});

describe('title: anmeldelser', () => {
  const N = 25;

  it('setter opp anmeldelser', async () => {
    // Eksplisitte tidsstempler; hvert tredje deler tidsstempel for å teste tiebreak på id.
    await env.pool.query(
      `INSERT INTO reviews (title_id, user_id, author, rating, body, created_at)
       SELECT 'tt0000002', CASE WHEN i % 5 = 0 THEN $1::uuid ELSE $2::uuid END,
              'Anmelder ' || i, 1 + i % 5, 'Tekst ' || i,
              timestamptz '2025-01-01 12:00:00.123456+00' + ((i / 3) * interval '1 minute')
       FROM generate_series(1, ${N}) AS i`,
      [USER_A, USER_B],
    );
    const res = await env.gql(TITLE, { id: 'tt0000002', first: 50 }, USER_A);
    expect(res.data!.title.reviewCount).toBe(N);
    expect(res.data!.title.reviews.totalCount).toBe(N);
  });

  it('userRating er snittet (1–5) og reviewCount antallet', async () => {
    const { rows } = await env.pool.query<{ avg: string }>(
      "SELECT avg(rating) AS avg FROM reviews WHERE title_id = 'tt0000002'",
    );
    const res = await env.gql(TITLE, { id: 'tt0000002' });
    expect(res.data!.title.userRating).toBeCloseTo(Number(rows[0]!.avg), 2);
    expect(res.data!.title.reviewCount).toBe(N);
  });

  it('paginerer nyeste først uten duplikater og hull, også ved like tidsstempler', async () => {
    const ids: string[] = [];
    const stamps: string[] = [];
    let after: string | null = null;
    let pages = 0;
    do {
      const res: GqlResult = await env.gql(TITLE, { id: 'tt0000002', first: 4, after }, USER_A);
      expect(res.errors).toBeUndefined();
      const rev: Record<string, any> = res.data!.title.reviews;
      for (const e of rev.edges) {
        ids.push(e.node.id);
        stamps.push(e.node.createdAt);
        expect(e.node.titleId).toBe('tt0000002');
      }
      after = rev.pageInfo.hasNextPage ? rev.pageInfo.endCursor : null;
      pages++;
    } while (after && pages < 50);
    expect(ids).toHaveLength(N);
    expect(new Set(ids).size).toBe(N);
    expect(pages).toBe(Math.ceil(N / 4));
    const { rows } = await env.pool.query<{ id: string }>(
      "SELECT r.id::text AS id FROM reviews r WHERE r.title_id = 'tt0000002' ORDER BY r.created_at DESC, r.id DESC",
    );
    expect(ids).toEqual(rows.map((r) => r.id));
    expect([...stamps].sort().reverse()).toEqual(stamps);
  });

  it('bruker first=10 som standard', async () => {
    const res = await env.gql(TITLE, { id: 'tt0000002' });
    expect(res.data!.title.reviews.edges).toHaveLength(10);
    expect(res.data!.title.reviews.pageInfo.hasNextPage).toBe(true);
  });

  it('isMine gjelder bare brukeren som skrev anmeldelsen', async () => {
    const asA = (await env.gql(TITLE, { id: 'tt0000002', first: 50 }, USER_A)).data!.title.reviews
      .edges;
    const asB = (await env.gql(TITLE, { id: 'tt0000002', first: 50 }, USER_B)).data!.title.reviews
      .edges;
    const anon = (await env.gql(TITLE, { id: 'tt0000002', first: 50 })).data!.title.reviews.edges;
    const mineA = asA.filter((e: { node: { isMine: boolean } }) => e.node.isMine).length;
    const mineB = asB.filter((e: { node: { isMine: boolean } }) => e.node.isMine).length;
    expect(mineA).toBe(5);
    expect(mineB).toBe(N - 5);
    expect(anon.some((e: { node: { isMine: boolean } }) => e.node.isMine)).toBe(false);
  });

  it('createdAt er ISO 8601', async () => {
    const res = await env.gql(TITLE, { id: 'tt0000002', first: 1 });
    const iso = res.data!.title.reviews.edges[0].node.createdAt;
    expect(new Date(iso).toISOString()).toBe(iso);
  });

  it.each([0, 51])('avviser reviews(first: %s)', async (first) => {
    const res = await env.gql(TITLE, { id: 'tt0000002', first });
    expect(res.errors?.[0]?.extensions?.code).toBe('BAD_USER_INPUT');
  });

  it.each(['abc', 'e30', Buffer.from('{"s":"reviews","v":["nei","1"]}').toString('base64url')])(
    'avviser ugyldig reviews-cursor %j',
    async (after) => {
      const res = await env.gql(TITLE, { id: 'tt0000002', after });
      expect(res.errors?.[0]?.extensions?.code).toBe('BAD_USER_INPUT');
    },
  );
});

describe('N+1', () => {
  it('henter statistikk og listestatus for en hel resultatside i én spørring hver', async () => {
    const spy = vi.spyOn(env.pool, 'query');
    const res = await env.gql(
      `{ search(first: 30) { totalCount edges { node { id genres userRating reviewCount inMyList } } } }`,
      undefined,
      USER_A,
    );
    expect(res.errors).toBeUndefined();
    expect(res.data!.search.edges).toHaveLength(30);
    // hovedspørring + count + reviewStats + inMyList
    expect(spy.mock.calls.length).toBeLessThanOrEqual(4);
    spy.mockRestore();
  });

  it('gjør ikke ekstra spørringer for felt som ikke etterspørres', async () => {
    const spy = vi.spyOn(env.pool, 'query');
    await env.gql(SEARCH, { first: 20 });
    expect(spy.mock.calls.length).toBe(2); // rader + totalCount
    spy.mockRestore();
  });
});
