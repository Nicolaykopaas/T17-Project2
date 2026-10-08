import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { config } from '../src/config.js';
import { createPool, type Pool } from '../src/db.js';
import { resetData, TITLE_COUNT } from '../test/fixtures.js';
import {
  capturePool,
  describeNode,
  explainStatement,
  formatReport,
  measure,
  median,
  parsePlan,
  SCENARIOS,
  type PlanNode,
} from './measure-performance.js';

const indexScan: PlanNode = {
  'Node Type': 'Index Scan',
  'Index Name': 'titles_rating_idx',
  'Relation Name': 'titles',
  'Actual Total Time': 0.9,
  'Actual Loops': 1,
};

describe('parsePlan', () => {
  it('velger noden med mest egentid, ikke den øverste', () => {
    const plan = parsePlan([
      {
        Plan: {
          'Node Type': 'Limit',
          'Actual Total Time': 1.0,
          'Actual Loops': 1,
          Plans: [indexScan],
        },
        'Execution Time': 1.2,
      },
    ]);
    expect(plan).toEqual({ executionMs: 1.2, mainNode: 'Index Scan using titles_rating_idx' });
  });

  it('regner tid over alle sløyfer', () => {
    const plan = parsePlan([
      {
        Plan: {
          'Node Type': 'Nested Loop',
          'Actual Total Time': 10,
          'Actual Loops': 1,
          Plans: [
            {
              'Node Type': 'Seq Scan',
              'Relation Name': 'a',
              'Actual Total Time': 1,
              'Actual Loops': 1,
            },
            // 0,5 ms x 10 sløyfer = 5 ms, mer enn Seq Scan og Nested Loop selv (4 ms).
            {
              'Node Type': 'Index Scan',
              'Index Name': 'b_pkey',
              'Actual Total Time': 0.5,
              'Actual Loops': 10,
            },
          ],
        },
        'Execution Time': 10.5,
      },
    ]);
    expect(plan.mainNode).toBe('Index Scan using b_pkey');
  });

  it('kaster tydelig feil på uventet format', () => {
    expect(() => parsePlan(null)).toThrow(/EXPLAIN/);
    expect(() => parsePlan([{ Plan: indexScan }])).toThrow(/Execution Time/);
    expect(() => parsePlan([])).toThrow(/EXPLAIN/);
  });
});

describe('describeNode', () => {
  it('lister indeksene en bitmapskanning kombinerer, uten duplikater', () => {
    const node: PlanNode = {
      'Node Type': 'Bitmap Heap Scan',
      'Relation Name': 'titles',
      Plans: [
        {
          'Node Type': 'BitmapOr',
          Plans: [
            { 'Node Type': 'Bitmap Index Scan', 'Index Name': 'a_trgm' },
            { 'Node Type': 'Bitmap Index Scan', 'Index Name': 'b_trgm' },
            { 'Node Type': 'Bitmap Index Scan', 'Index Name': 'a_trgm' },
          ],
        },
      ],
    };
    expect(describeNode(node)).toBe('Bitmap Heap Scan on titles (a_trgm, b_trgm)');
  });

  it('viser sorteringsmetode og tabell når det ikke er noen indeks', () => {
    expect(describeNode({ 'Node Type': 'Sort', 'Sort Method': 'top-N heapsort' })).toBe(
      'Sort (top-N heapsort)',
    );
    expect(describeNode({ 'Node Type': 'Seq Scan', 'Relation Name': 'titles' })).toBe(
      'Seq Scan on titles',
    );
    expect(describeNode({ 'Node Type': 'Aggregate' })).toBe('Aggregate');
  });
});

describe('median', () => {
  it('tar midtverdien og ignorerer rekkefølgen', () => {
    expect(median([5, 1, 3])).toBe(3);
    expect(median([4, 1, 3, 2])).toBe(2.5);
    expect(median([7])).toBe(7);
  });

  it('er upåvirket av én ekstrem kjøring', () => {
    expect(median([1.1, 1.0, 1.2, 250, 1.1])).toBe(1.1);
  });

  it('kaster på tom liste', () => {
    expect(() => median([])).toThrow();
  });
});

describe('formatReport', () => {
  it('lager en markdown-tabell og escaper rørtegn i cellene', () => {
    const md = formatReport(
      { titleCount: 190000, pgVersion: '16.4', date: '2026-10-08', runs: 5, jit: 'off' },
      [
        { name: 'Søk «a|b»', ms: 3.14159, mainNode: 'Index Scan using x', statementCount: 1 },
        { name: 'Fasetter', ms: 120.56, mainNode: 'Seq Scan on titles', statementCount: 4 },
      ],
    );
    expect(md).toContain('2026-10-08');
    expect(md).toContain('PostgreSQL 16.4');
    expect(md).toContain('| Scenario | ms (median) | Planens hovednode |');
    expect(md).toContain('| Søk «a\\|b» | 3,14 | Index Scan using x |');
    expect(md).toContain('| Fasetter, sum av 4 spørringer | 120,6 | Seq Scan on titles |');
  });
});

describe('capturePool', () => {
  it('fanger SQL og parametere uten å røre en database', async () => {
    const { pool, captured } = capturePool();
    await pool.query('SELECT $1', ['x']);
    expect(captured).toEqual([{ text: 'SELECT $1', values: ['x'] }]);
  });
});

describe('mot testdatabasen', () => {
  let pool: Pool;
  beforeAll(async () => {
    pool = createPool(config.testDatabaseUrl);
    await resetData(pool);
  });
  afterAll(async () => {
    await pool.end();
  });

  it('måler alle scenarioene og gir en rad per scenario', async () => {
    const results = await measure(pool, SCENARIOS, { runs: 2, warmups: 0 });
    expect(results).toHaveLength(SCENARIOS.length);
    for (const r of results) {
      expect(Number.isFinite(r.ms)).toBe(true);
      expect(r.ms).toBeGreaterThanOrEqual(0);
      expect(r.mainNode.length).toBeGreaterThan(0);
    }
    // Fasettene er fire spørringer (sjangre, tiår, typer, tilgjengelige); resten er én.
    expect(results.find((r) => r.name.startsWith('Fasetter'))?.statementCount).toBe(4);
    expect(results.filter((r) => r.statementCount === 1)).toHaveLength(SCENARIOS.length - 1);
    // Fixture-datasettet har langt færre enn 50 sider; tabellen skal si det i stedet for å late som.
    expect(TITLE_COUNT).toBeLessThan(50 * 20);
    expect(results.find((r) => r.name.startsWith('Side 50'))?.name).toMatch(/rakk bare til side/);

    const md = formatReport(
      { titleCount: TITLE_COUNT, pgVersion: '16', date: '2026-10-08', runs: 2, jit: 'off' },
      results,
    );
    const tableRows = md
      .split('\n')
      .filter((l) => l.startsWith('| ') && !l.startsWith('| Scenario'));
    // Skilletegnraden («| --- |») kommer i tillegg til én rad per scenario.
    expect(tableRows).toHaveLength(SCENARIOS.length + 1);
  });

  it('avviser setninger som ikke er SELECT', async () => {
    await expect(
      explainStatement(pool, { text: 'DELETE FROM titles', values: [] }),
    ).rejects.toThrow(/SELECT/);
    const { rows } = await pool.query<{ n: string }>('SELECT count(*) AS n FROM titles');
    expect(Number(rows[0]?.n)).toBe(TITLE_COUNT);
  });

  it('kan måle spørringer med parametere og spesialtegn', async () => {
    const plan = await explainStatement(pool, {
      text: 'SELECT id FROM titles WHERE primary_title_norm LIKE $1',
      values: ["%'; DROP TABLE titles; --%"],
    });
    expect(plan.executionMs).toBeGreaterThanOrEqual(0);
  });
});
