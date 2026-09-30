import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { pathToFileURL } from 'node:url';
import { config } from '../src/config.js';
import { createPool, type Pool } from '../src/db.js';

/**
 * Falsk TMDB for utvikling, E2E og tester: internett er ikke alltid tilgjengelig, og vi vil
 * ikke bruke en ekte nøkkel (eller bryte TMDBs vilkår) i CI. Svarer med samme form som TMDB,
 * og tegner plakater som SVG på sparket.
 */

export interface MockState {
  /** Forsinkelse før /find svarer (for å teste tidsgrenser). */
  delayMs: number;
  /** Tving denne HTTP-statusen fra /find (f.eks. 500 eller 429). */
  failStatus: number | null;
  /** Titler som alltid svarer med tomme lister, i tillegg til hver 10. id. */
  emptyIds: Set<string>;
  /** Alle /find-kall (imdb-id), i rekkefølge. */
  calls: string[];
}

export interface TmdbMock {
  port: number;
  server: Server;
  state: MockState;
  close: () => Promise<void>;
}

const idNumber = (id: string) => Number.parseInt(id.replace(/\D/g, ''), 10) || 0;

// Kontrolltegn er ugyldige i XML 1.0 og ville gjort hele SVG-en ulesbar.
const esc = (s: string) =>
  [...s]
    .filter((c) => c.charCodeAt(0) >= 32)
    .join('')
    .replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);

function hue(id: string): number {
  // Litt spredning av tett nummererte id-er, ellers får nabotitler nesten lik farge.
  return (idNumber(id) * 137.508) % 360;
}

/** Bryter tittelen i linjer på ca. `max` tegn uten å splitte ord (lange ord kuttes ikke). */
function wrap(text: string, max: number): string[] {
  const lines: string[] = [];
  let line = '';
  for (const word of text.split(/\s+/).filter(Boolean)) {
    if (line && (line + ' ' + word).length > max) {
      lines.push(line);
      line = word;
    } else line = line ? `${line} ${word}` : word;
  }
  if (line) lines.push(line);
  return lines.slice(0, 5);
}

export function renderSvg(id: string, title: string, backdrop: boolean): string {
  const h = hue(id);
  const [w, hgt] = backdrop ? [320, 180] : [200, 300];
  const lines = wrap(title, backdrop ? 26 : 12);
  const size = backdrop ? 22 : 24;
  const startY = hgt / 2 - ((lines.length - 1) * size * 1.2) / 2;
  const text = lines
    .map((l, i) => `<tspan x="${w / 2}" y="${startY + i * size * 1.2}">${esc(l)}</tspan>`)
    .join('');
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${w} ${hgt}" role="img" aria-label="${esc(title)}">
<defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="hsl(${h.toFixed(0)} 60% 32%)"/><stop offset="1" stop-color="hsl(${((h + 50) % 360).toFixed(0)} 65% 14%)"/></linearGradient></defs>
<rect width="${w}" height="${hgt}" fill="url(#g)"/>
<text fill="#fff" font-family="system-ui, sans-serif" font-weight="700" font-size="${size}" text-anchor="middle" dominant-baseline="middle">${text}</text>
</svg>`;
}

const ADJECTIVES = ['quiet', 'reckless', 'unlikely', 'haunted', 'restless', 'ambitious', 'faded'];
const NOUNS = ['detective', 'family', 'astronaut', 'musician', 'stranger', 'chef', 'soldier'];
const GOALS = [
  'uncover a long-buried secret',
  'save a failing town',
  'outrun a past mistake',
  'win one last impossible game',
  'find their way home',
];

function overviewFor(id: string): string {
  const n = idNumber(id);
  return `A ${ADJECTIVES[n % ADJECTIVES.length]} ${NOUNS[(n >> 3) % NOUNS.length]} sets out to ${GOALS[(n >> 5) % GOALS.length]}.`;
}

export interface MockOptions {
  /** Brukes til å slå opp tittelen som tegnes på plakaten. Uten den brukes id-en. */
  pool?: Pool;
  delayMs?: number;
}

export async function startTmdbMock(port = 0, opts: MockOptions = {}): Promise<TmdbMock> {
  const state: MockState = {
    delayMs: opts.delayMs ?? 0,
    failStatus: null,
    emptyIds: new Set(),
    calls: [],
  };
  const titleCache = new Map<string, string>();
  const titleOf = async (id: string): Promise<string> => {
    const hit = titleCache.get(id);
    if (hit) return hit;
    let title = id;
    if (opts.pool) {
      try {
        const { rows } = await opts.pool.query<{ primary_title: string }>(
          'SELECT primary_title FROM titles WHERE id = $1',
          [id],
        );
        title = rows[0]?.primary_title ?? id;
      } catch {
        // Uten tittel duger id-en; plakaten er bare pynt.
      }
    }
    if (titleCache.size > 5000) titleCache.clear();
    titleCache.set(id, title);
    return title;
  };

  const server = createServer((req, res) => {
    void handle(req.url ?? '/', req.headers, res).catch(() => {
      if (!res.headersSent) res.writeHead(500);
      res.end();
    });
  });

  async function handle(
    rawUrl: string,
    headers: import('node:http').IncomingHttpHeaders,
    res: import('node:http').ServerResponse,
  ) {
    const url = new URL(rawUrl, 'http://localhost');
    const json = (status: number, body: unknown) => {
      res.writeHead(status, { 'content-type': 'application/json' });
      res.end(JSON.stringify(body));
    };

    const find = /^\/3\/find\/([^/]+)$/.exec(url.pathname);
    if (find) {
      const id = decodeURIComponent(find[1]!);
      state.calls.push(id);
      const authed =
        url.searchParams.get('api_key') || /^Bearer .+/.test(headers.authorization ?? '');
      if (!authed) return json(401, { status_code: 7, status_message: 'Invalid API key.' });
      if (state.delayMs > 0) await new Promise((r) => setTimeout(r, state.delayMs));
      if (state.failStatus) return json(state.failStatus, { status_message: 'Mock failure' });
      const n = idNumber(id);
      // Hver 10. id er ukjent for TMDB, slik at «missing»-stien testes i praksis.
      if (n % 10 === 0 || state.emptyIds.has(id)) {
        return json(200, { movie_results: [], tv_results: [] });
      }
      const result = {
        id: n,
        poster_path: `/${id}.svg`,
        backdrop_path: `/${id}-bg.svg`,
        overview: overviewFor(id),
      };
      // Annenhver id havner i tv_results uavhengig av IMDb-typen, så fallback-logikken testes.
      return json(
        200,
        n % 2 === 0
          ? { movie_results: [result], tv_results: [] }
          : { movie_results: [], tv_results: [result] },
      );
    }

    const img = /^\/t\/p\/w\d+\/([A-Za-z0-9._-]+)\.svg$/.exec(url.pathname);
    if (img) {
      const name = img[1]!;
      const backdrop = name.endsWith('-bg');
      const id = backdrop ? name.slice(0, -3) : name;
      const svg = renderSvg(id, await titleOf(id), backdrop);
      res.writeHead(200, {
        'content-type': 'image/svg+xml',
        'cache-control': 'public, max-age=86400',
        'access-control-allow-origin': '*',
      });
      return res.end(svg);
    }

    json(404, { status_message: 'Not found' });
  }

  await new Promise<void>((resolve, reject) => {
    server.once('error', reject);
    server.listen(port, resolve);
  });
  const actualPort = (server.address() as AddressInfo).port;
  return {
    port: actualPort,
    server,
    state,
    close: () =>
      new Promise<void>((resolve) => {
        server.closeAllConnections();
        server.close(() => resolve());
      }),
  };
}

async function main() {
  const port = Number.parseInt(process.env.TMDB_MOCK_PORT ?? '', 10) || 3999;
  const delayMs = Number.parseInt(process.env.TMDB_MOCK_DELAY_MS ?? '', 10) || 0;
  const pool = createPool(config.databaseUrl);
  const mock = await startTmdbMock(port, { pool, delayMs });
  console.log(`Falsk TMDB på http://localhost:${mock.port} (API: /3, bilder: /t/p)`);
  const stop = () =>
    void mock
      .close()
      .then(() => pool.end())
      .then(() => process.exit(0));
  process.on('SIGINT', stop);
  process.on('SIGTERM', stop);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((err) => {
    console.error(err instanceof Error ? err.message : err);
    process.exit(1);
  });
}
