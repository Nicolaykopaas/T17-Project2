import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { config } from '../src/config.js';
import { createPool, type Pool } from '../src/db.js';

// Ligger i backend/migrations både når vi kjører via tsx (scripts/) og fra kompilert kode (dist/scripts/).
function findMigrationsDir(): string {
  let dir = path.dirname(fileURLToPath(import.meta.url));
  for (let i = 0; i < 4; i++) {
    const candidate = path.join(dir, 'migrations');
    try {
      if (readdirSync(candidate).some((f) => f.endsWith('.sql'))) return candidate;
    } catch {
      // prøv ett nivå opp
    }
    dir = path.dirname(dir);
  }
  throw new Error('Fant ikke backend/migrations.');
}

// Vilkårlig, fast nøkkel: hindrer at to prosesser (f.eks. parallelle CI-jobber mot samme
// database) migrerer samtidig.
const LOCK_KEY = 281_001;

/**
 * Kjører alle migrasjoner som ikke er kjørt ennå, i filnavnrekkefølge, hver i sin transaksjon.
 * Trygt å kjøre flere ganger. Returnerer navnene på migrasjonene som ble kjørt nå.
 */
export async function migrate(
  pool: Pool,
  log: (msg: string) => void = () => {},
  dir: string = findMigrationsDir(),
): Promise<string[]> {
  const files = readdirSync(dir)
    .filter((f) => /^\d+_.+\.sql$/.test(f))
    .sort();

  // Egen tilkobling: advisory lock er knyttet til sesjonen, ikke til poolen.
  const client = await pool.connect();
  const applied: string[] = [];
  try {
    // Poolens statement_timeout (15 s) er et vern mot løpske spørringer fra API-et, ikke mot
    // migreringer: ALTER TABLE ... ADD COLUMN ... STORED skriver om hele titles og tar 10-20 s
    // eller mer på VM-en med 190 000 titler. En avbrutt migrering ruller tilbake og kan aldri
    // fullføres. lock_timeout i stedet for å vente evig på en lås som en hengende økt holder.
    await client.query('SET statement_timeout = 0');
    await client.query("SET lock_timeout = '30s'");
    await client.query('SELECT pg_advisory_lock($1)', [LOCK_KEY]);
    await client.query(`CREATE TABLE IF NOT EXISTS schema_migrations (
      name       text PRIMARY KEY,
      applied_at timestamptz NOT NULL DEFAULT now()
    )`);
    const done = new Set(
      (await client.query<{ name: string }>('SELECT name FROM schema_migrations')).rows.map(
        (r) => r.name,
      ),
    );
    for (const file of files) {
      if (done.has(file)) continue;
      const sql = readFileSync(path.join(dir, file), 'utf8');
      try {
        await client.query('BEGIN');
        await client.query(sql);
        await client.query('INSERT INTO schema_migrations (name) VALUES ($1)', [file]);
        await client.query('COMMIT');
      } catch (err) {
        await client.query('ROLLBACK');
        throw new Error(`Migrering ${file} feilet: ${(err as Error).message}`);
      }
      log(`Kjørte ${file}`);
      applied.push(file);
    }
  } finally {
    await client.query('SELECT pg_advisory_unlock($1)', [LOCK_KEY]).catch(() => {});
    // Tilkoblingen går tilbake til poolen; uten RESET ville resten av prosessen (f.eks. importen)
    // fortsatt kjørt uten statement_timeout.
    await client.query('RESET statement_timeout; RESET lock_timeout').catch(() => {});
    client.release();
  }
  return applied;
}

async function main() {
  const pool = createPool(config.databaseUrl);
  try {
    const applied = await migrate(pool, console.log);
    console.log(applied.length ? `${applied.length} migrering(er) kjørt.` : 'Databasen er à jour.');
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
