import { copyFileSync, existsSync } from 'node:fs';
import path from 'node:path';
import pg from 'pg';

/**
 * Rene hjelpefunksjoner for `npm run setup`. De ligger adskilt fra setup.ts fordi setup.ts må opprette
 * .env FØR `src/config.ts` leses (config laster .env ved import), og fordi disse kan testes uten
 * en Postgres-server.
 */

/** Antall syntetiske titler som genereres når ingenting annet er bedt om: raskt, men nok til å se søk og paginering. */
export const DEFAULT_FIXTURE_SIZE = 20_000;

/**
 * Kopierer .env.example til .env hvis .env mangler. Overskriver aldri: en eksisterende .env kan
 * inneholde passord og en ekte TMDB-nøkkel som ikke kommer tilbake.
 */
export function ensureEnvFile(root: string): 'created' | 'exists' | 'no-template' {
  const target = path.join(root, '.env');
  if (existsSync(target)) return 'exists';
  const template = path.join(root, '.env.example');
  if (!existsSync(template)) return 'no-template';
  copyFileSync(template, target);
  return 'created';
}

/** FIXTURE_SIZE fra miljøet, ellers standard. Samme regel som db:fixture, men med en tydelig feilmelding. */
export function fixtureSize(env: NodeJS.ProcessEnv): number {
  const raw = env.FIXTURE_SIZE?.trim();
  if (!raw) return DEFAULT_FIXTURE_SIZE;
  const n = Number(raw);
  if (!Number.isInteger(n) || n < 20) {
    throw new Error(`FIXTURE_SIZE må være et heltall ≥ 20, fikk «${raw}».`);
  }
  return n;
}

/** Passordet skal aldri havne i terminalen eller i en logg som limes inn i en chat. */
export function redact(connectionString: string): string {
  try {
    const url = new URL(connectionString);
    if (url.password) url.password = '***';
    return url.toString();
  } catch {
    return '(ugyldig tilkoblingsstreng)';
  }
}

/** Databasenavnet i en tilkoblingsstreng. */
export function databaseName(connectionString: string): string {
  const name = decodeURIComponent(new URL(connectionString).pathname.slice(1));
  if (!name)
    throw new Error(`Tilkoblingsstrengen mangler databasenavn: ${redact(connectionString)}`);
  return name;
}

/** Samme server, men koblet til vedlikeholdsdatabasen `postgres` der CREATE DATABASE kan kjøres. */
export function adminConnectionString(connectionString: string): string {
  const url = new URL(connectionString);
  url.pathname = '/postgres';
  return url.toString();
}

export function quoteIdent(name: string): string {
  return `"${name.replace(/"/g, '""')}"`;
}

/**
 * Gjør en rå feil fra pg/Node om til noe en student kan handle på. Postgres-feilkoder (SQLSTATE) og
 * Node-nettverkskoder er stabile, i motsetning til meldingsteksten.
 */
export function explainConnectionError(err: unknown, connectionString: string): string {
  const e = err as { code?: string; message?: string };
  const shown = redact(connectionString);
  // AggregateError (localhost som både IPv4 og IPv6) har tom melding.
  const raw = e.message || 'ingen svar';
  // Når serveren krever passord og URL-en ikke har noe, kaster pg en vanlig Error uten SQLSTATE.
  const code = e.code ?? (/password/i.test(raw) ? '28P01' : undefined);
  switch (code) {
    case 'ECONNREFUSED':
    case 'ETIMEDOUT':
    case 'ENOTFOUND':
      return (
        `Fikk ikke kontakt med PostgreSQL (${shown}).\n` +
        '  - Er PostgreSQL startet? Linux: `sudo systemctl start postgresql`, macOS (Homebrew): `brew services start postgresql`.\n' +
        '  - Bruker serveren en annen vert eller port? Rediger DATABASE_URL og TEST_DATABASE_URL i .env.'
      );
    case '28P01':
    case '28000':
      return (
        `PostgreSQL avviste innloggingen (${shown}): ${raw}\n` +
        '  Sett riktig bruker og passord i .env, for eksempel:\n' +
        '    DATABASE_URL=postgres://BRUKER:PASSORD@localhost:5432/project2\n' +
        '    TEST_DATABASE_URL=postgres://BRUKER:PASSORD@localhost:5432/project2_test\n' +
        '  Mangler du en bruker: sudo -u postgres psql -c "CREATE USER it2810 PASSWORD \'hemmelig\' SUPERUSER CREATEDB;"'
      );
    case '42501':
      return (
        `Brukeren i ${shown} har ikke lov til å opprette databaser (${raw}).\n` +
        '  Gi den CREATEDB (og SUPERUSER, siden migreringene lager utvidelsene pg_trgm og unaccent):\n' +
        '    sudo -u postgres psql -c "ALTER USER BRUKER WITH CREATEDB SUPERUSER;"\n' +
        '  eller opprett databasene selv: `sudo -u postgres createdb project2` og `sudo -u postgres createdb project2_test`.'
      );
    case '3D000':
      return (
        `Databasen «postgres» finnes ikke på serveren (${shown}), så setup får ikke opprettet de andre.\n` +
        '  Opprett databasene selv (`createdb project2`, `createdb project2_test`) og kjør `npm run setup` på nytt.'
      );
    default:
      return `Kunne ikke koble til PostgreSQL (${shown}): ${raw}`;
  }
}

/** Hint som skrives når migreringen feiler; den vanligste årsaken er manglende utvidelser eller rettigheter. */
export const MIGRATION_HINT =
  'Migreringen feilet. Vanlige årsaker:\n' +
  '  - `permission denied to create extension "pg_trgm"` eller "unaccent": brukeren må være superuser, eller en superuser\n' +
  '    må kjøre `CREATE EXTENSION pg_trgm; CREATE EXTENSION unaccent;` i databasen først.\n' +
  '  - `extension "pg_trgm" is not available`: installer contrib-pakken (Debian/Ubuntu: `sudo apt install postgresql-contrib`).';

/**
 * Oppretter databasen hvis den mangler. Kobler til `postgres` på samme server (som e2e/global-setup.ts),
 * fordi man ikke kan kjøre CREATE DATABASE fra en database som ikke finnes ennå.
 */
export async function ensureDatabase(connectionString: string): Promise<'created' | 'exists'> {
  const name = databaseName(connectionString);
  const admin = new pg.Client({
    connectionString: adminConnectionString(connectionString),
    connectionTimeoutMillis: 5000,
  });
  // pg emitterer 'error' på klienten ved frakoblet server midt i en spørring; uten lytter krasjer prosessen.
  admin.on('error', () => {});
  try {
    await admin.connect();
  } catch (err) {
    throw new Error(explainConnectionError(err, connectionString), { cause: err });
  }
  try {
    const found = await admin.query('SELECT 1 FROM pg_database WHERE datname = $1', [name]);
    if (found.rowCount) return 'exists';
    try {
      await admin.query(`CREATE DATABASE ${quoteIdent(name)}`);
    } catch (err) {
      // 42P04 = duplicate_database: en annen prosess rakk det først, som er like bra.
      if ((err as { code?: string }).code === '42P04') return 'exists';
      throw new Error(explainConnectionError(err, connectionString), { cause: err });
    }
    return 'created';
  } finally {
    await admin.end();
  }
}
