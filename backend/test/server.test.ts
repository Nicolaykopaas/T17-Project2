import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createApp } from '../src/app.js';
import { config } from '../src/config.js';
import { createPool, type Pool } from '../src/db.js';
import { resetData } from './fixtures.js';

const post = (
  yoga: ReturnType<typeof createApp>,
  query: string,
  headers: Record<string, string> = {},
) =>
  yoga.fetch('http://localhost/graphql', {
    method: 'POST',
    headers: { 'content-type': 'application/json', ...headers },
    body: JSON.stringify({ query }),
  });

let pool: Pool;
beforeAll(async () => {
  pool = createPool(config.testDatabaseUrl);
  await resetData(pool);
});
afterAll(async () => {
  await pool.end();
});

describe('GET /health', () => {
  it('svarer 200 {status:"ok"} når databasen svarer', async () => {
    const res = await createApp({ pool }).fetch('http://localhost/health');
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ status: 'ok' });
  });

  it('svarer 503 {status:"db-unavailable"} når databasen ikke svarer', async () => {
    // Port 1 avviser tilkoblinger umiddelbart, som en nedlagt Postgres.
    const dead = createPool('postgres://postgres:x@127.0.0.1:1/none');
    try {
      const res = await createApp({ pool: dead }).fetch('http://localhost/health');
      expect(res.status).toBe(503);
      expect(await res.json()).toEqual({ status: 'db-unavailable' });
    } finally {
      await dead.end();
    }
  });
});

describe('database nede mens Node kjører', () => {
  it('gir SERVICE_UNAVAILABLE uten interne detaljer', async () => {
    const dead = createPool('postgres://postgres:x@127.0.0.1:1/none');
    try {
      const res = await post(createApp({ pool: dead }), '{ genres }');
      const body = await res.json();
      expect(body.errors[0].extensions.code).toBe('SERVICE_UNAVAILABLE');
      expect(JSON.stringify(body)).not.toMatch(/127\.0\.0\.1|ECONNREFUSED|postgres/);
    } finally {
      await dead.end();
    }
  });
});

describe('servergrenser', () => {
  it('slår av introspeksjon i produksjon, men ikke i utvikling', async () => {
    const dev = createApp({ pool, production: false });
    const prod = createApp({ pool, production: true });
    const q = '{ __schema { queryType { name } } }';
    expect((await (await post(dev, q)).json()).data.__schema.queryType.name).toBe('Query');
    const res = await (await post(prod, q)).json();
    expect(res.data).toBeUndefined();
    expect(res.errors[0].message).toMatch(/introspection/i);
    // vanlige spørringer virker fortsatt
    expect((await (await post(prod, '{ genres }')).json()).data.genres.length).toBeGreaterThan(0);
  });

  it('maskerer uventede feil uten å lekke detaljer', async () => {
    const broken = createPool(config.testDatabaseUrl);
    await broken.end(); // alle spørringer feiler nå
    const yoga = createApp({ pool: broken, production: false });
    const res = await (await post(yoga, '{ genres }')).json();
    expect(res.errors).toHaveLength(1);
    expect(res.errors[0].extensions.code).toBe('INTERNAL_SERVER_ERROR');
    expect(JSON.stringify(res)).not.toMatch(/pool|postgres|ECONN|SELECT|stack/i);
  });

  it('sender CORS-headere bare når corsOrigin er satt', async () => {
    const withCors = createApp({ pool, corsOrigin: 'http://localhost:5173' });
    const without = createApp({ pool });
    const preflight = (y: typeof withCors) =>
      y.fetch('http://localhost/graphql', {
        method: 'OPTIONS',
        headers: {
          origin: 'http://localhost:5173',
          'access-control-request-method': 'POST',
          'access-control-request-headers': 'content-type,x-user-id',
        },
      });
    const a = await preflight(withCors);
    expect(a.headers.get('access-control-allow-origin')).toBe('http://localhost:5173');
    expect(a.headers.get('access-control-allow-headers')).toMatch(/x-user-id/i);
    expect((await preflight(without)).headers.get('access-control-allow-origin')).toBeNull();
  });

  describe('kompleksitetsgrense', () => {
    const run = async (query: string) =>
      (await post(createApp({ pool }), query, {})).json() as Promise<{
        data?: unknown;
        errors?: { message: string; extensions?: { code?: string } }[];
      }>;

    // Kopier av frontendens største spørringer (frontend/src/graphql/operations.ts). Hvis disse
    // begynner å feile, har grensene blitt for stramme for den faktiske klienten.
    const SUMMARY = `id primaryTitle type startYear genres averageRating numVotes
      poster185: posterUrl(width: 185) poster342: posterUrl(width: 342) stream { url }`;
    const HERO = `overview backdrop780: backdropUrl(width: 780) backdrop1280: backdropUrl(width: 1280)`;
    // Frontenden sender `first` som variabel, som kostnadsberegningen regner som 50.
    const FEATURED = `query Featured($first: Int) { search(first: $first) { pageInfo { hasNextPage endCursor }
      edges { cursor node { ${SUMMARY} ${HERO} inMyList } } } }`;
    // Forsideradene (ROW_QUERY) ber ikke om totalCount.
    const ROW = `query Row($first: Int) { search(first: $first) { pageInfo { hasNextPage endCursor }
      edges { cursor node { ${SUMMARY} } } } }`;
    const SEARCH = `query Search($first: Int) { search(first: $first) { totalCount pageInfo { hasNextPage endCursor }
      edges { cursor node { ${SUMMARY} } } } }`;
    const TITLE = `query { title(id: "tt0000001") { ${SUMMARY} ${HERO}
      poster500: posterUrl(width: 500) originalTitle endYear runtimeMinutes userRating reviewCount
      inMyList stream { url archiveUrl license licenseUrl durationSeconds subtitlesUrl }
      reviews(first: 10) { totalCount pageInfo { hasNextPage endCursor }
        edges { cursor node { id titleId author rating text createdAt isMine } } } } }`;

    it('slipper gjennom frontendens største spørringer', async () => {
      for (const q of [FEATURED, ROW, SEARCH, TITLE]) {
        const res = await run(q);
        expect(res.errors, q.slice(0, 40)).toBeUndefined();
      }
    });

    it('avviser hundrevis av aliasede søk i ett dokument', async () => {
      const q = `{ ${Array.from({ length: 300 }, (_, i) => `s${i}: search(query: "a") { totalCount }`).join(' ')} }`;
      const res = await run(q);
      expect(res.data).toBeUndefined();
      expect(res.errors).toHaveLength(1);
      expect(res.errors![0]!.extensions?.code).toBe('BAD_USER_INPUT');
      expect(res.errors![0]!.message).toMatch(/rotfelt/);
    });

    it('avviser mange aliasede TMDB-felt på én tittel', async () => {
      const q = `{ title(id: "tt0000001") { ${Array.from({ length: 200 }, (_, i) => `p${i}: posterUrl(width: 92)`).join(' ')} } }`;
      const res = await run(q);
      expect(res.data).toBeUndefined();
      expect(res.errors![0]!.extensions?.code).toBe('BAD_USER_INPUT');
      expect(res.errors![0]!.message).toMatch(/felt/);
    });

    it('godtar akkurat grensen for rotfelt (8) og avviser 9', async () => {
      const roots = (n: number) =>
        `{ ${Array.from({ length: n }, (_, i) => `g${i}: genres`).join(' ')} }`;
      expect((await run(roots(8))).errors).toBeUndefined();
      expect((await run(roots(9))).errors?.[0]?.extensions?.code).toBe('BAD_USER_INPUT');
    });
  });

  it('tåler ugyldig JSON-body og manglende query', async () => {
    const yoga = createApp({ pool });
    const bad = await yoga.fetch('http://localhost/graphql', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: '{ikke json',
    });
    expect(bad.status).toBeGreaterThanOrEqual(400);
    expect(bad.status).toBeLessThan(500);
    const empty = await yoga.fetch('http://localhost/graphql', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: '{}',
    });
    expect(empty.status).toBeLessThan(500);
  });
});
