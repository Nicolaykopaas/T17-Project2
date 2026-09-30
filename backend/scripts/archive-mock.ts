import { createReadStream } from 'node:fs';
import { stat } from 'node:fs/promises';
import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import type { AddressInfo } from 'node:net';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { repoRoot } from '../src/config.js';

/**
 * Falsk Internet Archive for utvikling, E2E og tester: internett er ikke alltid tilgjengelig, og
 * importen skal kunne testes uten å belaste archive.org. Svarer med samme form som Scrape API,
 * metadata-API og nedlasting (med Range-støtte, som nettleserens videospiller krever for spoling).
 * Elementene er oppdiktede, men koblet til titler i det syntetiske datasettet.
 */

export interface MockFile {
  name: string;
  format: string;
  size?: string;
  length?: string;
  source?: string;
}

export interface MockItem {
  /** Feltene Scrape API gir tilbake. */
  scrape: Record<string, unknown> & { identifier: string };
  files: MockFile[];
}

const CC_BY = 'https://creativecommons.org/licenses/by/4.0/';
const PD_MARK = 'https://creativecommons.org/publicdomain/mark/1.0/';
const CC0 = 'https://creativecommons.org/publicdomain/zero/1.0/';

const junk = (id: string): MockFile[] => [
  { name: `${id}.mkv`, format: 'Matroska', size: '2147483648', source: 'original', length: '5400' },
  { name: `${id}_meta.xml`, format: 'Metadata', size: '900' },
  { name: `${id}.torrent`, format: 'Archive BitTorrent', size: '12000' },
  { name: '__ia_thumb.jpg', format: 'Item Tile', size: '8000' },
];
// Videobytene er WebM, så de spillbare filene heter .webm; ellers ville Content-Type løyet.
const video = (id: string, length: string): MockFile => ({
  name: `${id}.webm`,
  format: 'WebM',
  size: '412000',
  length,
  source: 'derivative',
});

/** Koblet til FAMOUS-titlene i scripts/generate-fixture.ts (finnes i project2 og E2E-basen). */
export const DEFAULT_ITEMS: MockItem[] = [
  {
    // IMDb-ID i metadata + CC BY.
    scrape: {
      identifier: 'mock-shawshank',
      title: 'The Shawshank Redemption (mock)',
      year: '1994',
      licenseurl: CC_BY,
      'external-identifier': ['urn:imdb:tt0111161', 'urn:oclc:record:1234'],
      collection: ['opensource_movies'],
    },
    files: [...junk('mock-shawshank'), video('mock-shawshank', '8.5')],
  },
  {
    // Kuratert samling uten lisens-URL, IMDb-ID.
    scrape: {
      identifier: 'mock-godfather',
      title: 'The Godfather',
      year: '1972',
      'external-identifier': 'urn:imdb:tt0068646',
      collection: ['feature_films', 'movies'],
    },
    files: [...junk('mock-godfather'), video('mock-godfather', '00:00:08')],
  },
  {
    // Ingen IMDb-ID: kobles på tittel + år.
    scrape: {
      identifier: 'mock-matrix',
      title: 'The Matrix',
      year: 1999,
      licenseurl: CC0,
      collection: 'film_noir',
    },
    files: [...junk('mock-matrix'), video('mock-matrix', '8')],
  },
  {
    // Tittel med tegnsetting, og år bare i `date` og ett år feil (±1).
    scrape: {
      identifier: 'mock-pulp-fiction',
      title: 'Pulp Fiction!',
      date: '1995-01-01T00:00:00Z',
      licenseurl: PD_MARK,
      collection: ['silent_films'],
    },
    files: [...junk('mock-pulp-fiction'), video('mock-pulp-fiction', '0:08')],
  },
  {
    // Aksenter i tittelen og undertekster.
    scrape: {
      identifier: 'mock-amelie',
      title: 'Amelie',
      year: '2001',
      licenseurl: CC_BY,
      collection: ['opensource_movies'],
    },
    files: [
      ...junk('mock-amelie'),
      video('mock-amelie', '8.0'),
      { name: 'mock-amelie.en.vtt', format: 'WebVTT', size: '400' },
    ],
  },
  {
    // Ulovlig: «alle rettigheter forbeholdt», ikke i kuratert samling. Skal hoppes over.
    scrape: {
      identifier: 'mock-restricted',
      title: 'Oldboy',
      year: '2003',
      licenseurl: 'http://example.com/all-rights-reserved',
      'external-identifier': 'urn:imdb:tt0364569',
      collection: ['classic_tv'],
    },
    files: [...junk('mock-restricted'), video('mock-restricted', '8')],
  },
  {
    // Lovlig og koblet, men ingen fil nettleseren kan spille.
    scrape: {
      identifier: 'mock-no-video',
      title: 'Grave of the Fireflies',
      year: '1988',
      licenseurl: CC_BY,
      'external-identifier': 'urn:imdb:tt0095327',
    },
    files: [
      { name: 'mock-no-video.mkv', format: 'Matroska', size: '900000000' },
      { name: 'mock-no-video_meta.xml', format: 'Metadata' },
    ],
  },
  {
    // Lovlig, men finnes ikke hos IMDb-titlene våre.
    scrape: {
      identifier: 'mock-unknown-film',
      title: 'A Film Nobody Indexed',
      year: '1931',
      collection: ['feature_films'],
    },
    files: [...junk('mock-unknown-film'), video('mock-unknown-film', '8')],
  },
];

const WEBVTT = `WEBVTT

00:00:00.000 --> 00:00:04.000
Testtekst fra den falske Internet Archive.

00:00:04.000 --> 00:00:08.000
Andre replikk.
`;

export interface MockState {
  /** Alle forespørsler (sti + query), i rekkefølge. */
  calls: string[];
  /** Stier som svarer 503 én gang (for å teste retry). */
  failOnce: Set<string>;
  /** Stier som svarer for sent én gang (for å teste tidsgrense). */
  slowOnce: Set<string>;
  /** Stier som alltid svarer 500. */
  alwaysFail: Set<string>;
}

export interface ArchiveMock {
  port: number;
  server: Server;
  state: MockState;
  close: () => Promise<void>;
}

export interface ArchiveMockOptions {
  items?: MockItem[];
  /** Videofilen som serveres for alle videoer. Standard: e2e/fixtures/test-video.webm. */
  videoPath?: string;
  /** Maks elementer per Scrape-side (sidene deles opp med cursor). */
  pageSize?: number;
  /** Hvor lenge «for sent» varer for slowOnce. */
  slowMs?: number;
}

const TYPES: Record<string, string> = {
  '.webm': 'video/webm',
  '.mp4': 'video/mp4',
  '.ogv': 'video/ogg',
  '.mkv': 'video/x-matroska',
  '.vtt': 'text/vtt; charset=utf-8',
};

/** `bytes=a-b`, `bytes=a-` og `bytes=-n`. null = ugyldig eller utenfor filen (416). */
export function parseRange(header: string, size: number): { start: number; end: number } | null {
  const m = /^bytes=(\d*)-(\d*)$/.exec(header.trim());
  if (!m || (m[1] === '' && m[2] === '')) return null;
  let start: number;
  let end: number;
  if (m[1] === '') {
    const n = Number(m[2]);
    if (n === 0) return null;
    start = Math.max(0, size - n);
    end = size - 1;
  } else {
    start = Number(m[1]);
    end = m[2] === '' ? size - 1 : Math.min(Number(m[2]), size - 1);
  }
  return start <= end && start < size ? { start, end } : null;
}

export async function startArchiveMock(
  port = 0,
  opts: ArchiveMockOptions = {},
): Promise<ArchiveMock> {
  const items = opts.items ?? DEFAULT_ITEMS;
  const videoPath = opts.videoPath ?? path.join(repoRoot, 'e2e', 'fixtures', 'test-video.webm');
  const pageSize = opts.pageSize ?? 1000;
  const state: MockState = {
    calls: [],
    failOnce: new Set(),
    slowOnce: new Set(),
    alwaysFail: new Set(),
  };

  const server = createServer((req, res) => {
    void handle(req, res).catch(() => {
      if (!res.headersSent) res.writeHead(500);
      res.end();
    });
  });

  async function handle(req: IncomingMessage, res: ServerResponse) {
    const url = new URL(req.url ?? '/', 'http://localhost');
    // Åpen CORS: spilleren i nettleseren henter video og undertekster fra en annen opprinnelse.
    res.setHeader('access-control-allow-origin', '*');
    res.setHeader('access-control-expose-headers', 'accept-ranges, content-range, content-length');
    if (req.method === 'OPTIONS') {
      res.writeHead(204, {
        'access-control-allow-methods': 'GET, HEAD, OPTIONS',
        'access-control-allow-headers': 'range, content-type',
      });
      return res.end();
    }
    const json = (status: number, body: unknown) => {
      res.writeHead(status, { 'content-type': 'application/json' });
      res.end(JSON.stringify(body));
    };
    state.calls.push(url.pathname + url.search);

    if (url.pathname.startsWith('/services/') || url.pathname.startsWith('/metadata/')) {
      if (state.alwaysFail.has(url.pathname)) return json(500, { error: 'Mock failure' });
      if (state.failOnce.delete(url.pathname)) return json(503, { error: 'Mock unavailable' });
      if (state.slowOnce.delete(url.pathname)) {
        await new Promise((r) => setTimeout(r, opts.slowMs ?? 500));
      }
    }

    if (url.pathname === '/services/search/v1/scrape') {
      const count = Math.max(1, Math.min(Number(url.searchParams.get('count')) || 1000, pageSize));
      const offset = Number(Buffer.from(url.searchParams.get('cursor') ?? '', 'base64url')) || 0;
      const wanted = (url.searchParams.get('fields') ?? 'identifier').split(',');
      const slice = items.slice(offset, offset + count);
      const body: Record<string, unknown> = {
        items: slice.map((i) =>
          Object.fromEntries(
            Object.entries(i.scrape).filter(([k]) => k === 'identifier' || wanted.includes(k)),
          ),
        ),
        count: slice.length,
        total: items.length,
      };
      // Som ekte Scrape API: cursor finnes bare når det er mer å hente.
      if (offset + count < items.length) {
        body.cursor = Buffer.from(String(offset + count)).toString('base64url');
      }
      return json(200, body);
    }

    const meta = /^\/metadata\/([^/]+)$/.exec(url.pathname);
    if (meta) {
      const item = items.find((i) => i.scrape.identifier === decodeURIComponent(meta[1]!));
      // Ekte Archive svarer 200 med {} for ukjente elementer.
      if (!item) return json(200, {});
      return json(200, {
        created: 1700000000,
        d1: 'ia800000.us.archive.org',
        dir: `/0/items/${item.scrape.identifier}`,
        files: item.files,
        metadata: { identifier: item.scrape.identifier, mediatype: 'movies' },
      });
    }

    const details = /^\/details\/([^/]+)$/.exec(url.pathname);
    if (details) {
      const id = decodeURIComponent(details[1]!).replace(/[^A-Za-z0-9._-]/g, '');
      res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
      return res.end(
        `<!doctype html><meta charset="utf-8"><title>${id}</title><h1>Falsk Internet Archive: ${id}</h1>`,
      );
    }

    const download = /^\/download\/([^/]+)\/([^/]+)$/.exec(url.pathname);
    if (download && (req.method === 'GET' || req.method === 'HEAD')) {
      const item = items.find((i) => i.scrape.identifier === decodeURIComponent(download[1]!));
      const name = decodeURIComponent(download[2]!);
      const file = item?.files.find((f) => f.name === name);
      const ext = path.extname(name).toLowerCase();
      if (!file || !TYPES[ext]) {
        res.writeHead(404, { 'content-type': 'text/plain' });
        return res.end('Not found');
      }
      if (ext === '.vtt') {
        res.writeHead(200, {
          'content-type': TYPES[ext]!,
          'content-length': Buffer.byteLength(WEBVTT),
        });
        return res.end(req.method === 'HEAD' ? undefined : WEBVTT);
      }
      return serveVideo(req, res, videoPath, TYPES[ext]!);
    }

    json(404, { error: 'Not found' });
  }

  await new Promise<void>((resolve, reject) => {
    server.once('error', reject);
    server.listen(port, resolve);
  });
  return {
    port: (server.address() as AddressInfo).port,
    server,
    state,
    close: () =>
      new Promise<void>((resolve) => {
        server.closeAllConnections();
        server.close(() => resolve());
      }),
  };
}

async function serveVideo(
  req: IncomingMessage,
  res: ServerResponse,
  file: string,
  contentType: string,
) {
  let size: number;
  try {
    size = (await stat(file)).size;
  } catch {
    res.writeHead(503, { 'content-type': 'text/plain' });
    return res.end(`Testvideoen mangler: ${file}`);
  }
  const base = { 'content-type': contentType, 'accept-ranges': 'bytes' };
  const rangeHeader = req.headers.range;
  if (rangeHeader === undefined) {
    res.writeHead(200, { ...base, 'content-length': size });
    if (req.method === 'HEAD') return res.end();
    return createReadStream(file).pipe(res);
  }
  const range = parseRange(rangeHeader, size);
  if (!range) {
    res.writeHead(416, { ...base, 'content-range': `bytes */${size}` });
    return res.end();
  }
  res.writeHead(206, {
    ...base,
    'content-range': `bytes ${range.start}-${range.end}/${size}`,
    'content-length': range.end - range.start + 1,
  });
  if (req.method === 'HEAD') return res.end();
  createReadStream(file, { start: range.start, end: range.end }).pipe(res);
}

async function main() {
  const port = Number.parseInt(process.env.ARCHIVE_MOCK_PORT ?? '', 10) || 3998;
  const mock = await startArchiveMock(port);
  console.log(`Falsk Internet Archive på http://localhost:${mock.port}`);
  const stop = () => void mock.close().then(() => process.exit(0));
  process.on('SIGINT', stop);
  process.on('SIGTERM', stop);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((err) => {
    console.error(err instanceof Error ? err.message : err);
    process.exit(1);
  });
}
