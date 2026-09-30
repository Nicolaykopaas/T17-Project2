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
server.listen(config.port, () => {
  console.log(`GraphQL-API på http://localhost:${config.port}/graphql`);
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
