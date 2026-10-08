import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import {
  databaseName,
  ensureDatabase,
  ensureEnvFile,
  fixtureSize,
  MIGRATION_HINT,
  redact,
} from './setup-core.js';

/**
 * `npm run setup`: gjør en fersk klon om til noe som kan kjøres med `npm run dev`, uten nøkler,
 * VPN eller nedlasting. Hvert steg kan kjøres på nytt uten skade (.env overskrives aldri, databaser
 * opprettes bare hvis de mangler, migrering og import er upserts).
 */

// Ikke import fra ../src/config.js på toppnivå: config leser .env ved import, og .env finnes kanskje
// ikke før steg 1 har kjørt.
const repoRoot = path.resolve(import.meta.dirname, '..', '..');

function step(n: number, total: number, msg: string) {
  console.log(`\n[${n}/${total}] ${msg}`);
}

/**
 * Kjører en npm-kommando i terminalen. `shell: true` gjør at `npm` (npm.cmd på Windows) finnes uten
 * plattformspesifikk kode.
 */
function run(command: string, env: NodeJS.ProcessEnv = {}): Promise<void> {
  return new Promise((resolve, reject) => {
    const child = spawn(command, {
      cwd: repoRoot,
      env: { ...process.env, ...env },
      stdio: 'inherit',
      shell: true,
    });
    child.once('error', reject);
    child.once('exit', (code, signal) =>
      code === 0 ? resolve() : reject(new Error(`«${command}» avsluttet med ${code ?? signal}.`)),
    );
  });
}

const TOTAL = 6;

async function main() {
  step(1, TOTAL, 'Miljøfil');
  const envState = ensureEnvFile(repoRoot);
  if (envState === 'created') console.log('Lagde .env fra .env.example.');
  else if (envState === 'exists') console.log('.env finnes allerede og beholdes som den er.');
  else console.log('Fant verken .env eller .env.example; bruker standardverdier.');

  const { config } = await import('../src/config.js');
  if (config.databaseUrl === config.testDatabaseUrl) {
    throw new Error(
      'DATABASE_URL og TEST_DATABASE_URL må være to ulike databaser (testene tømmer den ene).',
    );
  }

  step(2, TOTAL, 'Databaser');
  for (const [label, url] of [
    ['app', config.databaseUrl],
    ['test', config.testDatabaseUrl],
  ] as const) {
    const state = await ensureDatabase(url);
    console.log(
      `${state === 'created' ? 'Opprettet' : 'Fant'} ${label}databasen «${databaseName(url)}» (${redact(url)}).`,
    );
  }

  step(3, TOTAL, 'Skjema (migrering)');
  try {
    await run('npm run db:migrate -w backend');
  } catch (err) {
    throw new Error(`${(err as Error).message}\n\n${MIGRATION_HINT}`, { cause: err });
  }

  step(4, TOTAL, 'Titler');
  const basics = path.join(config.imdbDataDir, 'title.basics.tsv.gz');
  const ratings = path.join(config.imdbDataDir, 'title.ratings.tsv.gz');
  if (existsSync(basics) && existsSync(ratings)) {
    console.log(`Bruker datafilene som allerede ligger i ${config.imdbDataDir}.`);
  } else {
    const size = fixtureSize(process.env);
    console.log(
      `Ingen datafiler i ${config.imdbDataDir}; genererer ${size} syntetiske titler ` +
        '(FIXTURE_SIZE=120000 gir det store settet).',
    );
    await run('npm run db:fixture -w backend', { FIXTURE_SIZE: String(size) });
  }
  await run('npm run db:seed -w backend');

  step(5, TOTAL, 'Gratisfilmer (falsk Internet Archive)');
  // Tilfeldig ledig port: setup skal ikke feile om 3998 er opptatt av en kjørende dev- eller E2E-stack.
  // Databasen lagrer bare pekere (element-id og filnavn), ikke vertsnavnet, så porten spiller ingen rolle senere.
  const { startArchiveMock } = await import('./archive-mock.js');
  const mock = await startArchiveMock(0);
  try {
    await run('npm run db:archive -w backend', { ARCHIVE_URL: `http://localhost:${mock.port}` });
  } finally {
    await mock.close();
  }

  step(6, TOTAL, 'Kontroll');
  console.log(
    config.tmdbApiKey
      ? 'TMDB_API_KEY er satt i .env; plakater hentes fra ekte TMDB.'
      : 'TMDB_API_KEY er tom; `npm run dev` bruker en falsk TMDB-server med tegnede plakater.',
  );
  console.log('\nFerdig! Kjør npm run dev og åpne http://localhost:5173/project2/');
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((err) => {
    console.error(`\nSetup feilet:\n${err instanceof Error ? err.message : err}`);
    process.exit(1);
  });
}
