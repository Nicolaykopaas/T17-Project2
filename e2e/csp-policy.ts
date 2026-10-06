import { readFileSync } from 'node:fs';
import path from 'node:path';

// Policyen leses fra Apache-konfigen slik at E2E aldri kan skille lag fra det som deployes.
const conf = readFileSync(
  path.resolve(import.meta.dirname, '..', 'deploy', 'apache-project2.conf'),
  'utf8',
);

/** Policyen slik den står i Apache-konfigen (produksjon). */
const found = /Header always set Content-Security-Policy "([^"]+)"/.exec(conf)?.[1];
if (!found) throw new Error('Fant ikke Content-Security-Policy i deploy/apache-project2.conf');
export const productionPolicy: string = found;

/**
 * Samme policy, men med de eksterne vertene byttet mot mock-serverne (TMDB på 3999, Internet
 * Archive på 3998). Alt annet er uendret, så et nytt opphav appen begynner å bruke gir brudd.
 */
export const e2ePolicy = productionPolicy
  .replace('https://image.tmdb.org', 'http://localhost:3999')
  .replace('https://*.archive.org', 'http://localhost:3998')
  .replace('https://archive.org', 'http://localhost:3998');
