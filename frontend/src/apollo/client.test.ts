import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { GENRES_QUERY } from '../graphql/operations';
import { createClient } from './client';
import { getUserId, uuidV4 } from './userId';

const UUID_V4 = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

describe('anonym bruker-id', () => {
  beforeEach(() => localStorage.clear());

  it('lager en UUID v4 og gjenbruker den', () => {
    const id = getUserId();
    expect(id).toMatch(UUID_V4);
    expect(getUserId()).toBe(id);
  });

  it('erstatter en ugyldig lagret verdi', () => {
    localStorage.setItem('it2810.userId', 'ikke-en-uuid');
    expect(getUserId()).toMatch(UUID_V4);
  });

  it('virker også når localStorage kaster', () => {
    const spy = vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
      throw new Error('blokkert');
    });
    const id = getUserId();
    expect(id).toMatch(UUID_V4);
    expect(getUserId()).toBe(id);
    spy.mockRestore();
  });

  // Regresjon: VM-en serverer over http, der crypto.randomUUID ikke finnes (bare i sikre kontekster).
  it('virker uten crypto.randomUUID (http, ikke sikker kontekst)', () => {
    const spy = vi.spyOn(crypto, 'randomUUID').mockImplementation(() => {
      throw new TypeError('crypto.randomUUID is not a function');
    });
    const ids = new Set(Array.from({ length: 50 }, () => uuidV4()));
    expect(ids.size).toBe(50);
    for (const id of ids) expect(id).toMatch(UUID_V4);
    expect(getUserId()).toMatch(UUID_V4);
    expect(spy).not.toHaveBeenCalled();
    spy.mockRestore();
  });
});

describe('Apollo-klient', () => {
  beforeEach(() => localStorage.clear());
  afterEach(() => vi.unstubAllGlobals());

  it('sender x-user-id på alle requests', async () => {
    const fetchMock = vi.fn(async () =>
      Response.json(
        { data: { genres: ['Drama'] } },
        { headers: { 'content-type': 'application/json' } },
      ),
    );
    vi.stubGlobal('fetch', fetchMock);

    await createClient().query({ query: GENRES_QUERY });

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe(import.meta.env.BASE_URL + 'graphql');
    expect((init.headers as Record<string, string>)['x-user-id']).toBe(getUserId());
  });
});
