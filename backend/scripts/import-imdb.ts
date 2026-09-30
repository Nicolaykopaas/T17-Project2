import { createReadStream, existsSync } from 'node:fs';
import path from 'node:path';
import { createInterface } from 'node:readline';
import { pathToFileURL } from 'node:url';
import { createGunzip } from 'node:zlib';
import { config } from '../src/config.js';
import { createPool, type Pool } from '../src/db.js';
import {
  isHeaderLine,
  parseBasicsLine,
  parseRatingLine,
  type Rating,
  type TitleRow,
} from './import-core.js';
import { migrate } from './migrate.js';

const BATCH_SIZE = 2000;

/** Leser en .tsv.gz linje for linje. Aldri hele fila i minnet – basics er flere hundre MB pakket ut. */
async function* readLines(file: string): AsyncGenerator<string> {
  const rl = createInterface({
    input: createReadStream(file).pipe(createGunzip()),
    crlfDelay: Infinity,
  });
  for await (const line of rl) yield line;
}

export interface ImportOptions {
  dataDir: string;
  minVotes: number;
  log?: (msg: string) => void;
}

export function importFiles(dataDir: string) {
  return {
    basics: path.join(dataDir, 'title.basics.tsv.gz'),
    ratings: path.join(dataDir, 'title.ratings.tsv.gz'),
  };
}

/**
 * Ratings leses først og bare rader over stemmegrensen huskes i et Map (i ekte data er det
 * en liten del av filene). Basics strømmes deretter og slås opp mot dette, så vi slipper en
 * staging-tabell og kan gi en enkel, parameterisert upsert.
 */
async function loadRatings(file: string, minVotes: number, log: (m: string) => void) {
  const ratings = new Map<string, Rating>();
  let lines = 0;
  for await (const line of readLines(file)) {
    lines++;
    if (isHeaderLine(line)) continue;
    const parsed = parseRatingLine(line);
    if (parsed && parsed.rating.numVotes >= minVotes) ratings.set(parsed.tconst, parsed.rating);
    if (lines % 500_000 === 0) log(`  ratings: ${lines} linjer lest`);
  }
  log(`Ratings: ${lines - 1} linjer, ${ratings.size} med minst ${minVotes} stemmer.`);
  return ratings;
}

/**
 * Upsert av én batch. Arrays sendes som én parameter per kolonne og pakkes ut med unnest():
 * få parametere uansett batch-størrelse, og data blir aldri limt inn i SQL-teksten.
 */
async function upsertBatch(pool: Pool, rows: TitleRow[]): Promise<void> {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await client.query(
      `INSERT INTO titles (id, title_type, primary_title, original_title, start_year, end_year,
                           runtime_minutes, average_rating, num_votes, genres)
       SELECT id, title_type, primary_title, original_title, start_year, end_year,
              runtime_minutes, average_rating, num_votes,
              string_to_array(genres_csv, ',')
       FROM unnest($1::text[], $2::text[], $3::text[], $4::text[], $5::int[], $6::int[],
                   $7::int[], $8::numeric[], $9::int[], $10::text[])
         AS t(id, title_type, primary_title, original_title, start_year, end_year,
              runtime_minutes, average_rating, num_votes, genres_csv)
       ON CONFLICT (id) DO UPDATE SET
         title_type = EXCLUDED.title_type,
         primary_title = EXCLUDED.primary_title,
         original_title = EXCLUDED.original_title,
         start_year = EXCLUDED.start_year,
         end_year = EXCLUDED.end_year,
         runtime_minutes = EXCLUDED.runtime_minutes,
         average_rating = EXCLUDED.average_rating,
         num_votes = EXCLUDED.num_votes,
         genres = EXCLUDED.genres`,
      [
        rows.map((r) => r.id),
        rows.map((r) => r.titleType),
        rows.map((r) => r.primaryTitle),
        rows.map((r) => r.originalTitle),
        rows.map((r) => r.startYear),
        rows.map((r) => r.endYear),
        rows.map((r) => r.runtimeMinutes),
        rows.map((r) => r.averageRating),
        rows.map((r) => r.numVotes),
        // Sjangernavn inneholder aldri komma (IMDb skiller dem med komma).
        rows.map((r) => r.genres.join(',')),
      ],
    );

    // Normalisert kopi: nye sjangre, og title_genres bygges på nytt for titlene i batchen
    // slik at en endret sjangerliste ved omkjøring ikke etterlater gamle koblinger.
    const pairsTitle: string[] = [];
    const pairsGenre: string[] = [];
    for (const r of rows) {
      for (const g of r.genres) {
        pairsTitle.push(r.id);
        pairsGenre.push(g);
      }
    }
    await client.query(
      `INSERT INTO genres (name) SELECT DISTINCT g FROM unnest($1::text[]) AS g ON CONFLICT (name) DO NOTHING`,
      [pairsGenre],
    );
    await client.query('DELETE FROM title_genres WHERE title_id = ANY($1::text[])', [
      rows.map((r) => r.id),
    ]);
    await client.query(
      `INSERT INTO title_genres (title_id, genre_id)
       SELECT p.title_id, g.id
       FROM unnest($1::text[], $2::text[]) AS p(title_id, genre)
       JOIN genres g ON g.name = p.genre
       ON CONFLICT DO NOTHING`,
      [pairsTitle, pairsGenre],
    );
    await client.query('COMMIT');
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}

export async function runImport(pool: Pool, opts: ImportOptions): Promise<{ imported: number }> {
  const log = opts.log ?? (() => {});
  const files = importFiles(opts.dataDir);
  const missing = Object.values(files).filter((f) => !existsSync(f));
  if (missing.length > 0) {
    throw new Error(
      `Fant ikke datafilene:\n  ${missing.join('\n  ')}\n` +
        'Last dem ned fra https://datasets.imdbws.com eller generer syntetiske filer med ' +
        '`npm run db:fixture -w backend`. Se docs/oppsett.md.',
    );
  }

  const started = Date.now();
  const ratings = await loadRatings(files.ratings, opts.minVotes, log);

  let batch: TitleRow[] = [];
  let lines = 0;
  let imported = 0;
  for await (const line of readLines(files.basics)) {
    lines++;
    if (isHeaderLine(line)) continue;
    const row = parseBasicsLine(line, ratings, opts.minVotes);
    if (row) batch.push(row);
    if (batch.length >= BATCH_SIZE) {
      await upsertBatch(pool, batch);
      imported += batch.length;
      batch = [];
      if (imported % (BATCH_SIZE * 10) === 0)
        log(`  basics: ${lines} linjer lest, ${imported} titler lagret`);
    }
  }
  if (batch.length > 0) {
    await upsertBatch(pool, batch);
    imported += batch.length;
  }
  // Oppdaterer statistikken så planleggeren velger riktige indekser rett etter en stor innlasting.
  await pool.query('ANALYZE titles');
  log(
    `Ferdig: ${imported} titler av ${lines - 1} linjer på ${((Date.now() - started) / 1000).toFixed(1)} s.`,
  );
  return { imported };
}

async function main() {
  const pool = createPool(config.databaseUrl);
  try {
    await migrate(pool, console.log);
    await runImport(pool, {
      dataDir: config.imdbDataDir,
      minVotes: config.imdbMinVotes,
      log: console.log,
    });
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
