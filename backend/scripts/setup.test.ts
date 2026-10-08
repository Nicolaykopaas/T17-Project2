import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import pg from 'pg';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { config } from '../src/config.js';
import {
  adminConnectionString,
  databaseName,
  DEFAULT_FIXTURE_SIZE,
  ensureDatabase,
  ensureEnvFile,
  explainConnectionError,
  fixtureSize,
  quoteIdent,
  redact,
} from './setup-core.js';

describe('ensureEnvFile', () => {
  let dir: string;
  beforeEach(() => {
    dir = mkdtempSync(path.join(tmpdir(), 'setup-env-'));
  });
  afterEach(() => rmSync(dir, { recursive: true, force: true }));

  it('copies .env.example to .env when .env is missing', () => {
    writeFileSync(path.join(dir, '.env.example'), 'PORT=3001\n');
    expect(ensureEnvFile(dir)).toBe('created');
    expect(readFileSync(path.join(dir, '.env'), 'utf8')).toBe('PORT=3001\n');
  });

  it('never overwrites an existing .env', () => {
    writeFileSync(path.join(dir, '.env.example'), 'PORT=3001\n');
    writeFileSync(path.join(dir, '.env'), 'TMDB_API_KEY=secret\n');
    expect(ensureEnvFile(dir)).toBe('exists');
    expect(readFileSync(path.join(dir, '.env'), 'utf8')).toBe('TMDB_API_KEY=secret\n');
  });

  it('does not crash when there is no template', () => {
    expect(ensureEnvFile(dir)).toBe('no-template');
  });

  it('keeps an empty existing .env as it is', () => {
    writeFileSync(path.join(dir, '.env.example'), 'PORT=3001\n');
    writeFileSync(path.join(dir, '.env'), '');
    expect(ensureEnvFile(dir)).toBe('exists');
    expect(readFileSync(path.join(dir, '.env'), 'utf8')).toBe('');
  });
});

describe('fixtureSize', () => {
  it('defaults to a fast dataset', () => {
    expect(fixtureSize({})).toBe(DEFAULT_FIXTURE_SIZE);
    expect(fixtureSize({ FIXTURE_SIZE: '' })).toBe(DEFAULT_FIXTURE_SIZE);
  });

  it('accepts the large dataset', () => {
    expect(fixtureSize({ FIXTURE_SIZE: '120000' })).toBe(120_000);
  });

  it.each(['abc', '12.5', '5', '-1'])('rejects %s', (v) => {
    expect(() => fixtureSize({ FIXTURE_SIZE: v })).toThrow(/FIXTURE_SIZE/);
  });
});

describe('connection string helpers', () => {
  it('extracts the database name and builds the admin URL on the same server', () => {
    const url = 'postgres://u:pw@db.example:5433/project2?sslmode=disable';
    expect(databaseName(url)).toBe('project2');
    const admin = new URL(adminConnectionString(url));
    expect(admin.pathname).toBe('/postgres');
    expect(admin.host).toBe('db.example:5433');
    expect(admin.username).toBe('u');
  });

  it('rejects a URL without a database name', () => {
    expect(() => databaseName('postgres://u@localhost:5432')).toThrow(/databasenavn/);
  });

  it('hides passwords', () => {
    expect(redact('postgres://u:hemmelig@localhost/x')).not.toContain('hemmelig');
    expect(redact('not a url')).toBe('(ugyldig tilkoblingsstreng)');
  });

  it('quotes identifiers', () => {
    expect(quoteIdent('a"b')).toBe('"a""b"');
  });
});

describe('explainConnectionError', () => {
  const url = 'postgres://postgres:pw@localhost:5432/project2';

  it('tells the user to start PostgreSQL when nothing answers', () => {
    const msg = explainConnectionError(Object.assign(new Error(''), { code: 'ECONNREFUSED' }), url);
    expect(msg).toMatch(/Er PostgreSQL startet/);
    expect(msg).not.toContain(':pw@');
  });

  it('shows an example DATABASE_URL with password on authentication failure', () => {
    const msg = explainConnectionError(Object.assign(new Error('nope'), { code: '28P01' }), url);
    expect(msg).toContain('DATABASE_URL=postgres://BRUKER:PASSORD@localhost:5432/project2');
  });

  it("recognises pg's missing-password error, which has no error code", () => {
    const err = new Error('SASL: SCRAM-SERVER-FIRST-MESSAGE: client password must be a string');
    expect(explainConnectionError(err, url)).toContain('BRUKER:PASSORD');
  });

  it('explains CREATEDB on insufficient privilege', () => {
    const msg = explainConnectionError(Object.assign(new Error('x'), { code: '42501' }), url);
    expect(msg).toMatch(/CREATEDB/);
  });

  it('falls back to the raw message', () => {
    expect(explainConnectionError(new Error('boom'), url)).toContain('boom');
  });
});

describe('ensureDatabase (against the test server)', () => {
  const name = `project2_setup_unit_${process.pid}`;
  const url = Object.assign(new URL(config.testDatabaseUrl), { pathname: `/${name}` }).toString();

  afterEach(async () => {
    const admin = new pg.Client({ connectionString: adminConnectionString(url) });
    await admin.connect();
    await admin.query(`DROP DATABASE IF EXISTS ${quoteIdent(name)}`);
    await admin.end();
  });

  it('creates a missing database and is idempotent', async () => {
    expect(await ensureDatabase(url)).toBe('created');
    expect(await ensureDatabase(url)).toBe('exists');
  });

  it('explains an unreachable server without leaking the password', async () => {
    const dead = 'postgres://u:hemmelig@127.0.0.1:1/project2';
    const err = await ensureDatabase(dead).catch((e: Error) => e);
    expect((err as Error).message).toMatch(/Fikk ikke kontakt med PostgreSQL/);
    expect((err as Error).message).not.toContain('hemmelig');
  });
});
