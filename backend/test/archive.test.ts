/* eslint-disable @typescript-eslint/no-explicit-any -- GraphQL-svar er dynamiske; testene asserter formen */
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  DEFAULT_ITEMS,
  parseRange,
  startArchiveMock,
  type ArchiveMock,
  type MockItem,
} from '../scripts/archive-mock.js';
import { importArchive, type ImportOptions } from '../scripts/import-archive.js';
import { ArtworkService } from '../src/artwork.js';
import { createApp } from '../src/app.js';
import { config } from '../src/config.js';
import { createPool, type Pool } from '../src/db.js';
import { buildStream, isSafeArchiveId, isSafeFileName } from '../src/stream.js';
import { resetData } from './fixtures.js';

let pool: Pool;
let mock: ArchiveMock;
let dir: string;
const VIDEO_BYTES = 10_000;

// Titlene standard-mocken refererer til (de finnes også i project2 og E2E-basen).
const FAMOUS: [string, string, number][] = [
  ['tt0111161', 'The Shawshank Redemption', 1994],
  ['tt0068646', 'The Godfather', 1972],
  ['tt0133093', 'The Matrix', 1999],
  ['tt0110912', 'Pulp Fiction', 1994],
  ['tt0211915', 'Amélie', 2001],
  ['tt0364569', 'Oldboy', 2003],
  ['tt0095327', 'Grave of the Fireflies', 1988],
];

const run = (over: Partial<ImportOptions> = {}) =>
  importArchive({
    pool,
    archiveUrl: `http://127.0.0.1:${mock.port}`,
    paceMs: 0,
    retryDelayMs: 5,
    log: () => {},
    ...over,
  });

const streams = async () =>
  (await pool.query('SELECT * FROM title_streams ORDER BY title_id')).rows as any[];

beforeAll(async () => {
  pool = createPool(config.testDatabaseUrl);
  await resetData(pool);
  // Fixturen har en egen «Amélie» (2001): den ville gjort tittelkoblingen tvetydig, og det er
  // riktig oppførsel, men her vil vi teste en vellykket kobling på aksenter.
  await pool.query(`DELETE FROM titles WHERE id = 'tt0000005'`);
  await pool.query(
    `INSERT INTO titles (id, title_type, primary_title, original_title, start_year)
     SELECT id, 'movie', t, t, y FROM unnest($1::text[], $2::text[], $3::int[]) AS x(id, t, y)`,
    [FAMOUS.map((f) => f[0]), FAMOUS.map((f) => f[1]), FAMOUS.map((f) => f[2])],
  );
  dir = await mkdtemp(path.join(tmpdir(), 'archive-test-'));
  await writeFile(path.join(dir, 'v.webm'), Buffer.alloc(VIDEO_BYTES, 7));
  mock = await startArchiveMock(0, { videoPath: path.join(dir, 'v.webm'), pageSize: 3 });
});
afterAll(async () => {
  await mock.close();
  await pool.end();
  await rm(dir, { recursive: true, force: true });
});
beforeEach(async () => {
  await pool.query('DELETE FROM title_streams');
  mock.state.calls.length = 0;
  mock.state.failOnce.clear();
  mock.state.slowOnce.clear();
  mock.state.alwaysFail.clear();
});

describe('importArchive mot falsk Archive', () => {
  it('lagrer lovlige, koblede titler med riktig lisens, varighet og undertekst', async () => {
    const summary = await run();
    expect(summary).toMatchObject({
      scanned: DEFAULT_ITEMS.length,
      unlawful: 1,
      unlinked: 1,
      noFile: 1,
      failed: 0,
      imported: 5,
    });
    const rows = await streams();
    expect(rows.map((r) => r.title_id)).toEqual([
      'tt0068646',
      'tt0110912',
      'tt0111161',
      'tt0133093',
      'tt0211915',
    ]);
    const by = Object.fromEntries(rows.map((r) => [r.title_id, r]));
    expect(by.tt0111161).toMatchObject({
      archive_id: 'mock-shawshank',
      file_name: 'mock-shawshank.webm',
      license: 'CC BY 4.0',
      license_url: 'https://creativecommons.org/licenses/by/4.0/',
      duration_seconds: 9,
      subtitles_file: null,
    });
    expect(by.tt0068646).toMatchObject({ license: 'Public Domain', license_url: null }); // kuratert samling
    expect(by.tt0133093).toMatchObject({ license: 'CC0', duration_seconds: 8 }); // tittel + år
    expect(by.tt0110912).toMatchObject({
      license: 'Public Domain',
      archive_id: 'mock-pulp-fiction',
    }); // år ±1
    expect(by.tt0211915).toMatchObject({ subtitles_file: 'mock-amelie.en.vtt' }); // aksenter
    // Ulovlig element (Oldboy) og element uten spillbar fil (Grave of the Fireflies) er ikke lagret.
    expect(by.tt0364569).toBeUndefined();
    expect(by.tt0095327).toBeUndefined();
  });

  it('leser flere sider via cursor', async () => {
    await run();
    const scrapes = mock.state.calls.filter((c) => c.startsWith('/services/search/v1/scrape'));
    expect(scrapes.length).toBe(Math.ceil(DEFAULT_ITEMS.length / 3));
    expect(scrapes.slice(1).every((c) => c.includes('cursor='))).toBe(true);
    expect(decodeURIComponent(scrapes[0]!)).toContain('mediatype:movies');
  });

  it('er idempotent: ny kjøring gir samme rader, ingen duplikater', async () => {
    await run();
    const first = (await streams()).map(({ imported_at: _, ...r }) => r);
    const again = await run();
    expect(again.imported).toBe(5);
    const second = await streams();
    expect(second.map(({ imported_at: _, ...r }) => r)).toEqual(first);
  });

  it('oppdaterer en eksisterende rad i stedet for å feile', async () => {
    await pool.query(
      `INSERT INTO title_streams (title_id, archive_id, file_name, license) VALUES ('tt0111161', 'old', 'old.mp4', 'x')`,
    );
    await run();
    const rows = await streams();
    expect(rows.find((r) => r.title_id === 'tt0111161')).toMatchObject({
      archive_id: 'mock-shawshank',
      license: 'CC BY 4.0',
    });
  });

  it('respekterer limit', async () => {
    const s = await run({ limit: 2 });
    expect(s.imported).toBe(2);
    expect(await streams()).toHaveLength(2);
  });

  it('prøver på nytt én gang ved 5xx og ved timeout', async () => {
    mock.state.failOnce.add('/metadata/mock-godfather');
    mock.state.slowOnce.add('/metadata/mock-matrix');
    const s = await run({ timeoutMs: 100, concurrency: 1 });
    expect(s.failed).toBe(0);
    expect(s.imported).toBe(5);
  });

  it('teller vedvarende feil og fortsetter med resten', async () => {
    mock.state.alwaysFail.add('/metadata/mock-matrix');
    const s = await run();
    expect(s.failed).toBe(1);
    expect(s.imported).toBe(4);
    expect((await streams()).some((r) => r.title_id === 'tt0133093')).toBe(false);
  });

  it('hopper over tvetydige titler, ugyldige id-er og duplikater (IMDb-ID vinner)', async () => {
    await pool.query(
      `INSERT INTO titles (id, title_type, primary_title, original_title, start_year)
       VALUES ('tt9990001', 'movie', 'Twin Film', 'Twin Film', 1940),
              ('tt9990002', 'movie', 'Twin Film', 'Twin Film', 1941),
              ('tt9990003', 'movie', 'Solo Film', 'Solo Film', 1950)
       ON CONFLICT DO NOTHING`,
    );
    const file = (id: string) => [{ name: `${id}.webm`, format: 'WebM', length: '10' }];
    const item = (identifier: string, extra: Record<string, unknown>): MockItem => ({
      scrape: { identifier, collection: 'feature_films', ...extra },
      files: file(identifier),
    });
    const custom = await startArchiveMock(0, {
      videoPath: path.join(dir, 'v.webm'),
      items: [
        item('twin', { title: 'Twin Film', year: '1940' }), // tvetydig
        item('solo-by-title', { title: 'Solo Film', year: '1950' }),
        item('solo-by-imdb', {
          title: 'Whatever',
          year: '2000',
          'external-identifier': 'urn:imdb:tt9990003',
        }),
        item('bad/id', { title: 'Solo Film', year: '1950' }), // ugyldig identifikator
      ],
    });
    try {
      const s = await run({ archiveUrl: `http://127.0.0.1:${custom.port}` });
      expect(s.unlinked).toBe(1);
      expect(s.duplicates).toBe(1);
      expect(s.imported).toBe(1);
      const rows = await streams();
      expect(rows).toHaveLength(1);
      expect(rows[0]).toMatchObject({ title_id: 'tt9990003', archive_id: 'solo-by-imdb' });
    } finally {
      await custom.close();
      await pool.query(`DELETE FROM titles WHERE id LIKE 'tt999000%'`);
    }
  });
});

describe('falsk Archive: nedlasting', () => {
  const url = () => `http://127.0.0.1:${mock.port}/download/mock-shawshank/mock-shawshank.webm`;

  it('serverer hele filen med riktig type og Accept-Ranges', async () => {
    const res = await fetch(url());
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toBe('video/webm');
    expect(res.headers.get('accept-ranges')).toBe('bytes');
    expect(res.headers.get('access-control-allow-origin')).toBe('*');
    expect((await res.arrayBuffer()).byteLength).toBe(VIDEO_BYTES);
  });

  it('svarer 206 med Content-Range på Range-forespørsler', async () => {
    const res = await fetch(url(), { headers: { range: 'bytes=0-99' } });
    expect(res.status).toBe(206);
    expect(res.headers.get('content-range')).toBe(`bytes 0-99/${VIDEO_BYTES}`);
    expect(res.headers.get('content-length')).toBe('100');
    expect((await res.arrayBuffer()).byteLength).toBe(100);

    const open = await fetch(url(), { headers: { range: 'bytes=9990-' } });
    expect(open.status).toBe(206);
    expect(open.headers.get('content-range')).toBe(`bytes 9990-9999/${VIDEO_BYTES}`);

    const suffix = await fetch(url(), { headers: { range: 'bytes=-10' } });
    expect(suffix.headers.get('content-range')).toBe(`bytes 9990-9999/${VIDEO_BYTES}`);
  });

  it('støtter HEAD med Range (uten kropp) og avviser ugyldig område med 416', async () => {
    const head = await fetch(url(), { method: 'HEAD', headers: { range: 'bytes=0-99' } });
    expect(head.status).toBe(206);
    expect(head.headers.get('content-length')).toBe('100');
    expect((await head.arrayBuffer()).byteLength).toBe(0);

    const bad = await fetch(url(), { headers: { range: `bytes=${VIDEO_BYTES}-` } });
    expect(bad.status).toBe(416);
    expect(bad.headers.get('content-range')).toBe(`bytes */${VIDEO_BYTES}`);
    expect((await fetch(url(), { headers: { range: 'lines=1-2' } })).status).toBe(416);
  });

  it('serverer undertekster som text/vtt og gir 404 for ukjente filer', async () => {
    const base = `http://127.0.0.1:${mock.port}/download/mock-amelie`;
    const vtt = await fetch(`${base}/mock-amelie.en.vtt`);
    expect(vtt.headers.get('content-type')).toContain('text/vtt');
    expect((await vtt.text()).startsWith('WEBVTT')).toBe(true);
    expect((await fetch(`${base}/nope.webm`)).status).toBe(404);
    expect((await fetch(`http://127.0.0.1:${mock.port}/download/nope/x.webm`)).status).toBe(404);
  });

  it('parseRange håndterer kanttilfeller', () => {
    expect(parseRange('bytes=0-0', 10)).toEqual({ start: 0, end: 0 });
    expect(parseRange('bytes=5-999', 10)).toEqual({ start: 5, end: 9 });
    expect(parseRange('bytes=-3', 10)).toEqual({ start: 7, end: 9 });
    expect(parseRange('bytes=-99', 10)).toEqual({ start: 0, end: 9 });
    expect(parseRange('bytes=-0', 10)).toBeNull();
    expect(parseRange('bytes=-', 10)).toBeNull();
    expect(parseRange('bytes=6-5', 10)).toBeNull();
    expect(parseRange('bytes=10-', 10)).toBeNull();
    expect(parseRange('bytes=0-1,4-5', 10)).toBeNull();
  });
});

describe('buildStream / validering', () => {
  const row = {
    title_id: 'tt1',
    archive_id: 'my-film_1944.v2',
    file_name: 'My Film (1944) #1.mp4',
    license: 'Public Domain',
    license_url: 'https://creativecommons.org/publicdomain/mark/1.0/',
    duration_seconds: 5400,
    subtitles_file: 'My Film.en.vtt',
  };

  it('bygger URL-er fra ARCHIVE_URL', () => {
    expect(buildStream(row, 'https://archive.org')).toEqual({
      url: 'https://archive.org/download/my-film_1944.v2/My%20Film%20(1944)%20%231.mp4',
      archiveUrl: 'https://archive.org/details/my-film_1944.v2',
      license: 'Public Domain',
      licenseUrl: 'https://creativecommons.org/publicdomain/mark/1.0/',
      durationSeconds: 5400,
      subtitlesUrl: 'https://archive.org/download/my-film_1944.v2/My%20Film.en.vtt',
    });
    expect(buildStream(row, 'http://localhost:3998/')?.archiveUrl).toBe(
      'http://localhost:3998/details/my-film_1944.v2',
    );
    expect(buildStream(row)?.url.startsWith(config.archiveUrl)).toBe(true);
  });

  it('gir null for ugyldig element-id eller filnavn', () => {
    const bad = (over: object) => buildStream({ ...row, ...over }, 'https://archive.org');
    for (const archive_id of ['a/b', '', '..', '.', 'a b', 'a?x=1', 'æ', 'a\n', 'x..y']) {
      expect(bad({ archive_id })).toBeNull();
    }
    for (const file_name of [
      '',
      '../x.mp4',
      'a/b.mp4',
      'a\\b.mp4',
      'a\u0000.mp4',
      'a\u001f.mp4',
      '..',
      'x'.repeat(300),
    ]) {
      expect(bad({ file_name })).toBeNull();
    }
  });

  it('dropper bare undertekst/lisenslenke når de er ugyldige', () => {
    const s = buildStream(
      { ...row, subtitles_file: '../evil.vtt', license_url: 'javascript:alert(1)' },
      'https://archive.org',
    );
    expect(s?.subtitlesUrl).toBeNull();
    expect(s?.licenseUrl).toBeNull();
    expect(s?.url).toContain('/download/');
  });

  it('hjelpefunksjonene', () => {
    expect(isSafeArchiveId('abc-1.2_x')).toBe(true);
    expect(isSafeFileName('film.mp4')).toBe(true);
    expect(isSafeFileName('film..mp4')).toBe(false);
  });
});

describe('API: stream, availableOnly og Facets.available', () => {
  const ARCHIVE = 'https://archive.test';
  let gql: (q: string, v?: Record<string, unknown>) => Promise<any>;

  beforeAll(async () => {
    const yoga = createApp({
      pool,
      production: false,
      archiveUrl: ARCHIVE,
      artwork: new ArtworkService({ pool, apiKey: undefined }),
    });
    gql = async (query, variables) => {
      const res = await yoga.fetch('http://localhost/graphql', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ query, variables }),
      });
      return res.json();
    };
  });
  beforeEach(async () => {
    // tt0000001 The Dark Knight (2008, MOVIE, Action/Crime/Drama), tt0000002 Dark City (1998, Sci-Fi/Mystery),
    // tt0000016 Dark (2017, SERIES), tt0111161 Shawshank (1994, ingen sjangre).
    await pool.query(
      `INSERT INTO title_streams (title_id, archive_id, file_name, license, duration_seconds, subtitles_file)
       VALUES ('tt0000001', 'dk', 'The Dark Knight.mp4', 'CC BY 4.0', 9000, 'dk.vtt'),
              ('tt0000002', 'dc', 'dc.mp4', 'Public Domain', NULL, NULL),
              ('tt0000016', 'series', 'a/b.mp4', 'Public Domain', 60, NULL)`,
    );
  });

  it('Title.stream bygger URL-er, og gir null uten rad eller med ugyldig data', async () => {
    const res = await gql(`{
      a: title(id: "tt0000001") { stream { url archiveUrl license licenseUrl durationSeconds subtitlesUrl } }
      b: title(id: "tt0000003") { stream { url } }
      c: title(id: "tt0000016") { stream { url } }
    }`);
    expect(res.errors).toBeUndefined();
    expect(res.data.a.stream).toEqual({
      url: `${ARCHIVE}/download/dk/The%20Dark%20Knight.mp4`,
      archiveUrl: `${ARCHIVE}/details/dk`,
      license: 'CC BY 4.0',
      licenseUrl: null,
      durationSeconds: 9000,
      subtitlesUrl: `${ARCHIVE}/download/dk/dk.vtt`,
    });
    expect(res.data.b.stream).toBeNull();
    expect(res.data.c.stream).toBeNull(); // filnavn med «/»
  });

  it('slår opp streams med én spørring per side (ikke N+1)', async () => {
    const spy = vi.spyOn(pool, 'query');
    try {
      const res = await gql(`{ search(first: 50) { edges { node { id stream { license } } } } }`);
      expect(res.errors).toBeUndefined();
      const lookups = spy.mock.calls.filter(([sql]) =>
        String(typeof sql === 'string' ? sql : (sql as any).text).includes('FROM title_streams'),
      );
      expect(lookups).toHaveLength(1);
      const by = Object.fromEntries(
        res.data.search.edges.map((e: any) => [e.node.id, e.node.stream]),
      );
      expect(by.tt0000001.license).toBe('CC BY 4.0');
      expect(by.tt0000003).toBeNull();
    } finally {
      spy.mockRestore();
    }
  });

  it('availableOnly gir bare titler med stream, i søk og totalCount', async () => {
    const res = await gql(
      `query($f: SearchFilters) { search(filters: $f, sort: {field: TITLE}) { totalCount edges { node { id } } } }`,
      { f: { availableOnly: true } },
    );
    expect(res.errors).toBeUndefined();
    expect(res.data.search.totalCount).toBe(3);
    expect(res.data.search.edges.map((e: any) => e.node.id)).toEqual([
      'tt0000016', // Dark
      'tt0000002', // Dark City
      'tt0000001', // The Dark Knight
    ]);
    const off = await gql(`query($f: SearchFilters) { search(filters: $f) { totalCount } }`, {
      f: { availableOnly: false },
    });
    expect(off.data.search.totalCount).toBeGreaterThan(40);
  });

  it('availableOnly kombineres med søk, andre filtre og paginering', async () => {
    const q = `query($q: String, $f: SearchFilters, $after: String) {
      search(query: $q, filters: $f, first: 1, sort: {field: TITLE}, after: $after) {
        totalCount pageInfo { hasNextPage endCursor } edges { node { id } } } }`;
    const p1 = await gql(q, { q: 'dark', f: { availableOnly: true, types: ['MOVIE'] } });
    expect(p1.data.search.totalCount).toBe(2);
    expect(p1.data.search.edges[0].node.id).toBe('tt0000002');
    const p2 = await gql(q, {
      q: 'dark',
      f: { availableOnly: true, types: ['MOVIE'] },
      after: p1.data.search.pageInfo.endCursor,
    });
    expect(p2.data.search.edges[0].node.id).toBe('tt0000001');
    expect(p2.data.search.pageInfo.hasNextPage).toBe(false);
    const none = await gql(q, { q: 'no such thing', f: { availableOnly: true } });
    expect(none.data.search.totalCount).toBe(0);
    expect(none.data.search.edges).toEqual([]);
  });

  it('facets: availableOnly begrenser alle fasetter, og available teller uten availableOnly', async () => {
    const F = `query($q: String, $f: SearchFilters) { facets(query: $q, filters: $f) {
      genres { value count } types { value count } available } }`;
    const plain = await gql(F, {});
    expect(plain.data.facets.available).toBe(3);
    const only = await gql(F, { f: { availableOnly: true } });
    expect(only.data.facets.available).toBe(3);
    expect(only.data.facets.types).toEqual([
      { value: 'MOVIE', count: 2 },
      { value: 'SERIES', count: 1 },
    ]);
    const drama = only.data.facets.genres.find((g: any) => g.value === 'Drama');
    expect(drama.count).toBe(2); // The Dark Knight og Dark (serie, ingen sjanger-endring i fixture)
  });

  it('Facets.available respekterer søk og andre filtre', async () => {
    const F = `query($q: String, $f: SearchFilters) { facets(query: $q, filters: $f) { available } }`;
    expect((await gql(F, { q: 'dark city' })).data.facets.available).toBe(1);
    expect((await gql(F, { f: { types: ['SERIES'] } })).data.facets.available).toBe(1);
    expect((await gql(F, { f: { types: ['MOVIE'], minRating: 8 } })).data.facets.available).toBe(1);
    expect((await gql(F, { f: { decades: [1990] } })).data.facets.available).toBe(1);
    expect((await gql(F, { q: 'zzzz' })).data.facets.available).toBe(0);
    // Uavhengig av availableOnly.
    expect(
      (await gql(F, { f: { types: ['SERIES'], availableOnly: true } })).data.facets.available,
    ).toBe(1);
  });

  it('spesialtegn i søket gir ingen SQL-feil sammen med availableOnly', async () => {
    const res = await gql(
      `query($q: String) { search(query: $q, filters: {availableOnly: true}) { totalCount } facets(query: $q, filters: {availableOnly: true}) { available } }`,
      { q: `'; DROP TABLE title_streams; -- %_\\` },
    );
    expect(res.errors).toBeUndefined();
    expect(res.data.search.totalCount).toBe(0);
    const { rows } = await pool.query('SELECT count(*)::int AS n FROM title_streams');
    expect(rows[0].n).toBe(3);
  });

  it('sletting av tittel fjerner streamen (ON DELETE CASCADE)', async () => {
    await pool.query(
      `INSERT INTO titles (id, title_type, primary_title, original_title, start_year)
       VALUES ('tt9999999', 'movie', 'Temp', 'Temp', 2000)`,
    );
    await pool.query(
      `INSERT INTO title_streams (title_id, archive_id, file_name, license) VALUES ('tt9999999', 'x', 'x.mp4', 'CC0')`,
    );
    await pool.query(`DELETE FROM titles WHERE id = 'tt9999999'`);
    const { rows } = await pool.query(`SELECT 1 FROM title_streams WHERE title_id = 'tt9999999'`);
    expect(rows).toHaveLength(0);
  });
});
