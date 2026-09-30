import { pathToFileURL } from 'node:url';
import { ArtworkService, type TitleKind } from '../src/artwork.js';
import { config } from '../src/config.js';
import { createPool, type Pool } from '../src/db.js';

/**
 * Forhåndshenter bilder for de mest populære titlene, slik at de første søkene i en demo ikke
 * må vente på TMDB. Trygt å avbryte (Ctrl+C) og kjøre på nytt: titler som allerede har rad
 * i title_artwork hoppes over.
 */

export interface PrefetchSummary {
  found: number;
  missing: number;
  errors: number;
  stoppedBy: 'done' | 'signal' | 'rejected-key';
}

export async function prefetchArtwork(
  pool: Pool,
  service: ArtworkService,
  opts: {
    limit: number;
    ratePerSecond?: number;
    signal?: { aborted: boolean };
    log?: (msg: string) => void;
  },
): Promise<PrefetchSummary> {
  const log = opts.log ?? (() => {});
  const interval = 1000 / (opts.ratePerSecond ?? 30);
  const { rows } = await pool.query<{ id: string; title_type: 'movie' | 'series' }>(
    `SELECT t.id, t.title_type FROM titles t
     WHERE NOT EXISTS (SELECT 1 FROM title_artwork a WHERE a.title_id = t.id)
     ORDER BY t.num_votes DESC, t.id
     LIMIT $1`,
    [opts.limit],
  );
  log(`${rows.length} titler å hente.`);

  const summary: PrefetchSummary = { found: 0, missing: 0, errors: 0, stoppedBy: 'done' };
  const running = new Set<Promise<void>>();
  let nextStart = Date.now();
  let done = 0;

  for (const row of rows) {
    if (opts.signal?.aborted) {
      summary.stoppedBy = 'signal';
      break;
    }
    if (!service.enabled) {
      summary.stoppedBy = 'rejected-key';
      break;
    }
    // Jevn takt i stedet for salver på 30: TMDB teller per sekund.
    const wait = nextStart - Date.now();
    if (wait > 0) await new Promise((r) => setTimeout(r, wait));
    nextStart = Math.max(nextStart, Date.now()) + interval;

    const kind: TitleKind = row.title_type === 'movie' ? 'MOVIE' : 'SERIES';
    const p = service.lookup(row.id, kind).then((o) => {
      if (o.kind === 'found') summary.found++;
      else if (o.kind === 'missing') summary.missing++;
      else if (o.kind === 'error') summary.errors++;
      if (++done % 100 === 0) {
        log(
          `${done}/${rows.length} (funnet ${summary.found}, ukjent ${summary.missing}, feil ${summary.errors})`,
        );
      }
    });
    running.add(p);
    void p.finally(() => running.delete(p));
    // Ikke la køen av ventende oppslag vokse ubegrenset hvis TMDB er treg.
    if (running.size >= 64) await Promise.race(running);
  }
  await Promise.all(running);
  return summary;
}

async function main() {
  if (!config.tmdbApiKey) {
    throw new Error('TMDB_API_KEY er ikke satt (se docs/oppsett.md).');
  }
  const arg = process.argv[2] ?? process.env.ARTWORK_LIMIT;
  const limit = Number.parseInt(arg ?? '', 10) || 2000;
  const pool = createPool(config.databaseUrl);
  const service = new ArtworkService({ pool, apiKey: config.tmdbApiKey, disableMs: 3_600_000 });
  const signal = { aborted: false };
  process.on('SIGINT', () => {
    console.log('\nAvbryter etter pågående oppslag …');
    signal.aborted = true;
  });
  try {
    const s = await prefetchArtwork(pool, service, { limit, signal, log: console.log });
    console.log(
      `Ferdig (${s.stoppedBy}): ${s.found} funnet, ${s.missing} ukjent hos TMDB, ${s.errors} feilet. Kjør på nytt for å prøve de feilede.`,
    );
    if (s.stoppedBy === 'rejected-key') process.exitCode = 1;
  } finally {
    await pool.end();
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((err) => {
    console.error(err instanceof Error ? err.message : err);
    process.exit(1);
  });
}
