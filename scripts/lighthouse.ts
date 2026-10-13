import { launch } from 'chrome-launcher';
import lighthouse from 'lighthouse';
import desktopConfig from 'lighthouse/core/config/desktop-config.js';
import pkg from 'lighthouse/package.json' with { type: 'json' };

/**
 * Kjører Lighthouse mot hovedsidene (mobil og desktop) og skriver en markdown-tabell som kan
 * limes rett inn i docs/ytelse.md:
 *
 *   npm run lighthouse -- http://it2810-17.idi.ntnu.no/project2/ > lighthouse.md
 *
 * Fremdrift og feil går til stderr, så stdout bare inneholder tabellen. Skriptet leser bare fra
 * nettstedet og trenger ikke mer tilgang til VM-en enn at adressen kan nås (NTNU-VPN).
 */

const CATEGORIES = ['performance', 'accessibility', 'best-practices', 'seo'] as const;
type Category = (typeof CATEGORIES)[number];
type Scores = Record<Category, number>;

type FormFactor = 'mobile' | 'desktop';
const FORM_FACTORS: { id: FormFactor; label: string }[] = [
  { id: 'mobile', label: 'Mobil' },
  { id: 'desktop', label: 'Desktop' },
];

interface Options {
  baseUrl: string;
  titleId: string;
  query: string;
  runs: number;
}

interface Page {
  label: string;
  url: string;
}

const USAGE = `Bruk: npm run lighthouse -- <base-url> [--title tt0468569] [--query dark] [--runs 3]
  <base-url>  appens rot, f.eks. http://it2810-17.idi.ntnu.no/project2/ eller http://localhost:4173/project2/
  --title     IMDb-id til detaljsiden (standard tt0468569; må finnes i databasen)
  --query     søkeord for søkesiden (standard dark)
  --runs      antall kjøringer per side og enhet; medianen rapporteres (standard 3)
Miljøvariabelen CHROME_PATH peker på Chrome/Chromium hvis det ikke ligger på et vanlig sted.`;

function parseArgs(argv: string[]): Options {
  const opts = { titleId: 'tt0468569', query: 'dark', runs: 3 };
  let baseUrl: string | undefined;
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i] as string;
    // Støtter både «--runs 5» og «--runs=5».
    const [flag, inline] = arg.split(/=(.*)/s, 2);
    const value = () => inline ?? argv[++i];
    if (flag === '--title') opts.titleId = value() ?? '';
    else if (flag === '--query') opts.query = value() ?? '';
    else if (flag === '--runs') opts.runs = Number(value());
    else if (flag === '--help' || flag === '-h') throw new Error(USAGE);
    else if (arg.startsWith('--')) throw new Error(`Ukjent flagg ${arg}\n${USAGE}`);
    else baseUrl = arg;
  }
  if (!baseUrl) throw new Error(`Mangler base-URL.\n${USAGE}`);
  if (!/^[A-Za-z0-9]+$/.test(opts.titleId)) throw new Error('--title må være en IMDb-id.');
  if (!Number.isInteger(opts.runs) || opts.runs < 1) {
    throw new Error('--runs må være et heltall på minst 1.');
  }
  let parsed: URL;
  try {
    parsed = new URL(baseUrl);
  } catch {
    throw new Error(`«${baseUrl}» er ikke en gyldig URL (husk http://).\n${USAGE}`);
  }
  // Relative URL-er under løses mot base; uten avsluttende skråstrek ville «/project2» blitt
  // erstattet i stedet for utvidet.
  if (!parsed.pathname.endsWith('/')) parsed.pathname += '/';
  parsed.search = '';
  parsed.hash = '';
  return { baseUrl: parsed.toString(), ...opts };
}

function pagesFor(o: Options): Page[] {
  const at = (path: string) => new URL(path, o.baseUrl).toString();
  return [
    { label: 'Forside', url: at('.') },
    { label: `Søk (\`?q=${o.query}\`)`, url: at(`.?q=${encodeURIComponent(o.query)}`) },
    { label: `Detalj (\`title/${o.titleId}\`)`, url: at(`title/${o.titleId}`) },
    { label: 'Min liste', url: at('my-list') },
  ];
}

function median(values: number[]): number {
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  const hi = sorted[mid] as number;
  return sorted.length % 2 ? hi : ((sorted[mid - 1] as number) + hi) / 2;
}

/** Median per kategori, hver for seg, slik at én uteligger ikke trekker de andre kategoriene. */
function medianScores(runs: Scores[]): Scores {
  const out = {} as Scores;
  for (const c of CATEGORIES) out[c] = Math.round(median(runs.map((r) => r[c])));
  return out;
}

function formatTable(
  rows: { page: string; form: string; scores: Scores }[],
  info: { date: string; runs: number },
): string {
  return [
    `**Målt ${info.date}**: Lighthouse ${pkg.version}, median av ${info.runs} kjøringer per side og enhet (standard simulert struping).`,
    '',
    '| Side | Enhet | Performance | Accessibility | Best Practices | SEO |',
    '| --- | --- | ---: | ---: | ---: | ---: |',
    ...rows.map(
      (r) => `| ${r.page} | ${r.form} | ${CATEGORIES.map((c) => r.scores[c]).join(' | ')} |`,
    ),
    '',
  ].join('\n');
}

/** Gir en forståelig feil før Chrome startes, f.eks. når VPN-en er av eller id-en ikke finnes. */
async function assertReachable(url: string): Promise<void> {
  try {
    const res = await fetch(url, { signal: AbortSignal.timeout(15_000) });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
  } catch (err) {
    const why = err instanceof Error ? err.message : String(err);
    throw new Error(
      `Fikk ikke kontakt med ${url} (${why}). Sjekk adressen, og at du er på NTNU-VPN hvis den peker på VM-en.`,
      { cause: err },
    );
  }
}

async function runOnce(url: string, form: FormFactor, port: number): Promise<Scores> {
  const result = await lighthouse(
    url,
    { port, output: 'json', logLevel: 'error', onlyCategories: [...CATEGORIES] },
    form === 'desktop' ? desktopConfig : undefined,
  );
  const lhr = result?.lhr;
  if (!lhr) throw new Error(`Lighthouse ga ikke noe resultat for ${url}.`);
  // En side som ikke lastet gir likevel scores (ofte 0), og de må ikke havne i tabellen.
  if (lhr.runtimeError) {
    throw new Error(`${url}: ${lhr.runtimeError.code} ${lhr.runtimeError.message}`);
  }
  const scores = {} as Scores;
  for (const c of CATEGORIES) {
    const score = lhr.categories[c]?.score;
    if (score == null) throw new Error(`${url}: mangler score for ${c}.`);
    scores[c] = Math.round(score * 100);
  }
  return scores;
}

async function main() {
  const opts = parseArgs(process.argv.slice(2));
  const pages = pagesFor(opts);
  for (const p of pages) await assertReachable(p.url);

  // Chrome som root (CI, containere) nekter å starte uten --no-sandbox.
  const asRoot = typeof process.getuid === 'function' && process.getuid() === 0;
  const chrome = await launch({
    chromeFlags: ['--headless=new', '--disable-gpu', ...(asRoot ? ['--no-sandbox'] : [])],
  });
  try {
    const rows: { page: string; form: string; scores: Scores }[] = [];
    for (const page of pages) {
      for (const form of FORM_FACTORS) {
        const runs: Scores[] = [];
        for (let i = 1; i <= opts.runs; i++) {
          console.error(`${page.label} (${form.label}): kjøring ${i}/${opts.runs}`);
          runs.push(await runOnce(page.url, form.id, chrome.port));
        }
        rows.push({ page: page.label, form: form.label, scores: medianScores(runs) });
      }
    }
    process.stdout.write(
      formatTable(rows, { date: new Date().toISOString().slice(0, 10), runs: opts.runs }),
    );
  } finally {
    await chrome.kill();
  }
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
