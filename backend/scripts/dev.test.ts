import { describe, expect, it } from 'vitest';
import { planDev } from './dev.js';

const names = (env: NodeJS.ProcessEnv) => planDev(env).commands.map((c) => c.name);
const backendEnv = (env: NodeJS.ProcessEnv) =>
  planDev(env).commands.find((c) => c.name === 'backend')?.env;

describe('planDev', () => {
  it('starts both mocks and points the backend at them when TMDB_API_KEY is empty', () => {
    const plan = planDev({ TMDB_API_KEY: '' });
    expect(plan.mocks).toBe(true);
    expect(names({ TMDB_API_KEY: '' })).toEqual(['backend', 'tmdb', 'archive', 'frontend']);
    expect(backendEnv({})).toEqual({
      TMDB_API_KEY: 'test',
      TMDB_API_URL: 'http://localhost:3999/3',
      TMDB_IMAGE_URL: 'http://localhost:3999/t/p',
      ARCHIVE_URL: 'http://localhost:3998',
    });
    expect(plan.ports.map((p) => p.port)).toEqual([3001, 3999, 3998]);
  });

  it('treats a whitespace-only key as empty', () => {
    expect(planDev({ TMDB_API_KEY: '   ' }).mocks).toBe(true);
  });

  it('runs as before with a real key: no mocks and no overridden URLs', () => {
    const env = { TMDB_API_KEY: 'abc123' };
    const plan = planDev(env);
    expect(plan.mocks).toBe(false);
    expect(names(env)).toEqual(['backend', 'frontend']);
    expect(backendEnv(env)).toBeUndefined();
    expect(plan.ports).toEqual([{ name: 'backend', port: 3001 }]);
  });

  it('honours custom ports', () => {
    const env = { TMDB_MOCK_PORT: '4999', ARCHIVE_MOCK_PORT: '4998', PORT: '4001' };
    const plan = planDev(env);
    expect(backendEnv(env)).toMatchObject({
      TMDB_API_URL: 'http://localhost:4999/3',
      ARCHIVE_URL: 'http://localhost:4998',
    });
    expect(plan.ports.map((p) => p.port)).toEqual([4001, 4999, 4998]);
  });

  it('falls back to default ports for garbage values', () => {
    const ports = planDev({ TMDB_MOCK_PORT: 'abc', ARCHIVE_MOCK_PORT: '-5' }).ports;
    expect(ports.map((p) => p.port)).toEqual([3001, 3999, 3998]);
  });

  it('keeps an explicit ARCHIVE_URL and skips the archive mock', () => {
    const env = { ARCHIVE_URL: 'https://archive.org' };
    expect(names(env)).toEqual(['backend', 'tmdb', 'frontend']);
    expect(backendEnv(env)).not.toHaveProperty('ARCHIVE_URL');
  });

  it('uses only portable command strings (no shell-specific env syntax)', () => {
    for (const c of planDev({}).commands) {
      expect(c.command).toMatch(/^npm run [\w:]+ -w (backend|frontend)$/);
    }
  });
});
