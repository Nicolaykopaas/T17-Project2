import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import pg from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { config } from '../src/config.js';
import { migrate } from './migrate.js';

// Eget skjema så schema_migrations og prøvetabellen ikke blander seg med testdatabasens egne.
const SCHEMA = 'migrate_test';

let admin: pg.Pool;
let pool: pg.Pool;
let dir: string;

beforeAll(async () => {
  admin = new pg.Pool({ connectionString: config.testDatabaseUrl, max: 1 });
  await admin.query(`DROP SCHEMA IF EXISTS ${SCHEMA} CASCADE`);
  await admin.query(`CREATE SCHEMA ${SCHEMA}`);
  // Samme type grense som createPool setter i API-et, men kort nok til at testen går raskt.
  pool = new pg.Pool({
    connectionString: config.testDatabaseUrl,
    max: 1,
    statement_timeout: 100,
    options: `-c search_path=${SCHEMA}`,
  });
  dir = mkdtempSync(path.join(tmpdir(), 'migrate-test-'));
  writeFileSync(
    path.join(dir, '001_slow.sql'),
    // Fire ganger poolens statement_timeout: ville blitt avbrutt uten SET i migrate().
    `SELECT pg_sleep(0.4);
     CREATE TABLE probe AS
       SELECT current_setting('statement_timeout') AS st, current_setting('lock_timeout') AS lt;`,
  );
});

afterAll(async () => {
  await pool.end();
  await admin.query(`DROP SCHEMA ${SCHEMA} CASCADE`);
  await admin.end();
  rmSync(dir, { recursive: true, force: true });
});

describe('migrate', () => {
  it('avbryter ikke en langsom setning og setter lock_timeout under migreringen', async () => {
    await expect(migrate(pool, () => {}, dir)).resolves.toEqual(['001_slow.sql']);
    const { rows } = await pool.query<{ st: string; lt: string }>('SELECT st, lt FROM probe');
    expect(rows[0]).toEqual({ st: '0', lt: '30s' });
  });

  it('gjenoppretter poolens grenser etterpå (tilkoblingen er delt med resten av prosessen)', async () => {
    const { rows } = await pool.query<{ st: string; lt: string }>(
      "SELECT current_setting('statement_timeout') AS st, current_setting('lock_timeout') AS lt",
    );
    expect(rows[0]).toEqual({ st: '100ms', lt: '0' });
  });

  it('er idempotent: kjører ingenting når alt er kjørt', async () => {
    await expect(migrate(pool, () => {}, dir)).resolves.toEqual([]);
  });
});
