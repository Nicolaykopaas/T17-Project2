/* eslint-disable @typescript-eslint/no-explicit-any -- dynamiske GraphQL-svar */
import { describe, expect, it } from 'vitest';
import { setupApi, type GqlResult, USER_A, USER_B } from './helpers.js';

const env = setupApi();

const ADD = /* GraphQL */ `
  mutation Add($input: AddReviewInput!) {
    addReview(input: $input) {
      id
      titleId
      author
      rating
      text
      createdAt
      isMine
    }
  }
`;
const TOGGLE = /* GraphQL */ `
  mutation Toggle($id: ID!) {
    toggleList(titleId: $id) {
      id
      inMyList
      primaryTitle
    }
  }
`;
const MY_LIST = /* GraphQL */ `
  query MyList($first: Int, $after: String) {
    myList(first: $first, after: $after) {
      totalCount
      pageInfo {
        hasNextPage
        endCursor
      }
      edges {
        node {
          id
          inMyList
        }
      }
    }
  }
`;

const valid = {
  titleId: 'tt0000001',
  author: 'Kari Nordmann',
  rating: 4,
  text: 'Veldig bra film.',
};
const code = (r: { errors?: { extensions?: { code?: string } }[] }) =>
  r.errors?.[0]?.extensions?.code;

describe('addReview', () => {
  it('lagrer en gyldig anmeldelse og returnerer den', async () => {
    const res = await env.gql(ADD, { input: valid }, USER_A);
    expect(res.errors).toBeUndefined();
    const r = res.data!.addReview;
    expect(r).toMatchObject({
      titleId: 'tt0000001',
      author: 'Kari Nordmann',
      rating: 4,
      text: 'Veldig bra film.',
      isMine: true,
    });
    expect(new Date(r.createdAt).toISOString()).toBe(r.createdAt);
    const { rows } = await env.pool.query('SELECT * FROM reviews WHERE id = $1', [r.id]);
    expect(rows[0]).toMatchObject({ user_id: USER_A, title_id: 'tt0000001', rating: 4 });
  });

  it('oppdaterer userRating og reviewCount på tittelen', async () => {
    await env.gql(ADD, { input: { ...valid, rating: 2 } }, USER_B);
    const res = await env.gql('{ title(id: "tt0000001") { userRating reviewCount } }');
    expect(res.data!.title).toEqual({ userRating: 3, reviewCount: 2 });
  });

  it('trimmer forfatter og tekst, og tillater tom tekst', async () => {
    const res = await env.gql(ADD, { input: { ...valid, author: '  Ola  ', text: '   ' } }, USER_A);
    expect(res.data!.addReview).toMatchObject({ author: 'Ola', text: '' });
  });

  it('godtar grenseverdier: 50 tegn forfatter, 2000 tegn tekst, rating 1 og 5, emoji', async () => {
    for (const input of [
      { ...valid, author: 'a'.repeat(50) },
      { ...valid, text: 'x'.repeat(2000) },
      { ...valid, rating: 1 },
      { ...valid, rating: 5 },
      { ...valid, author: '🎬'.repeat(50), text: '🎬'.repeat(2000) },
    ]) {
      const res = await env.gql(ADD, { input }, USER_A);
      expect(res.errors, JSON.stringify(input).slice(0, 60)).toBeUndefined();
    }
  });

  it('lagrer farlige strenger som ren tekst', async () => {
    const text = `'); DROP TABLE reviews; -- <script>alert(1)</script> "quoted" \\ %_`;
    const res = await env.gql(ADD, { input: { ...valid, text } }, USER_A);
    expect(res.data!.addReview.text).toBe(text);
    const { rows } = await env.pool.query('SELECT count(*)::int AS n FROM reviews');
    expect(rows[0].n).toBeGreaterThan(0);
  });

  it.each([
    ['tom forfatter', { author: '' }],
    ['forfatter med bare mellomrom', { author: '    ' }],
    ['forfatter på 51 tegn', { author: 'a'.repeat(51) }],
    ['rating 0', { rating: 0 }],
    ['rating 6', { rating: 6 }],
    ['negativ rating', { rating: -1 }],
    ['tekst på 2001 tegn', { text: 'x'.repeat(2001) }],
    ['NUL-tegn i tekst', { text: 'a\u0000b' }],
    ['NUL-tegn i forfatter', { author: 'a\u0000b' }],
  ])('avviser %s med BAD_USER_INPUT', async (_navn, patch) => {
    const before = (await env.pool.query('SELECT count(*)::int AS n FROM reviews')).rows[0].n;
    const res = await env.gql(ADD, { input: { ...valid, ...patch } }, USER_A);
    expect(code(res)).toBe('BAD_USER_INPUT');
    const after = (await env.pool.query('SELECT count(*)::int AS n FROM reviews')).rows[0].n;
    expect(after).toBe(before);
  });

  it('avviser ikke-heltall og manglende felt (skjemavalidering)', async () => {
    expect((await env.gql(ADD, { input: { ...valid, rating: 2.5 } }, USER_A)).errors).toBeDefined();
    expect((await env.gql(ADD, { input: { titleId: 'tt0000001' } }, USER_A)).errors).toBeDefined();
    expect((await env.gql(ADD, { input: { ...valid, rating: '5' } }, USER_A)).errors).toBeDefined();
  });

  it('gir NOT_FOUND for ukjent tittel', async () => {
    expect(code(await env.gql(ADD, { input: { ...valid, titleId: 'tt9999999' } }, USER_A))).toBe(
      'NOT_FOUND',
    );
    expect(code(await env.gql(ADD, { input: { ...valid, titleId: "x' OR 1=1" } }, USER_A))).toBe(
      'NOT_FOUND',
    );
  });

  it('gir UNAUTHENTICATED uten x-user-id eller med ugyldig UUID', async () => {
    expect(code(await env.gql(ADD, { input: valid }))).toBe('UNAUTHENTICATED');
    expect(code(await env.gql(ADD, { input: valid }, 'ikke-en-uuid'))).toBe('UNAUTHENTICATED');
    expect(code(await env.gql(ADD, { input: valid }, "'; DROP TABLE reviews;--"))).toBe(
      'UNAUTHENTICATED',
    );
  });
});

describe('toggleList og myList', () => {
  it('myList er tom uten x-user-id og for ny bruker', async () => {
    for (const user of [null, USER_A, 'ugyldig']) {
      const res = await env.gql(MY_LIST, {}, user);
      expect(res.errors).toBeUndefined();
      expect(res.data!.myList).toEqual({
        totalCount: 0,
        pageInfo: { hasNextPage: false, endCursor: null },
        edges: [],
      });
    }
  });

  it('slår av og på', async () => {
    const on = await env.gql(TOGGLE, { id: 'tt0000005' }, USER_A);
    expect(on.data!.toggleList).toEqual({
      id: 'tt0000005',
      inMyList: true,
      primaryTitle: 'Amélie',
    });
    expect(
      (await env.gql(MY_LIST, {}, USER_A)).data!.myList.edges.map(
        (e: { node: { id: string } }) => e.node.id,
      ),
    ).toEqual(['tt0000005']);
    const detail = await env.gql('{ title(id: "tt0000005") { inMyList } }', undefined, USER_A);
    expect(detail.data!.title.inMyList).toBe(true);

    const off = await env.gql(TOGGLE, { id: 'tt0000005' }, USER_A);
    expect(off.data!.toggleList.inMyList).toBe(false);
    expect((await env.gql(MY_LIST, {}, USER_A)).data!.myList.totalCount).toBe(0);
    const on2 = await env.gql(TOGGLE, { id: 'tt0000005' }, USER_A);
    expect(on2.data!.toggleList.inMyList).toBe(true);
    await env.gql(TOGGLE, { id: 'tt0000005' }, USER_A);
  });

  it('lister er separate per bruker', async () => {
    await env.gql(TOGGLE, { id: 'tt0000006' }, USER_A);
    const b = await env.gql(MY_LIST, {}, USER_B);
    expect(b.data!.myList.totalCount).toBe(0);
    const search = await env.gql(
      '{ search(query: "Café") { edges { node { id inMyList } } } }',
      undefined,
      USER_B,
    );
    expect(search.data!.search.edges[0].node.inMyList).toBe(false);
    const searchA = await env.gql(
      '{ search(query: "Café") { edges { node { id inMyList } } } }',
      undefined,
      USER_A,
    );
    expect(searchA.data!.search.edges[0].node.inMyList).toBe(true);
    await env.gql(TOGGLE, { id: 'tt0000006' }, USER_A);
  });

  it('myList: sist lagt til først, med paginering', async () => {
    const order = ['tt0000001', 'tt0000002', 'tt0000003', 'tt0000004', 'tt0000005'];
    for (const id of order) await env.gql(TOGGLE, { id }, USER_A);
    const seen: string[] = [];
    let after: string | null = null;
    let pages = 0;
    do {
      const res: GqlResult = await env.gql(MY_LIST, { first: 2, after }, USER_A);
      expect(res.errors).toBeUndefined();
      const list: Record<string, any> = res.data!.myList;
      expect(list.totalCount).toBe(5);
      for (const e of list.edges) {
        seen.push(e.node.id);
        expect(e.node.inMyList).toBe(true);
      }
      after = list.pageInfo.hasNextPage ? list.pageInfo.endCursor : null;
      pages++;
    } while (after && pages < 10);
    expect(seen).toEqual([...order].reverse());
    expect(pages).toBe(3);
  });

  it('myList validerer first og cursor', async () => {
    expect(code(await env.gql(MY_LIST, { first: 0 }, USER_A))).toBe('BAD_USER_INPUT');
    expect(code(await env.gql(MY_LIST, { first: 51 }, USER_A))).toBe('BAD_USER_INPUT');
    expect(code(await env.gql(MY_LIST, { after: 'tull' }, USER_A))).toBe('BAD_USER_INPUT');
    const bad = Buffer.from('{"s":"myList","v":["ikke-dato","x"]}').toString('base64url');
    expect(code(await env.gql(MY_LIST, { after: bad }, USER_A))).toBe('BAD_USER_INPUT');
    // Riktig format, men ikke en ekte dato: ga tidligere Postgres-feil 22008 og maskert 500.
    const badDate = Buffer.from('{"s":"myList","v":["2026-13-45 00:00:00","tt0000001"]}').toString(
      'base64url',
    );
    expect(code(await env.gql(MY_LIST, { after: badDate }, USER_A))).toBe('BAD_USER_INPUT');
  });

  it('krever x-user-id og eksisterende tittel', async () => {
    expect(code(await env.gql(TOGGLE, { id: 'tt0000001' }))).toBe('UNAUTHENTICATED');
    expect(code(await env.gql(TOGGLE, { id: 'tt0000001' }, 'abc'))).toBe('UNAUTHENTICATED');
    expect(code(await env.gql(TOGGLE, { id: 'tt9999999' }, USER_A))).toBe('NOT_FOUND');
  });

  it('to samtidige toggles gir ikke intern feil', async () => {
    const results = await Promise.all([
      env.gql(TOGGLE, { id: 'tt0000020' }, USER_B),
      env.gql(TOGGLE, { id: 'tt0000020' }, USER_B),
    ]);
    for (const r of results) expect(r.errors).toBeUndefined();
  });
});
