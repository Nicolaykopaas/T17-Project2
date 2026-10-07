/* eslint-disable @typescript-eslint/no-explicit-any -- GraphQL-svar er dynamiske; testene asserter formen */
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { prefetchArtwork } from '../scripts/prefetch-artwork.js';
import { startTmdbMock, type TmdbMock } from '../scripts/tmdb-mock.js';
import { ArtworkService, snapWidth, type ArtworkOptions } from '../src/artwork.js';
import { createApp } from '../src/app.js';
import { config } from '../src/config.js';
import { createPool, type Pool } from '../src/db.js';
import { resetData } from './fixtures.js';

let pool: Pool;
let mock: TmdbMock;
const API = () => `http://127.0.0.1:${mock.port}/3`;
const IMG = () => `http://127.0.0.1:${mock.port}/t/p`;
const quiet = () => {};

const service = (over: Partial<ArtworkOptions> = {}) =>
  new ArtworkService({
    pool,
    apiKey: 'test',
    apiUrl: API(),
    imageUrl: IMG(),
    log: quiet,
    ...over,
  });

async function gql(svc: ArtworkService, query: string) {
  const yoga = createApp({ pool, production: false, artwork: svc });
  const res = await yoga.fetch('http://localhost/graphql', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ query }),
  });
  return (await res.json()) as { data?: any; errors?: { extensions?: { code?: string } }[] };
}

const rowFor = async (id: string) =>
  (await pool.query('SELECT * FROM title_artwork WHERE title_id = $1', [id])).rows[0];

// Ikke-10-multipler er «funnet» i mocken; tt0000010 og tt0000100 er ukjente hos TMDB.
const FOUND = 'tt0000001';
const MISSING = 'tt0000010';
const poster = (id: string) => `{ title(id: "${id}") { posterUrl overview } }`;

beforeAll(async () => {
  pool = createPool(config.testDatabaseUrl);
  await resetData(pool);
  mock = await startTmdbMock(0);
});
afterAll(async () => {
  await mock.close();
  await pool.end();
});
beforeEach(async () => {
  await pool.query('DELETE FROM title_artwork');
  mock.state.calls.length = 0;
  mock.state.delayMs = 0;
  mock.state.failStatus = null;
  mock.state.emptyIds.clear();
});

describe('snapWidth', () => {
  it('snapper til nærmeste tillatte bredde, og til den største ved likt avstand', () => {
    const p = [92, 154, 185, 342, 500, 780];
    expect(snapWidth(100, p)).toBe(92);
    expect(snapWidth(342, p)).toBe(342);
    expect(snapWidth(420, p)).toBe(342); // 78 fra 342, 80 fra 500
    expect(snapWidth(421, p)).toBe(500);
    expect(snapWidth(99999, p)).toBe(780);
    expect(snapWidth(1, p)).toBe(92);
    expect(snapWidth(1000, [300, 780, 1280])).toBe(780); // 220 fra 780, 280 fra 1280
    expect(snapWidth(1030, [300, 780, 1280])).toBe(1280); // likt avstand (250): den største
  });
  it('avviser ≤ 0 og ikke-heltall', () => {
    expect(() => snapWidth(0, [1])).toThrow();
    expect(() => snapWidth(-5, [1])).toThrow();
    expect(() => snapWidth(1.5, [1])).toThrow();
    expect(() => snapWidth(NaN, [1])).toThrow();
  });
});

describe('uten API-nøkkel', () => {
  it('gjør aldri TMDB-kall, men bruker det som ligger i databasen', async () => {
    const svc = service({ apiKey: undefined });
    const empty = await gql(svc, poster(FOUND));
    expect(empty.data.title).toEqual({ posterUrl: null, overview: null });

    await pool.query(
      `INSERT INTO title_artwork (title_id, status, poster_path, overview)
       VALUES ($1, 'found', '/cached.jpg', 'Cached.')`,
      [FOUND],
    );
    const cached = await gql(svc, poster(FOUND));
    expect(cached.data.title).toEqual({
      posterUrl: `${IMG()}/w342/cached.jpg`,
      overview: 'Cached.',
    });
    expect(mock.state.calls).toEqual([]);
  });
});

describe('oppslag og cache', () => {
  it('første oppslag lagrer i databasen; neste request gjør ingen TMDB-kall', async () => {
    const res = await gql(
      service(),
      `{ title(id: "${FOUND}") { posterUrl(width: 500) backdropUrl(width: 780) overview } }`,
    );
    expect(res.data.title.posterUrl).toBe(`${IMG()}/w500/${FOUND}.svg`);
    expect(res.data.title.backdropUrl).toBe(`${IMG()}/w780/${FOUND}-bg.svg`);
    expect(res.data.title.overview).toMatch(/^A .+\.$/);
    expect(mock.state.calls).toEqual([FOUND]); // tre felt, ett kall
    expect((await rowFor(FOUND)).status).toBe('found');

    // Ny tjeneste = tom minnecache, så treffet må komme fra databasen.
    const again = await gql(service(), poster(FOUND));
    expect(again.data.title.posterUrl).toBe(`${IMG()}/w342/${FOUND}.svg`);
    expect(mock.state.calls).toHaveLength(1);
  });

  it('bruker den andre resultatlisten når typen ikke har treff (film funnet under tv_results)', async () => {
    // tt0000001 (film) ligger i tv_results i mocken.
    const res = await gql(service(), poster('tt0000001'));
    expect(res.data.title.posterUrl).not.toBeNull();
  });

  it('lagrer «missing» og spør ikke TMDB igjen', async () => {
    const svc = service();
    expect((await gql(svc, poster(MISSING))).data.title).toEqual({
      posterUrl: null,
      overview: null,
    });
    expect((await rowFor(MISSING)).status).toBe('missing');
    await gql(service(), poster(MISSING));
    expect(mock.state.calls).toEqual([MISSING]);
  });

  it('samtidige requests for samme tittel gir ett kall og ingen krasj', async () => {
    const svc = service();
    const results = await Promise.all(Array.from({ length: 5 }, () => gql(svc, poster(FOUND))));
    for (const r of results) expect(r.data.title.posterUrl).not.toBeNull();
    expect(mock.state.calls).toHaveLength(1);
  });

  it('upsert tåler at en annen prosess allerede har lagret raden', async () => {
    // Simulerer kappløp: raden dukker opp mellom cache-oppslaget og lagringen.
    const svc = service({
      fetch: async (...args) => {
        await pool.query(
          `INSERT INTO title_artwork (title_id, status) VALUES ($1, 'missing') ON CONFLICT DO NOTHING`,
          [FOUND],
        );
        return fetch(...args);
      },
    });
    const res = await gql(svc, poster(FOUND));
    expect(res.errors).toBeUndefined();
    expect((await rowFor(FOUND)).status).toBe('found');
  });
});

describe('feil hos TMDB', () => {
  it('500 lagres ikke, og negativ cache hindrer nytt kall', async () => {
    mock.state.failStatus = 500;
    const svc = service();
    const res = await gql(svc, poster(FOUND));
    expect(res.errors).toBeUndefined();
    expect(res.data.title.posterUrl).toBeNull();
    expect(await rowFor(FOUND)).toBeUndefined();

    await gql(svc, poster(FOUND));
    expect(mock.state.calls).toHaveLength(1);

    // Ny tjeneste (tom negativ cache) og frisk TMDB: oppslaget lykkes.
    mock.state.failStatus = null;
    expect((await gql(service(), poster(FOUND))).data.title.posterUrl).not.toBeNull();
  });

  it('429 behandles som forbigående', async () => {
    mock.state.failStatus = 429;
    await gql(service(), poster(FOUND));
    expect(await rowFor(FOUND)).toBeUndefined();
  });

  it('timeout per kall lagres ikke', async () => {
    mock.state.delayMs = 800;
    const res = await gql(service({ callTimeoutMs: 150 }), poster(FOUND));
    expect(res.data.title.posterUrl).toBeNull();
    expect(await rowFor(FOUND)).toBeUndefined();
  });

  it('nettverksfeil gir null uten GraphQL-feil', async () => {
    const svc = service({
      fetch: () => Promise.reject(new TypeError('fetch failed')),
    });
    const res = await gql(svc, poster(FOUND));
    expect(res.errors).toBeUndefined();
    expect(res.data.title.posterUrl).toBeNull();
    expect(await rowFor(FOUND)).toBeUndefined();
  });

  it('ugyldig JSON fra TMDB er en forbigående feil', async () => {
    const svc = service({ fetch: async () => new Response('<html>oops</html>', { status: 200 }) });
    expect((await gql(svc, poster(FOUND))).data.title.posterUrl).toBeNull();
    expect(await rowFor(FOUND)).toBeUndefined();
  });

  it('401 logger én advarsel og stopper videre kall', async () => {
    mock.state.failStatus = 401;
    const logs: string[] = [];
    const svc = service({ concurrency: 1, log: (m) => logs.push(m) });
    const ids = ['tt0000001', 'tt0000002', 'tt0000003', 'tt0000004', 'tt0000005'];
    const q = `{ ${ids.map((id, i) => `t${i}: title(id: "${id}") { posterUrl }`).join(' ')} }`;
    const res = await gql(svc, q);
    expect(Object.values(res.data).every((v: any) => v.posterUrl === null)).toBe(true);
    expect(mock.state.calls).toHaveLength(1);
    expect(svc.enabled).toBe(false);

    await gql(svc, poster('tt0000006'));
    expect(mock.state.calls).toHaveLength(1);
    expect(logs).toHaveLength(1);
    expect(logs[0]).toMatch(/TMDB_API_KEY/);
    expect(await rowFor('tt0000001')).toBeUndefined();
  });
});

describe('autentisering mot TMDB', () => {
  const capture = () => {
    const seen: { url: URL; auth: string | null }[] = [];
    const f: typeof fetch = async (input, init) => {
      const url = new URL(String(input));
      seen.push({ url, auth: new Headers(init?.headers).get('authorization') });
      return new Response(JSON.stringify({ movie_results: [], tv_results: [] }));
    };
    return { seen, f };
  };

  it('v4-token (eyJ…) sendes som Bearer, uten api_key i URL-en', async () => {
    const { seen, f } = capture();
    await gql(service({ apiKey: 'eyJhbGciOi.payload.sig', fetch: f }), poster(FOUND));
    expect(seen[0]!.auth).toBe('Bearer eyJhbGciOi.payload.sig');
    expect(seen[0]!.url.searchParams.has('api_key')).toBe(false);
    expect(seen[0]!.url.searchParams.get('external_source')).toBe('imdb_id');
    expect(seen[0]!.url.pathname).toBe(`/3/find/${FOUND}`);
  });

  it('v3-nøkkel sendes som api_key', async () => {
    const { seen, f } = capture();
    await gql(service({ apiKey: 'abc123', fetch: f }), poster(FOUND));
    expect(seen[0]!.auth).toBeNull();
    expect(seen[0]!.url.searchParams.get('api_key')).toBe('abc123');
  });
});

describe('bilde-URL-er', () => {
  it('snapper bredde til nærmeste tillatte', async () => {
    const res = await gql(
      service(),
      `{ title(id: "${FOUND}") { a: posterUrl(width: 100) b: posterUrl(width: 400) c: posterUrl(width: 99999)
         d: backdropUrl(width: 1) e: backdropUrl(width: 600) f: backdropUrl }}`,
    );
    const t = res.data.title;
    expect(t.a).toContain('/w92/');
    expect(t.b).toContain('/w342/');
    expect(t.c).toContain('/w780/');
    expect(t.d).toContain('/w300/');
    expect(t.e).toContain('/w780/');
    expect(t.f).toContain('/w1280/');
  });

  it('ugyldig bredde gir BAD_USER_INPUT og ingen TMDB-kall', async () => {
    for (const w of [0, -3]) {
      const res = await gql(service(), `{ title(id: "${FOUND}") { posterUrl(width: ${w}) } }`);
      expect(res.errors?.[0]?.extensions?.code).toBe('BAD_USER_INPUT');
    }
    const frac = await gql(service(), `{ title(id: "${FOUND}") { posterUrl(width: 1.5) } }`);
    expect(frac.errors).toBeDefined(); // avvises av GraphQL selv (Int)
    expect(mock.state.calls).toEqual([]);
  });

  it('ugyldige stier fra databasen gir null', async () => {
    const bad = [
      '/../etc/passwd.jpg',
      'no-slash.jpg',
      '/a b.jpg',
      '/x.gif',
      '/a/b.jpg',
      'http://evil/x.jpg',
      '/x.jpg?y=1',
      '/',
    ];
    for (const [i, path] of bad.entries()) {
      const id = `tt000000${i + 1}`;
      await pool.query(
        `INSERT INTO title_artwork (title_id, status, poster_path, backdrop_path) VALUES ($1, 'found', $2, $2)`,
        [id, path],
      );
      const res = await gql(
        service({ apiKey: undefined }),
        `{ title(id: "${id}") { posterUrl backdropUrl } }`,
      );
      expect(res.data.title, path).toEqual({ posterUrl: null, backdropUrl: null });
    }
  });
});

describe('tidsgrense', () => {
  it('svarer innen ca. 2,5 s med null, og lagrer resultatet i bakgrunnen', async () => {
    mock.state.delayMs = 3000;
    const started = Date.now();
    const res = await gql(service(), poster(FOUND));
    const elapsed = Date.now() - started;
    expect(res.data.title.posterUrl).toBeNull();
    expect(elapsed).toBeGreaterThanOrEqual(2400);
    expect(elapsed).toBeLessThan(3000);
    expect(await rowFor(FOUND)).toBeUndefined();

    await new Promise((r) => setTimeout(r, 900));
    expect((await rowFor(FOUND)).status).toBe('found');
    expect((await gql(service(), poster(FOUND))).data.title.posterUrl).not.toBeNull();
  }, 15_000);
});

describe('antall kall per side', () => {
  const PAGE = `{ search(first: 20) { edges { node { primaryTitle posterUrl overview } } } }`;

  it('20 titler gir ≤ 20 TMDB-kall, og ingen ved gjentakelse', async () => {
    const svc = service();
    const res = await gql(svc, PAGE);
    expect(res.data.search.edges).toHaveLength(20);
    expect(mock.state.calls.length).toBeLessThanOrEqual(20);
    expect(mock.state.calls.length).toBe(new Set(mock.state.calls).size);
    const withPoster = res.data.search.edges.filter((e: any) => e.node.posterUrl).length;
    expect(withPoster).toBeGreaterThan(15);

    mock.state.calls.length = 0;
    await gql(svc, PAGE);
    expect(mock.state.calls).toEqual([]);
  });

  it('søk uten artwork-felt gjør 0 kall', async () => {
    const res = await gql(
      service(),
      `{ search(first: 20) { edges { node { primaryTitle averageRating } } } }`,
    );
    expect(res.data.search.edges).toHaveLength(20);
    expect(mock.state.calls).toEqual([]);
  });

  it('begrenser samtidigheten', async () => {
    let active = 0;
    let peak = 0;
    const svc = service({
      concurrency: 3,
      fetch: async (...args) => {
        active++;
        peak = Math.max(peak, active);
        try {
          await new Promise((r) => setTimeout(r, 30));
          return await fetch(...args);
        } finally {
          active--;
        }
      },
    });
    await gql(svc, PAGE);
    expect(peak).toBe(3);
  });
});

describe('begrenset oppslagskø', () => {
  it('avviser oppslag utover køgrensen uten TMDB-kall og uten negativ cache', async () => {
    let release!: () => void;
    const gate = new Promise<void>((r) => (release = r));
    let calls = 0;
    const svc = service({
      concurrency: 1,
      maxQueue: 2,
      fetch: async (...args) => {
        calls++;
        await gate;
        return fetch(...args);
      },
    });
    // 1 pågår + 2 i kø = 3 aksepterte; de to neste avvises.
    const ids = ['tt0000001', 'tt0000002', 'tt0000003', 'tt0000004', 'tt0000005'];
    const lookups = ids.map((id) => svc.lookup(id, 'MOVIE'));
    const rejected = await Promise.all([lookups[3]!, lookups[4]!]);
    expect(rejected.map((o) => o.kind)).toEqual(['busy', 'busy']);
    expect(calls).toBe(1);

    release();
    const accepted = await Promise.all(lookups.slice(0, 3));
    expect(accepted.map((o) => o.kind)).toEqual(['found', 'found', 'found']);
    expect(await rowFor('tt0000004')).toBeUndefined();

    // Ingen negativ cache: når køen er tom, slås de avviste opp som vanlig.
    expect((await svc.lookup('tt0000004', 'MOVIE')).kind).toBe('found');
    expect((await rowFor('tt0000004')).status).toBe('found');
  });

  it('gir null for avviste titler i et GraphQL-svar, ikke feil', async () => {
    let release!: () => void;
    const gate = new Promise<void>((r) => (release = r));
    const svc = service({
      concurrency: 1,
      maxQueue: 0,
      batchDeadlineMs: 100,
      fetch: async (...args) => {
        await gate;
        return fetch(...args);
      },
    });
    const res = await gql(
      svc,
      '{ a: title(id: "tt0000001") { posterUrl } b: title(id: "tt0000002") { posterUrl } }',
    );
    release();
    expect(res.errors).toBeUndefined();
    expect(res.data.a.posterUrl).toBeNull();
    expect(res.data.b.posterUrl).toBeNull();
  });
});

describe('db:artwork (prefetch)', () => {
  it('henter de mest populære uten rad, hopper over ferdige og kan kjøres på nytt', async () => {
    const svc = service();
    const first = await prefetchArtwork(pool, svc, { limit: 4, ratePerSecond: 1000 });
    expect(first).toMatchObject({ stoppedBy: 'done' });
    expect(first.found + first.missing).toBe(4);
    const called = [...mock.state.calls];
    // Populærest først: The Dark Knight (tt0000001, 2,8 M stemmer).
    expect(called).toContain('tt0000001');

    mock.state.calls.length = 0;
    const second = await prefetchArtwork(pool, service(), { limit: 4, ratePerSecond: 1000 });
    expect(second.found + second.missing).toBe(4);
    expect(mock.state.calls.filter((c) => called.includes(c))).toEqual([]);
  });

  it('stopper ved avbrudd og ved avvist nøkkel', async () => {
    const aborted = await prefetchArtwork(pool, service(), {
      limit: 10,
      ratePerSecond: 1000,
      signal: { aborted: true },
    });
    expect(aborted.stoppedBy).toBe('signal');
    expect(mock.state.calls).toEqual([]);

    mock.state.failStatus = 403;
    const rejected = await prefetchArtwork(pool, service({ concurrency: 1 }), {
      limit: 10,
      ratePerSecond: 1000,
    });
    expect(rejected.stoppedBy).toBe('rejected-key');
  });
});
