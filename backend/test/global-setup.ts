import { config } from '../src/config.js';
import { createPool } from '../src/db.js';
import { migrate } from '../scripts/migrate.js';

/**
 * Kjøres én gang før alle testfiler: nullstiller testdatabasen og migrerer fra scratch, slik at
 * testene også verifiserer at migrasjonene virker på en tom database (som i GitLab CI).
 */
export default async function setup() {
  if (config.testDatabaseUrl === config.databaseUrl) {
    throw new Error(
      'TEST_DATABASE_URL må være en annen database enn DATABASE_URL – testene tømmer den.',
    );
  }
  const pool = createPool(config.testDatabaseUrl);
  try {
    await pool.query('DROP SCHEMA public CASCADE');
    await pool.query('CREATE SCHEMA public');
    await migrate(pool);
  } finally {
    await pool.end();
  }
}
