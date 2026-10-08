import { createServer } from 'node:net';
import { pathToFileURL } from 'node:url';
import concurrently from 'concurrently';

/**
 * `npm run dev`: backend og frontend sammen. Uten TMDB_API_KEY startes i tillegg de falske TMDB- og
 * Archive-serverne, slik at plakater og gratisfilmer vises uten nøkler og uten internett. Valget
 * gjøres her og ikke i package.json, for `VAR=verdi kommando` og `${VAR:-...}` fungerer ikke i cmd.exe.
 */

const DEFAULT_TMDB_MOCK_PORT = 3999;
const DEFAULT_ARCHIVE_MOCK_PORT = 3998;

export interface PlannedCommand {
  name: string;
  command: string;
  prefixColor: string;
  env?: Record<string, string>;
}

export interface DevPlan {
  /** True når de falske tjenestene brukes (ingen TMDB-nøkkel). */
  mocks: boolean;
  commands: PlannedCommand[];
  /** Porter som må være ledige, for en tydelig feilmelding før noe starter. */
  ports: { name: string; port: number }[];
}

function port(value: string | undefined, fallback: number): number {
  const n = Number.parseInt(value ?? '', 10);
  return Number.isInteger(n) && n > 0 ? n : fallback;
}

/**
 * Bestemmer hvilke prosesser som startes og hvilke miljøvariabler backend får. `env` er miljøet etter at
 * .env er lest. Ren funksjon, slik at valget kan testes uten å starte noe.
 */
export function planDev(env: NodeJS.ProcessEnv): DevPlan {
  const backendPort = port(env.PORT, 3001);
  const ports = [{ name: 'backend', port: backendPort }];
  const commands: PlannedCommand[] = [];
  const hasKey = !!env.TMDB_API_KEY?.trim();

  if (hasKey) {
    commands.push({ name: 'backend', command: 'npm run dev -w backend', prefixColor: 'blue' });
  } else {
    const tmdbPort = port(env.TMDB_MOCK_PORT, DEFAULT_TMDB_MOCK_PORT);
    const backendEnv: Record<string, string> = {
      // Backend gjør bare nettverkskall når nøkkelen er satt; verdien er ellers uten betydning for mocken.
      TMDB_API_KEY: 'test',
      TMDB_API_URL: `http://localhost:${tmdbPort}/3`,
      TMDB_IMAGE_URL: `http://localhost:${tmdbPort}/t/p`,
    };
    ports.push({ name: 'tmdb-mock', port: tmdbPort });
    commands.push({
      name: 'tmdb',
      command: 'npm run tmdb:mock -w backend',
      prefixColor: 'yellow',
      env: { TMDB_MOCK_PORT: String(tmdbPort) },
    });

    // Satt ARCHIVE_URL er et bevisst valg (for eksempel ekte archive.org) og respekteres.
    if (!env.ARCHIVE_URL?.trim()) {
      const archivePort = port(env.ARCHIVE_MOCK_PORT, DEFAULT_ARCHIVE_MOCK_PORT);
      backendEnv.ARCHIVE_URL = `http://localhost:${archivePort}`;
      ports.push({ name: 'archive-mock', port: archivePort });
      commands.push({
        name: 'archive',
        command: 'npm run archive:mock -w backend',
        prefixColor: 'cyan',
        env: { ARCHIVE_MOCK_PORT: String(archivePort) },
      });
    }
    commands.unshift({
      name: 'backend',
      command: 'npm run dev -w backend',
      prefixColor: 'blue',
      env: backendEnv,
    });
  }

  commands.push({ name: 'frontend', command: 'npm run dev -w frontend', prefixColor: 'magenta' });
  return { mocks: !hasKey, commands, ports };
}

function isPortFree(p: number): Promise<boolean> {
  return new Promise((resolve) => {
    const server = createServer();
    server.once('error', () => resolve(false));
    server.listen(p, () => server.close(() => resolve(true)));
  });
}

async function main() {
  // Importen leser .env som en bivirkning; må skje før planDev ser på process.env.
  await import('../src/config.js');
  const plan = planDev(process.env);

  const busy: string[] = [];
  for (const { name, port: p } of plan.ports) {
    if (!(await isPortFree(p))) busy.push(`${name} (port ${p})`);
  }
  if (busy.length) {
    console.error(
      `Port(er) i bruk: ${busy.join(', ')}.\n` +
        'Stopp prosessen som bruker dem (kanskje en annen `npm run dev` eller E2E-kjøring), og prøv igjen.',
    );
    process.exit(1);
  }

  console.log(
    plan.mocks
      ? 'TMDB_API_KEY er tom: starter falsk TMDB og falsk Internet Archive sammen med appen.'
      : 'TMDB_API_KEY er satt: bruker ekte TMDB.',
  );
  // Når én prosess krasjer (f.eks. databasen er nede) skal resten stoppes, ellers ser det ut som
  // appen kjører mens den ikke virker.
  const { result } = concurrently(plan.commands, { killOthersOn: ['failure'] });
  await result.catch(() => process.exit(1));
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((err) => {
    console.error(err instanceof Error ? err.message : err);
    process.exit(1);
  });
}
