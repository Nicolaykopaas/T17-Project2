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
