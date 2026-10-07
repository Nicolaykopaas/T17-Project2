import { createServer } from 'node:http';
import { createApp } from './app.js';
import { config } from './config.js';
import { createPool } from './db.js';

const pool = createPool(config.databaseUrl);
const yoga = createApp({
  pool,
  production: config.isProduction,
  corsOrigin: config.isProduction ? false : config.corsOrigin,
});

const server = createServer(yoga);
// Node lukker ledige forbindelser etter 5 s, og Apache (mod_proxy) gjenbruker forbindelser lenger
// enn det. Treffer en forespørsel en forbindelse Node akkurat har lukket, gir Apache 502. Lengre
// tidsgrense enn Apaches gjør at det er Apache som lukker først. headersTimeout må ligge over
// keepAliveTimeout, ellers kan Node avbryte en gjenbrukt forbindelse midt i neste forespørsel.
server.keepAliveTimeout = 65_000;
server.headersTimeout = 66_000;
server.listen(config.port, config.host, () => {
  console.log(`GraphQL-API på http://${config.host ?? 'localhost'}:${config.port}/graphql`);
});

// Rydder opp så tilkoblinger lukkes pent (systemd sender SIGTERM, Ctrl+C sender SIGINT).
function shutdown() {
  server.close(() => {
    void pool.end().then(() => process.exit(0));
  });
  setTimeout(() => process.exit(1), 5000).unref();
}
process.on('SIGTERM', shutdown);
process.on('SIGINT', shutdown);
