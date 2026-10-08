import { pathToFileURL } from 'node:url';
import { config } from '../src/config.js';
import { createPool, type Pool } from '../src/db.js';
import { getFacets, searchTitles, type SearchArgs, type SortField } from '../src/search.js';
import type { Filters } from '../src/validation.js';

/**
 * Måler søkespørringene mot en ekte database og skriver en markdown-tabell til docs/ytelse.md.
 * Selve SQL-en kopieres ikke hit: den fanges opp fra search.ts ved å gi funksjonene en «pool» som
 * bare skriver ned det den får, slik at tallene alltid gjelder nøyaktig de spørringene API-et
 * bygger, også etter at search.ts endres. Kjøres på VM-en via deploy/mal-ytelse.sh.
 */

export interface Statement {
  text: string;
  values: unknown[];
}

/** Gir search.ts noe som ser ut som en Pool, men som bare registrerer spørringene (og svarer tomt). */
export function capturePool(): { pool: Pool; captured: Statement[] } {
  const captured: Statement[] = [];
  const pool = {
    query: (text: string, values: unknown[] = []) => {
      captured.push({ text, values });
      return Promise.resolve({ rows: [] });
    },
  } as unknown as Pool;
  return { pool, captured };
}

export interface PlanNode {
  'Node Type': string;
  'Index Name'?: string;
  'Relation Name'?: string;
  'Sort Method'?: string;
  'Actual Total Time'?: number;
  'Actual Loops'?: number;
  Plans?: PlanNode[];
}

/** Total tid en node brukte (alle sløyfer), inkludert barna. */
const totalTime = (n: PlanNode) => (n['Actual Total Time'] ?? 0) * (n['Actual Loops'] ?? 1);

function* walk(node: PlanNode): Generator<PlanNode> {
  yield node;
  for (const child of node.Plans ?? []) yield* walk(child);
}

/**
 * Tid noden brukte selv (uten barna). Hovednoden er den med mest egentid: «Limit» og «Sort» over
 * en indeksskanning bruker nesten ingenting selv, og skal ikke bli stående som planens
 * «hovednode» bare fordi de ligger øverst.
 */
const selfTime = (n: PlanNode) =>
  Math.max(0, totalTime(n) - (n.Plans ?? []).reduce((sum, c) => sum + totalTime(c), 0));

/** Kort, lesbar beskrivelse som «Index Scan using titles_rating_idx». */
export function describeNode(node: PlanNode): string {
  const type = node['Node Type'];
  if (type === 'Bitmap Heap Scan') {
    // Selve nytten av en bitmapskanning er hvilke indekser den kombinerer.
    const indexes = [...walk(node)]
      .map((n) => n['Index Name'])
      .filter((name): name is string => Boolean(name));
    const on = node['Relation Name'] ? ` on ${node['Relation Name']}` : '';
    return `${type}${on}${indexes.length ? ` (${[...new Set(indexes)].join(', ')})` : ''}`;
  }
  if (node['Index Name']) return `${type} using ${node['Index Name']}`;
  if (type === 'Sort' && node['Sort Method']) return `${type} (${node['Sort Method']})`;
  if (node['Relation Name']) return `${type} on ${node['Relation Name']}`;
  return type;
}

export interface ParsedPlan {
  executionMs: number;
  mainNode: string;
}

/** Leser `EXPLAIN (ANALYZE, FORMAT JSON)`-svaret: [{ Plan, "Execution Time", ... }]. */
export function parsePlan(explainJson: unknown): ParsedPlan {
  const root = Array.isArray(explainJson) ? explainJson[0] : undefined;
  const plan = root?.Plan as PlanNode | undefined;
  const executionMs = root?.['Execution Time'];
  if (!plan || typeof executionMs !== 'number') {
    throw new Error('Uventet svar fra EXPLAIN: fant ikke Plan og Execution Time.');
  }
  let main = plan;
  for (const node of walk(plan)) if (selfTime(node) > selfTime(main)) main = node;
  return { executionMs, mainNode: describeNode(main) };
}

export function median(values: number[]): number {
  if (values.length === 0) throw new Error('Median av ingen verdier.');
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[mid]! : (sorted[mid - 1]! + sorted[mid]!) / 2;
}

const READ_ONLY_SQL = /^\s*(SELECT|WITH)\b/i;

/**
 * Kjører EXPLAIN ANALYZE på én setning. ANALYZE kjører spørringen på ekte, så alt som ikke er en ren
 * SELECT avvises her i tillegg til at økten er satt til skrivebeskyttet.
 */
export async function explainStatement(db: Pool, stmt: Statement): Promise<ParsedPlan> {
  if (!READ_ONLY_SQL.test(stmt.text)) {
    throw new Error('Bare SELECT kan måles (EXPLAIN ANALYZE kjører setningen).');
  }
  const { rows } = await db.query<{ 'QUERY PLAN': unknown }>(
    `EXPLAIN (ANALYZE, BUFFERS, FORMAT JSON) ${stmt.text}`,
    stmt.values,
  );
  return parsePlan(rows[0]?.['QUERY PLAN']);
}

export const NO_FILTERS: Filters = {
  genres: [],
  decades: [],
  types: [],
  minRating: null,
  availableOnly: false,
};

const PAGE_SIZE = 20;
const DEEP_PAGE = 50;

interface Captured {
  statements: Statement[];
  /** Vises i parentes bak scenarionavnet, f.eks. hvis datasettet var for lite til å nå side 50. */
  note?: string;
}

export interface Scenario {
  name: string;
  /** `db` kan brukes til å kjøre ekte spørringer (cursor-paginering); capture-poolen til å fange SQL. */
  capture: (db: Pool) => Promise<Captured>;
}

const search = (
  name: string,
  query: string | null,
  field: SortField,
  filters: Filters = NO_FILTERS,
): Scenario => ({
  name,
  capture: async () => {
    const { pool, captured } = capturePool();
    const args: SearchArgs = {
      query,
      filters,
      field,
      direction: 'DESC',
      first: PAGE_SIZE,
      after: null,
    };
    await searchTitles(pool, args);
    return { statements: captured };
  },
});

export const SCENARIOS: Scenario[] = [
  search('Søk «dark», relevans', 'dark', 'RELEVANCE'),
  search('Søk «dark», rating', 'dark', 'RATING'),
  search('Søk «a» (1 tegn, ordprefiks), relevans', 'a', 'RELEVANCE'),
  search('Søk «ma» (2 tegn, ordprefiks), relevans', 'ma', 'RELEVANCE'),
  search('Søk «the» (vanlig ord), relevans', 'the', 'RELEVANCE'),
  search('Søk «amelie» (aksent), relevans', 'amelie', 'RELEVANCE'),
  search('Ingen søk, rating, sjanger Drama', null, 'RATING', { ...NO_FILTERS, genres: ['Drama'] }),
  {
    name: `Side ${DEEP_PAGE} via cursor, rating`,
    capture: async (db) => {
      // Cursoren kan bare lages av en faktisk forrige side, så de første sidene kjøres på ekte.
      let after: string | null = null;
      let page = 1;
      while (page < DEEP_PAGE) {
        const result: Awaited<ReturnType<typeof searchTitles>> = await searchTitles(db, {
          query: null,
          filters: NO_FILTERS,
          field: 'RATING',
          direction: 'DESC',
          first: PAGE_SIZE,
          after,
        });
        if (!result.pageInfo.hasNextPage || !result.pageInfo.endCursor) break;
        after = result.pageInfo.endCursor;
        page++;
      }
      const { pool, captured } = capturePool();
      await searchTitles(pool, {
        query: null,
        filters: NO_FILTERS,
        field: 'RATING',
        direction: 'DESC',
        first: PAGE_SIZE,
        after,
      });
      return {
        statements: captured,
        note: page < DEEP_PAGE ? `datasettet rakk bare til side ${page}` : undefined,
      };
    },
  },
  {
    name: 'totalCount for «the»',
    capture: async () => {
      const { pool, captured } = capturePool();
      const connection = await searchTitles(pool, {
        query: 'the',
        filters: NO_FILTERS,
        field: 'RELEVANCE',
        direction: 'DESC',
        first: PAGE_SIZE,
        after: null,
      });
      // totalCount er lazy: telle-spørringen bygges først nå, akkurat som når klienten ber om feltet.
      captured.length = 0;
      await connection.totalCount();
      return { statements: captured };
    },
  },
  {
    name: 'Fasetter uten filter',
    capture: async () => {
      const { pool, captured } = capturePool();
      await getFacets(pool, null, NO_FILTERS);
      return { statements: captured };
    },
  },
];

export interface ScenarioResult {
  name: string;
  /** Median av summen av alle setningene i scenarioet, per kjøring. */
  ms: number;
  mainNode: string;
  statementCount: number;
}

export const RUNS = 5;

export interface MeasureOptions {
  runs?: number;
  warmups?: number;
  onProgress?: (message: string) => void;
}

export async function measure(
  db: Pool,
  scenarios: Scenario[] = SCENARIOS,
  { runs = RUNS, warmups = 1, onProgress = () => {} }: MeasureOptions = {},
): Promise<ScenarioResult[]> {
  const results: ScenarioResult[] = [];
  for (const scenario of scenarios) {
    onProgress(scenario.name);
    const { statements, note } = await scenario.capture(db);
    // Oppvarming slik at tallene gjelder varm cache (som i drift), ikke første lesing fra disk.
    for (let i = 0; i < warmups; i++) {
      for (const stmt of statements) await explainStatement(db, stmt);
    }
    const sums: number[] = [];
    const perStatement: number[][] = statements.map(() => []);
    let lastPlans: ParsedPlan[] = [];
    for (let run = 0; run < runs; run++) {
      lastPlans = [];
      for (const [i, stmt] of statements.entries()) {
        const plan = await explainStatement(db, stmt);
        lastPlans.push(plan);
        perStatement[i]!.push(plan.executionMs);
      }
      sums.push(lastPlans.reduce((sum, p) => sum + p.executionMs, 0));
    }
    // Fasettene sender fire spørringer; planen som vises er den tregeste av dem.
    const slowest = perStatement
      .map((ms) => median(ms))
      .reduce((best, v, i, all) => (v > all[best]! ? i : best), 0);
    results.push({
      name: note ? `${scenario.name} (${note})` : scenario.name,
      ms: median(sums),
      mainNode: lastPlans[slowest]?.mainNode ?? '(ingen spørring)',
      statementCount: statements.length,
    });
  }
  return results;
}

export interface ReportInfo {
  titleCount: number;
  pgVersion: string;
  date: string;
  runs: number;
  jit: string;
}

const cell = (text: string) => text.replaceAll('|', '\\|');
const formatMs = (ms: number) => ms.toFixed(ms < 10 ? 2 : 1).replace('.', ',');

export function formatReport(info: ReportInfo, results: ScenarioResult[]): string {
  const rows = results.map((r) => {
    const name = r.statementCount > 1 ? `${r.name}, sum av ${r.statementCount} spørringer` : r.name;
    return `| ${cell(name)} | ${formatMs(r.ms)} | ${cell(r.mainNode)} |`;
  });
  return [
    `**Målt ${info.date}**: ${info.titleCount.toLocaleString('nb-NO')} titler, PostgreSQL ${info.pgVersion}, jit = ${info.jit}.`,
    `Median av ${info.runs} kjøringer med \`EXPLAIN (ANALYZE, BUFFERS)\` etter én oppvarming (varm cache). Søkene har \`LIMIT 21\` (= \`first: 20\` + 1).`,
    '',
    '| Scenario | ms (median) | Planens hovednode |',
    '| --- | ---: | --- |',
    ...rows,
    '',
  ].join('\n');
}

async function main() {
  // Rolig timeout: en kald, uindeksert spørring mot hele datasettet kan ta sekunder, og en
  // avbrutt måling sier ingenting. Poolens vanlige 15 s er til for å beskytte API-et.
  const pool = createPool(config.databaseUrl, { statementTimeoutMs: 120_000 });
  const client = await pool.connect();
  try {
    // Målingen skal aldri kunne endre data, selv om en spørring skulle være feil bygget.
    await client.query('SET default_transaction_read_only = on');
    const db = { query: client.query.bind(client) } as unknown as Pool;
    const count = await client.query<{ n: string }>('SELECT count(*) AS n FROM titles');
    const version = await client.query<{ server_version: string }>('SHOW server_version');
    const jit = await client.query<{ jit: string }>('SHOW jit');
    const results = await measure(db, SCENARIOS, {
      onProgress: (name) => console.error(`Måler: ${name}`),
    });
    process.stdout.write(
      formatReport(
        {
          titleCount: Number(count.rows[0]?.n ?? 0),
          pgVersion: version.rows[0]?.server_version.split(' ')[0] ?? 'ukjent',
          date: new Date().toISOString().slice(0, 10),
          runs: RUNS,
          jit: jit.rows[0]?.jit ?? 'ukjent',
        },
        results,
      ),
    );
  } finally {
    client.release();
    await pool.end();
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((err) => {
    console.error(err instanceof Error ? err.message : err);
    process.exit(1);
  });
}
