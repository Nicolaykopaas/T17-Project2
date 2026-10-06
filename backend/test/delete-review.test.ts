/* eslint-disable @typescript-eslint/no-explicit-any -- dynamiske GraphQL-svar */
import { describe, expect, it } from 'vitest';
import { setupApi, USER_A, USER_B } from './helpers.js';

const env = setupApi();

const ADD = /* GraphQL */ `
  mutation Add($input: AddReviewInput!) {
    addReview(input: $input) {
      id
    }
  }
`;
const DELETE = /* GraphQL */ `
  mutation Delete($id: ID!) {
    deleteReview(id: $id) {
      deletedId
      title {
        id
        userRating
        reviewCount
      }
    }
  }
`;
const REVIEW_IDS = /* GraphQL */ `
  query ($id: ID!) {
    title(id: $id) {
      reviews {
        edges {
          node {
            id
          }
        }
      }
    }
  }
`;

const titleId = 'tt0000101';
const add = async (user: string, rating: number) =>
  (await env.gql(ADD, { input: { titleId, author: 'Kari', rating, text: 'ok' } }, user)).data!
    .addReview.id as string;
const code = (r: { errors?: { extensions?: { code?: string } }[] }) =>
  r.errors?.[0]?.extensions?.code;

describe('deleteReview', () => {
  it('sletter egen anmeldelse og returnerer id og oppdaterte aggregater', async () => {
    const mine = await add(USER_A, 5);
    const theirs = await add(USER_B, 3);
    const res = await env.gql(DELETE, { id: mine }, USER_A);
    expect(res.errors).toBeUndefined();
    expect(res.data!.deleteReview).toEqual({
      deletedId: mine,
      title: { id: titleId, userRating: 3, reviewCount: 1 },
    });
    const after = await env.gql(REVIEW_IDS, { id: titleId });
    expect(after.data!.title.reviews.edges.map((e: any) => e.node.id)).toEqual([theirs]);
    await env.gql(DELETE, { id: theirs }, USER_B);
  });

  it('nullstiller userRating når siste anmeldelse slettes', async () => {
    const id = await add(USER_A, 4);
    const res = await env.gql(DELETE, { id }, USER_A);
    expect(res.data!.deleteReview.title).toEqual({ id: titleId, userRating: null, reviewCount: 0 });
  });

  it('gir NOT_FOUND for andres anmeldelse og lar den stå', async () => {
    const theirs = await add(USER_B, 2);
    const res = await env.gql(DELETE, { id: theirs }, USER_A);
    expect(code(res)).toBe('NOT_FOUND');
    expect(res.data).toBeNull();
    const rows = await env.pool.query('SELECT 1 FROM reviews WHERE id = $1', [theirs]);
    expect(rows.rowCount).toBe(1);
    await env.gql(DELETE, { id: theirs }, USER_B);
  });

  it('gir samme svar for ukjent id som for andres (lekker ikke eksistens)', async () => {
    const theirs = await add(USER_B, 2);
    const other = await env.gql(DELETE, { id: theirs }, USER_A);
    const unknown = await env.gql(DELETE, { id: '999999999' }, USER_A);
    expect(code(unknown)).toBe('NOT_FOUND');
    expect(unknown.errors![0]!.message).toBe(other.errors![0]!.message);
    await env.gql(DELETE, { id: theirs }, USER_B);
  });

  it('kan ikke slette samme anmeldelse to ganger', async () => {
    const id = await add(USER_A, 1);
    expect((await env.gql(DELETE, { id }, USER_A)).errors).toBeUndefined();
    expect(code(await env.gql(DELETE, { id }, USER_A))).toBe('NOT_FOUND');
  });

  it.each(['abc', '', '0', '-1', '1.5', '1; DROP TABLE reviews', '9'.repeat(30), '٣'])(
    'avviser ugyldig id %j med BAD_USER_INPUT',
    async (id) => {
      expect(code(await env.gql(DELETE, { id }, USER_A))).toBe('BAD_USER_INPUT');
    },
  );

  it('gir UNAUTHENTICATED uten gyldig x-user-id', async () => {
    const id = await add(USER_A, 4);
    expect(code(await env.gql(DELETE, { id }))).toBe('UNAUTHENTICATED');
    expect(code(await env.gql(DELETE, { id }, 'ugyldig'))).toBe('UNAUTHENTICATED');
    expect((await env.gql(DELETE, { id }, USER_A)).errors).toBeUndefined();
  });
});
