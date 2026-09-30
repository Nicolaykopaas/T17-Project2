import { execSync } from 'node:child_process';
import path from 'node:path';
import pg from 'pg';

const E2E_DATABASE_URL =
  process.env.E2E_DATABASE_URL ?? 'postgres://postgres@localhost:5432/project2_e2e';
// Egen datamappe slik at et syntetisk datasett aldri overskriver ekte IMDb-filer i data/.
const DATA_DIR = path.resolve(import.meta.dirname, '..', 'data', 'e2e');
const FIXTURE_SIZE = '20000';

/**
 * Sørger for en E2E-database med kjent innhold: opprettes ved behov, migreres, fylles med det
 * deterministiske syntetiske datasettet første gang, og tømmes for brukerdata hver kjøring slik at
 * testene ikke avhenger av hverandre eller av forrige kjøring.
 */
export default async function globalSetup() {
  const url = new URL(E2E_DATABASE_URL);
  const dbName = url.pathname.slice(1);
  const admin = new pg.Client({
    connectionString: Object.assign(new URL(url), { pathname: '/postgres' }).toString(),
  });
  await admin.connect();
  const exists = await admin.query('SELECT 1 FROM pg_database WHERE datname = $1', [dbName]);
  if (exists.rowCount === 0) await admin.query(`CREATE DATABASE "${dbName.replace(/"/g, '""')}"`);
  await admin.end();

  const env = { ...process.env, DATABASE_URL: E2E_DATABASE_URL, IMDB_DATA_DIR: DATA_DIR };
  const run = (cmd: string) => execSync(cmd, { env, stdio: 'inherit' });
  run('npm run db:migrate -w backend');

  const db = new pg.Client({ connectionString: E2E_DATABASE_URL });
  await db.connect();
  const { rows } = await db.query<{ n: string }>('SELECT count(*) AS n FROM titles');
  if (Number(rows[0]?.n ?? 0) === 0) {
    run(`npm run db:fixture -w backend -- ${FIXTURE_SIZE}`);
    run('npm run db:seed -w backend');
  }
  await db.query('TRUNCATE reviews, list_items');
  await db.end();
}
