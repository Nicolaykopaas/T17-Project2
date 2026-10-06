/* eslint-disable @typescript-eslint/no-explicit-any -- dynamiske GraphQL-svar */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createApp } from '../src/app.js';
import { config } from '../src/config.js';
import { createPool, type Pool } from '../src/db.js';
import { MutationLimiter, TokenBuckets, clientIp, isLoopback } from '../src/rateLimit.js';
import { resetData } from './fixtures.js';
import { USER_A, USER_B } from './helpers.js';

describe('TokenBuckets', () => {
  it('slipper gjennom `capacity` kall og avviser det neste med ventetid', () => {
    let now = 0;
    const b = new TokenBuckets(3, () => now);
    expect([b.take('k'), b.take('k'), b.take('k')]).toEqual([0, 0, 0]);
    // 3 per minutt = ett token per 20 s.
    expect(b.take('k')).toBe(20);
    now += 10_000;
    expect(b.take('k')).toBe(10);
    now += 10_000;
    expect(b.take('k')).toBe(0);
  });

  it('fyller aldri over kapasiteten, og nøklene er uavhengige', () => {
    let now = 0;
    const b = new TokenBuckets(2, () => now);
    b.take('a');
    b.take('a');
    expect(b.take('a')).toBeGreaterThan(0);
    expect(b.take('b')).toBe(0);
    now += 10 * 60_000;
    expect([b.take('a'), b.take('a'), b.take('a')].map((w) => w > 0)).toEqual([false, false, true]);
  });
});

describe('clientIp med forbindelsesadresse', () => {
  const req = (h: string) => new Request('http://x/', { headers: { 'x-forwarded-for': h } });
  it('stoler på X-Forwarded-For bare når forbindelsen kommer fra loopback (proxyen)', () => {
    for (const proxy of ['127.0.0.1', '127.1.2.3', '::1', '::ffff:127.0.0.1']) {
      expect(clientIp(req('6.6.6.6, 203.0.113.9'), proxy)).toBe('203.0.113.9');
    }
  });
  it('bruker forbindelsens adresse og ignorerer headeren ellers (port 3001 nådd direkte)', () => {
    expect(clientIp(req('1.2.3.4'), '203.0.113.50')).toBe('203.0.113.50');
    expect(clientIp(req('1.2.3.4'), '2001:db8::1')).toBe('2001:db8::1');
    // Uten header og fra utsiden: forbindelsen er likevel kjent.
    expect(clientIp(new Request('http://x/'), '203.0.113.50')).toBe('203.0.113.50');
  });
  it('isLoopback gjenkjenner ikke tilsvarende utenfor 127/8', () => {
    expect(isLoopback('128.0.0.1')).toBe(false);
    expect(isLoopback('10.0.0.1')).toBe(false);
    expect(isLoopback('::2')).toBe(false);
  });
});

describe('clientIp', () => {
  const ip = (h?: string) =>
    clientIp(new Request('http://x/', h ? { headers: { 'x-forwarded-for': h } } : {}));
  it('bruker siste ledd, som proxyen la til', () => {
    expect(ip('6.6.6.6, 203.0.113.9')).toBe('203.0.113.9');
    expect(ip('203.0.113.9')).toBe('203.0.113.9');
    expect(ip()).toBeNull();
    expect(ip(' ')).toBeNull();
  });
});

describe('MutationLimiter', () => {
  it('begrenser per IP på tvers av brukere', () => {
    const l = new MutationLimiter({ reviewsPerMinute: 2, mutationsPerMinute: 2, ipFactor: 2 });
    // IP-grensen er 4. Hver bruker holder seg under sin egen grense på 2.
    for (const u of ['u1', 'u2']) {
      l.check('review', u, '1.1.1.1');
      l.check('review', u, '1.1.1.1');
    }
    expect(() => l.check('review', 'u3', '1.1.1.1')).toThrow(/For mange/);
    expect(() => l.check('review', 'u3', '2.2.2.2')).not.toThrow();
  });

  it('avvist forespørsel på IP bruker ikke opp brukerens kvote', () => {
    const l = new MutationLimiter({ reviewsPerMinute: 1, mutationsPerMinute: 1, ipFactor: 1 });
    l.check('review', 'u1', '1.1.1.1');
    expect(() => l.check('review', 'u2', '1.1.1.1')).toThrow();
    expect(() => l.check('review', 'u2', '9.9.9.9')).not.toThrow();
  });
});

describe('begrensning av mutations via API-et', () => {
  let pool: Pool;
  beforeAll(async () => {
    pool = createPool(config.testDatabaseUrl);
    await resetData(pool);
  });
  afterAll(async () => {
    await pool.end();
  });

  const call = async (
    yoga: ReturnType<typeof createApp>,
    query: string,
    user: string,
    headers: Record<string, string> = {},
    remoteAddress?: string,
  ) => {
    const res = await yoga.fetch(
      'http://localhost/graphql',
      {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'x-user-id': user, ...headers },
        body: JSON.stringify({ query }),
      },
      // Det node:http gir Yoga som `req`; uten det (som i yoga.fetch) finnes ingen forbindelse.
      remoteAddress ? { req: { socket: { remoteAddress } } } : {},
    );
    return (await res.json()) as { data?: any; errors?: { message: string; extensions: any }[] };
  };
  const add = (rating = 4) =>
    `mutation { addReview(input: {titleId: "tt0000001", author: "A", rating: ${rating}, text: ""}) { id } }`;
  const toggle = 'mutation { toggleList(titleId: "tt0000002") { inMyList } }';

  it('gir RATE_LIMITED med forståelig melding og retryAfterSeconds når kvoten er brukt opp', async () => {
    const yoga = createApp({ pool, rateLimits: { reviewsPerMinute: 3 } });
    for (let i = 0; i < 3; i++) expect((await call(yoga, add(), USER_A)).errors).toBeUndefined();
    const res = await call(yoga, add(), USER_A);
    expect(res.data).toBeNull();
    expect(res.errors![0]!.extensions.code).toBe('RATE_LIMITED');
    expect(res.errors![0]!.message).toMatch(/For mange forsøk\. Vent \d+ sekunder/);
    // 3 per minutt = ett token per 20 s.
    expect(res.errors![0]!.extensions.retryAfterSeconds).toBeGreaterThan(0);
    expect(res.errors![0]!.extensions.retryAfterSeconds).toBeLessThanOrEqual(20);
    // Avviste forsøk lagrer ingenting.
    const { rows } = await pool.query('SELECT count(*)::int AS n FROM reviews WHERE user_id = $1', [
      USER_A,
    ]);
    expect(rows[0].n).toBe(3);
  });

  it('er per bruker: en annen bruker påvirkes ikke', async () => {
    const yoga = createApp({ pool, rateLimits: { reviewsPerMinute: 1 } });
    expect((await call(yoga, add(), USER_A)).errors).toBeUndefined();
    expect((await call(yoga, add(), USER_A)).errors![0]!.extensions.code).toBe('RATE_LIMITED');
    expect((await call(yoga, add(), USER_B)).errors).toBeUndefined();
  });

  it('teller også ugyldige forsøk, men ikke uautentiserte', async () => {
    const yoga = createApp({ pool, rateLimits: { reviewsPerMinute: 2 } });
    const invalid = add(9);
    expect((await call(yoga, invalid, USER_A)).errors![0]!.extensions.code).toBe('BAD_USER_INPUT');
    expect((await call(yoga, invalid, USER_A)).errors![0]!.extensions.code).toBe('BAD_USER_INPUT');
    expect((await call(yoga, invalid, USER_A)).errors![0]!.extensions.code).toBe('RATE_LIMITED');
    // Uten gyldig bruker svarer vi UNAUTHENTICATED uten å røre noen kvote.
    const anon = await call(yoga, add(), 'ikke-uuid');
    expect(anon.errors![0]!.extensions.code).toBe('UNAUTHENTICATED');
  });

  it('toggleList og deleteReview deler en egen kvote, atskilt fra anmeldelser', async () => {
    const yoga = createApp({ pool, rateLimits: { mutationsPerMinute: 2, reviewsPerMinute: 100 } });
    expect((await call(yoga, toggle, USER_A)).errors).toBeUndefined();
    const del = await call(yoga, 'mutation { deleteReview(id: "999999") { deletedId } }', USER_A);
    expect(del.errors![0]!.extensions.code).toBe('NOT_FOUND');
    expect((await call(yoga, toggle, USER_A)).errors![0]!.extensions.code).toBe('RATE_LIMITED');
    // Anmeldelser har egen bøtte og er upåvirket.
    expect((await call(yoga, add(), USER_A)).errors).toBeUndefined();
  });

  it('begrenser per IP (X-Forwarded-For) selv om brukerne roterer', async () => {
    const yoga = createApp({ pool, rateLimits: { reviewsPerMinute: 1, ipFactor: 2 } });
    const xff = { 'x-forwarded-for': '203.0.113.7' };
    const uuid = (n: number) => `00000000-0000-4000-8000-00000000000${n}`;
    expect((await call(yoga, add(), uuid(1), xff)).errors).toBeUndefined();
    expect((await call(yoga, add(), uuid(2), xff)).errors).toBeUndefined();
    expect((await call(yoga, add(), uuid(3), xff)).errors![0]!.extensions.code).toBe(
      'RATE_LIMITED',
    );
    // En annen IP er upåvirket.
    const other = await call(yoga, add(), uuid(3), { 'x-forwarded-for': '203.0.113.8' });
    expect(other.errors).toBeUndefined();
  });

  it('IP-grensen kan ikke omgås med falsk X-Forwarded-For når forbindelsen er direkte', async () => {
    const yoga = createApp({ pool, rateLimits: { reviewsPerMinute: 1, ipFactor: 2 } });
    const uuid = (n: number) => `00000000-0000-4000-8000-0000000001${n}0`;
    const outside = '203.0.113.50';
    // Ny falsk IP og ny bruker for hver forespørsel: tredje skal likevel avvises.
    const r = [];
    for (let i = 1; i <= 3; i++) {
      r.push(await call(yoga, add(), uuid(i), { 'x-forwarded-for': `9.9.9.${i}` }, outside));
    }
    expect(r[0]!.errors).toBeUndefined();
    expect(r[1]!.errors).toBeUndefined();
    expect(r[2]!.errors![0]!.extensions.code).toBe('RATE_LIMITED');
    // Fra proxyen (loopback) er headeren derimot gyldig, og ulike klienter er uavhengige.
    for (let i = 4; i <= 6; i++) {
      const res = await call(
        yoga,
        add(),
        uuid(i),
        { 'x-forwarded-for': `8.8.8.${i}` },
        '127.0.0.1',
      );
      expect(res.errors).toBeUndefined();
    }
  });

  it('standardgrensene tillater en rask runde på noen få anmeldelser og listeklikk', async () => {
    const yoga = createApp({ pool });
    for (let i = 0; i < 5; i++) expect((await call(yoga, add(), USER_A)).errors).toBeUndefined();
    for (let i = 0; i < 10; i++) expect((await call(yoga, toggle, USER_A)).errors).toBeUndefined();
  });
});
