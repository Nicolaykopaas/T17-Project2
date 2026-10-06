import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import dotenv from 'dotenv';

/**
 * Finner monorepo-roten ved å gå oppover til package.json med "workspaces". Vi kan ikke bruke
 * process.cwd(): `npm run -w backend` kjører med cwd=backend, mens tsx/node kan startes hvor som helst,
 * og kompilert kode ligger på et annet dybdenivå (dist/src) enn kildekoden.
 */
function findRepoRoot(): string {
  let dir = path.dirname(fileURLToPath(import.meta.url));
  for (let i = 0; i < 6; i++) {
    const pkg = path.join(dir, 'package.json');
    if (existsSync(pkg) && readFileSync(pkg, 'utf8').includes('"workspaces"')) return dir;
    dir = path.dirname(dir);
  }
  return process.cwd();
}

export const repoRoot = findRepoRoot();

// quiet: dotenv 17+ skriver ellers en reklamelinje til stdout ved hver import.
// Miljøvariabler som allerede er satt (f.eks. i CI) vinner over .env.
dotenv.config({ path: path.join(repoRoot, '.env'), quiet: true });

function int(value: string | undefined, fallback: number): number {
  const n = Number.parseInt(value ?? '', 10);
  return Number.isFinite(n) ? n : fallback;
}

export const config = {
  port: int(process.env.PORT, 3001),
  // I produksjon står Apache foran og er eneste vei inn; å lytte på loopback hindrer at noen når
  // port 3001 direkte og dermed omgår proxyen (og IP-baserte grenser som stoler på den).
  // Utvikling og tester lytter på alle grensesnitt som før. HOST overstyrer begge deler.
  host: process.env.HOST || (process.env.NODE_ENV === 'production' ? '127.0.0.1' : undefined),
  databaseUrl: process.env.DATABASE_URL || 'postgres://postgres@localhost:5432/project2',
  testDatabaseUrl:
    process.env.TEST_DATABASE_URL || 'postgres://postgres@localhost:5432/project2_test',
  corsOrigin: process.env.CORS_ORIGIN || 'http://localhost:5173',
  isProduction: process.env.NODE_ENV === 'production',
  imdbDataDir: path.resolve(repoRoot, process.env.IMDB_DATA_DIR || 'data'),
  imdbMinVotes: int(process.env.IMDB_MIN_VOTES, 100),
  // Uten nøkkel gjøres aldri nettverkskall mot TMDB; bare det som allerede ligger i databasen brukes.
  tmdbApiKey: process.env.TMDB_API_KEY?.trim() || undefined,
  tmdbApiUrl: (process.env.TMDB_API_URL || 'https://api.themoviedb.org/3').replace(/\/+$/, ''),
  tmdbImageUrl: (process.env.TMDB_IMAGE_URL || 'https://image.tmdb.org/t/p').replace(/\/+$/, ''),
  // Videoen strømmes rett fra Internet Archive; vi lagrer bare pekere. Kan peke mot den falske serveren.
  archiveUrl: (process.env.ARCHIVE_URL || 'https://archive.org').replace(/\/+$/, ''),
};
