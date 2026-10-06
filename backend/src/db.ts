import pg from 'pg';

/**
 * Felles pool-oppsett. statement_timeout er et sikkerhetsnett: en uventet dyr spørring skal
 * ikke kunne holde en tilkobling (og dermed hele API-et) opptatt i minutter. Skript som med vilje
 * kjører lange setninger (import) kan oppgi en høyere grense.
 */
export function createPool(
  connectionString: string,
  { statementTimeoutMs = 15_000 }: { statementTimeoutMs?: number } = {},
): pg.Pool {
  const pool = new pg.Pool({
    connectionString,
    max: 10,
    // Uten tidsgrense henger en tilkobling mot en database bak brannmur til OS gir opp, og
    // /health og spørringer fyller poolen mens de venter.
    connectionTimeoutMillis: 5_000,
    statement_timeout: statementTimeoutMs,
  });
  // Uten en error-lytter krasjer Node hvis en ledig tilkobling brytes (f.eks. Postgres restarter).
  pool.on('error', (err) => {
    console.error('Uventet feil på ledig databasetilkobling:', err.message);
  });
  return pool;
}

export type Pool = pg.Pool;
