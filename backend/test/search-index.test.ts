import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { config } from '../src/config.js';
import { createPool, type Pool } from '../src/db.js';
import { searchTitles } from '../src/search.js';
import { validateFilters } from '../src/validation.js';
import { resetData } from './fixtures.js';

/**
 * Fixturen er for liten til at planleggeren velger indekser av seg selv. Med seq scan slått av
 * ser vi i stedet om spørringene KAN bruke indeksene, dvs. at uttrykkene i search.ts passer med
 * migrasjonen. Uten dette ville en skrivefeil bare vist seg som en treg søkeside i produksjon.
 */
let pool: Pool;
beforeAll(async () => {
  pool = createPool(config.testDatabaseUrl);
  await resetData(pool);
});
afterAll(async () => {
  await pool.end();
});

async function planFor(query: string, field: 'RELEVANCE' | 'RATING' = 'RELEVANCE') {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await client.query('SET LOCAL enable_seqscan = off');
    // Utgir seg for å være poolen: hver spørring søket sender blir en EXPLAIN i stedet.
    const plans: string[] = [];
    const explainer = {
      query: async (sql: string, values: unknown[]) => {
        const res = await client.query(`EXPLAIN ${sql}`, values);
        plans.push(res.rows.map((r) => r['QUERY PLAN']).join('\n'));
        return { rows: [] };
      },
    } as unknown as Pool;
    const conn = await searchTitles(explainer, {
      query,
      filters: validateFilters(null),
      field,
      direction: 'DESC',
      first: 20,
      after: null,
    });
    await conn.totalCount();
    return plans.join('\n');
  } finally {
    await client.query('ROLLBACK');
    client.release();
  }
}

describe('f_unaccent', () => {
  it('fjerner aksenter og er markert IMMUTABLE (kreves for indekser og genererte kolonner)', async () => {
    const { rows } = await pool.query(
      `SELECT f_unaccent('Amélie Café Ça Ångström') AS v,
              (SELECT provolatile FROM pg_proc WHERE proname = 'f_unaccent') AS vol`,
    );
    expect(rows[0].v).toBe('Amelie Cafe Ca Angstrom');
    expect(rows[0].vol).toBe('i');
  });

  it('de genererte kolonnene følger tittelen', async () => {
    const { rows } = await pool.query(
      "SELECT primary_title_norm AS p, original_title_norm AS o FROM titles WHERE id = 'tt0000005'",
    );
    expect(rows[0]).toEqual({ p: 'amelie', o: "le fabuleux destin d'amelie poulain" });
  });
});

describe('indeksbruk', () => {
  it.each(['dark', 'amelie', 'cafe soc'])(
    'delstrengsøk «%s» kan bruke trigramindeksene',
    async (q) => {
      const plan = await planFor(q);
      expect(plan).toMatch(/titles_primary_title_trgm_idx/);
      expect(plan).toMatch(/titles_original_title_trgm_idx/);
    },
  );

  it.each(['a', 'da', 'ça'])('kort søk «%s» bruker prefiksindeksene, ikke trigram', async (q) => {
    const plan = await planFor(q);
    expect(plan).toMatch(/titles_primary_title_prefix_idx/);
    expect(plan).toMatch(/titles_original_title_prefix_idx/);
  });

  it('søket regner ikke likhet for korte søk', async () => {
    expect(await planFor('da')).not.toMatch(/similarity/);
    expect(await planFor('dar')).toMatch(/similarity/);
  });
});
