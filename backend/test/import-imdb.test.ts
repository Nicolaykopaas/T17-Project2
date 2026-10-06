import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { gzipSync } from 'node:zlib';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { config } from '../src/config.js';
import { createPool, type Pool } from '../src/db.js';
import { runImport } from '../scripts/import-imdb.js';
import { resetData } from './fixtures.js';

let pool: Pool;
let dir: string;

// Egne id-er langt unna fixturene, så testen kan rydde etter seg uten å røre resten.
const IDS = ['tt9100001', 'tt9100002', 'tt9100003'];

const writeData = (rows: { id: string; votes: number; genres: string; title?: string }[]) => {
  const basics = [
    'tconst\ttitleType\tprimaryTitle\toriginalTitle\tisAdult\tstartYear\tendYear\truntimeMinutes\tgenres',
    ...rows.map(
      (r) =>
        `${r.id}\tmovie\t${r.title ?? `Tittel ${r.id}`}\tOriginal ${r.id}\t0\t1999\t\\N\t100\t${r.genres}`,
    ),
  ].join('\n');
  const ratings = [
    'tconst\taverageRating\tnumVotes',
    ...rows.map((r) => `${r.id}\t7.5\t${r.votes}`),
  ].join('\n');
  writeFileSync(path.join(dir, 'title.basics.tsv.gz'), gzipSync(basics));
  writeFileSync(path.join(dir, 'title.ratings.tsv.gz'), gzipSync(ratings));
};

const xmins = async () =>
  (
    await pool.query<{ id: string; xmin: string }>(
      'SELECT id, xmin::text FROM titles WHERE id = ANY($1) ORDER BY id',
      [IDS],
    )
  ).rows;

const genresOf = async (id: string) =>
  (
    await pool.query<{ name: string }>(
      `SELECT g.name FROM title_genres tg JOIN genres g ON g.id = tg.genre_id
       WHERE tg.title_id = $1 ORDER BY g.name`,
      [id],
    )
  ).rows.map((r) => r.name);

beforeAll(async () => {
  pool = createPool(config.testDatabaseUrl);
  await resetData(pool);
  dir = mkdtempSync(path.join(tmpdir(), 'import-test-'));
});
afterAll(async () => {
  await pool.query('DELETE FROM titles WHERE id = ANY($1)', [IDS]);
  await pool.end();
  rmSync(dir, { recursive: true, force: true });
});

describe('runImport', () => {
  it('uendret omkjøring skriver ingen rader (xmin uendret) og beholder sjangerkoblingene', async () => {
    const data = IDS.map((id) => ({ id, votes: 5000, genres: 'Drama,Crime' }));
    writeData(data);
    await runImport(pool, { dataDir: dir, minVotes: 100 });
    const first = await xmins();
    expect(first).toHaveLength(3);
    expect(await genresOf('tt9100001')).toEqual(['Crime', 'Drama']);

    await runImport(pool, { dataDir: dir, minVotes: 100 });
    // Samme xmin = ingen ny radversjon, altså ingen bloat og ingen omberegning av GIN-indeksene.
    expect(await xmins()).toEqual(first);
    expect(await genresOf('tt9100001')).toEqual(['Crime', 'Drama']);
  });

  it('oppdaterer bare titlene som faktisk er endret, inkludert sjangrene', async () => {
    const before = await xmins();
    writeData([
      { id: 'tt9100001', votes: 5000, genres: 'Drama,Crime' },
      { id: 'tt9100002', votes: 7000, genres: 'Comedy' },
      { id: 'tt9100003', votes: 5000, genres: 'Drama,Crime' },
    ]);
    await runImport(pool, { dataDir: dir, minVotes: 100 });
    const after = await xmins();
    const changed = after.filter((a, i) => a.xmin !== before[i]!.xmin).map((r) => r.id);
    expect(changed).toEqual(['tt9100002']);
    expect(await genresOf('tt9100002')).toEqual(['Comedy']);
    expect(await genresOf('tt9100001')).toEqual(['Crime', 'Drama']);
  });

  it('sletter ikke titler som faller under minVotes ved omkjøring', async () => {
    writeData([{ id: 'tt9100001', votes: 5, genres: 'Drama' }]);
    await runImport(pool, { dataDir: dir, minVotes: 100 });
    expect((await xmins()).map((r) => r.id)).toEqual(IDS);
  });
});
