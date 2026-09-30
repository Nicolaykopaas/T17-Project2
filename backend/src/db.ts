import pg from 'pg';

/**
 * Felles pool-oppsett. statement_timeout er et sikkerhetsnett: en uventet dyr spørring skal
 * ikke kunne holde en tilkobling (og dermed hele API-et) opptatt i minutter.
 */
export function createPool(connectionString: string): pg.Pool {
  const pool = new pg.Pool({
    connectionString,
    max: 10,
    statement_timeout: 15_000,
  });
  // Uten en error-lytter krasjer Node hvis en ledig tilkobling brytes (f.eks. Postgres restarter).
  pool.on('error', (err) => {
    console.error('Uventet feil på ledig databasetilkobling:', err.message);
  });
  return pool;
}

export type Pool = pg.Pool;
