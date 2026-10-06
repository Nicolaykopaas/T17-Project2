import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { buildSchema, parse, specifiedRules, validate } from 'graphql';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createApp, MAX_COST, MAX_FIELDS, MAX_QUERY_DEPTH, MAX_ROOT_FIELDS } from '../src/app.js';
import { complexityLimit } from '../src/complexityLimit.js';
import { depthLimit } from '../src/depthLimit.js';
import { typeDefs } from '../src/typeDefs.js';
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

    // Vaktbikkje: alle frontendens operasjoner må være gyldige mot skjemaet OG innenfor grensene. Vi
    // leser operations.ts som tekst i stedet for å importere den: backendens tsconfig har
    // rootDir = backend, og importen ville dratt inn Apollo Client og frontendens typer. De to
    // delte tekstfragmentene (`${...}`) er enkle konstanter, så de kan limes inn direkte. Reglene
    // og grensene er de samme som createApp bruker (app.ts), så testen ikke kan drive fra appen.
    // Begynner den å feile, er enten skjemaet endret uten at klienten fulgte med, eller grensene
    // har blitt for stramme for den faktiske klienten.
    // buildSchema fra samme graphql-instans som validate: Yogas ferdige schema kommer fra en annen
    // modulinstans i Vitest og avvises. Validering trenger ingen resolvere.
    const schema = buildSchema(typeDefs);
    const operationsSource = readFileSync(
      fileURLToPath(new URL('../../frontend/src/graphql/operations.ts', import.meta.url)),
      'utf8',
    );
    const fragments = new Map(
      [...operationsSource.matchAll(/^const (\w+) = `([^`]*)`;/gm)].map((m) => [m[1]!, m[2]!]),
    );
    const documents = [
      ...operationsSource.matchAll(/^export const (\w+)\b[^=]*= gql`([^`]*)`;/gm),
    ].map((m) => ({
      name: m[1]!,
      source: m[2]!.replace(/\$\{(\w+)\}/g, (all, key: string) => fragments.get(key) ?? all),
    }));

    it('finner alle frontendens operasjoner', () => {
      // Hvis formatet i operations.ts endres slik at regexene ikke treffer, skal testen feile
      // høylytt i stedet for å validere ingenting.
      expect(documents.length).toBeGreaterThanOrEqual(11);
      for (const d of documents) expect(d.source, d.name).not.toContain('${');
    });

    it('slipper gjennom frontendens operasjoner', () => {
      for (const { name, source } of documents) {
        const errors = validate(schema, parse(source), [
          ...specifiedRules,
          depthLimit(MAX_QUERY_DEPTH),
          complexityLimit({
            maxRootFields: MAX_ROOT_FIELDS,
            maxFields: MAX_FIELDS,
            maxCost: MAX_COST,
          }),
        ]);
        expect(
          errors.map((e) => e.message),
          name,
        ).toEqual([]);
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
