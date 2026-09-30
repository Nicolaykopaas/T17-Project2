/* eslint-disable @typescript-eslint/no-explicit-any -- GraphQL-svar er dynamiske; testene asserter formen */
import { afterAll, beforeAll } from 'vitest';
import { ArtworkService } from '../src/artwork.js';
import { createApp } from '../src/app.js';
import { config } from '../src/config.js';
import { createPool, type Pool } from '../src/db.js';
import { resetData } from './fixtures.js';

export const USER_A = '3f2504e0-4f89-41d3-9a0c-0305e82c3301';
export const USER_B = '9b2f8a5c-1d3e-4c7a-8f60-2a4b6c8d0e1f';

export interface GqlResult<T = Record<string, any>> {
  data?: T | null;
  errors?: { message: string; extensions?: { code?: string } }[];
}

export interface TestEnv {
  pool: Pool;
  gql: (
    query: string,
    variables?: Record<string, unknown>,
    userId?: string | null,
  ) => Promise<GqlResult>;
}

/**
 * Felles oppsett for API-tester: egen pool mot testdatabasen, friskt datasett før filen,
 * og spørringer via yoga.fetch (ingen nettverksport nødvendig).
 */
export function setupApi(): TestEnv {
  const env = {} as TestEnv;
  beforeAll(async () => {
    env.pool = createPool(config.testDatabaseUrl);
    await resetData(env.pool);
    const yoga = createApp({
      pool: env.pool,
      production: false,
      corsOrigin: 'http://localhost:5173',
      // Uten nøkkel: testene skal aldri kunne nå et ekte TMDB, selv om utvikleren har en i .env.
      artwork: new ArtworkService({ pool: env.pool, apiKey: undefined }),
    });
    env.gql = async (query, variables, userId = null) => {
      const res = await yoga.fetch('http://localhost/graphql', {
        method: 'POST',
        headers: { 'content-type': 'application/json', ...(userId ? { 'x-user-id': userId } : {}) },
        body: JSON.stringify({ query, variables }),
      });
      return (await res.json()) as GqlResult;
    };
  });
  afterAll(async () => {
    await env.pool.end();
  });
  return env;
}
