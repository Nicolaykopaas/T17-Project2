import { config } from './config.js';
import type { Pool } from './db.js';
import { badInput } from './errors.js';
import { batchLoader } from './loaders.js';

export interface Artwork {
  posterPath: string | null;
  backdropPath: string | null;
  overview: string | null;
}

export type TitleKind = 'MOVIE' | 'SERIES';

export const POSTER_WIDTHS = [92, 154, 185, 342, 500, 780] as const;
export const BACKDROP_WIDTHS = [300, 780, 1280] as const;

// Stien havner i en URL som klienten laster; vi slipper derfor bare gjennom det TMDB faktisk
// bruker (filnavn med tillatte tegn), slik at en ødelagt eller ondsinnet respons ikke kan gi
// `../`, skjema eller query-strenger i bilde-URL-en.
const SAFE_PATH = /^\/[A-Za-z0-9._-]+\.(jpg|jpeg|png|svg)$/;

/**
 * Snapper til nærmeste tillatte bredde (likt avstand: den største, bedre kvalitet enn skarphet).
 * Ugyldig bredde (≤ 0 eller ikke heltall) avvises heller enn å gjettes på: det er en klientfeil.
 */
export function snapWidth(width: number, allowed: readonly number[]): number {
  if (!Number.isInteger(width) || width <= 0) {
    throw badInput('width må være et positivt heltall.');
  }
  let best = allowed[0]!;
  for (const w of allowed) {
    if (Math.abs(w - width) <= Math.abs(best - width)) best = w;
  }
  return best;
}

export function buildImageUrl(
  base: string,
  path: string | null,
  width: number,
  allowed: readonly number[],
): string | null {
  // Bredden valideres også når path mangler, så feil input gir samme svar uavhengig av data.
  const w = snapWidth(width, allowed);
  if (!path || !SAFE_PATH.test(path)) return null;
  return `${base}/w${w}${path}`;
}

type Outcome =
  | { kind: 'found'; artwork: Artwork }
  | { kind: 'missing' }
  | { kind: 'error' }
  | { kind: 'disabled' };

export interface ArtworkOptions {
  pool: Pool;
  apiKey?: string | undefined;
  apiUrl?: string;
  imageUrl?: string;
  /** Maks samtidige TMDB-kall totalt i prosessen. */
  concurrency?: number;
  /** Tidsgrense per TMDB-kall. */
  callTimeoutMs?: number;
  /** Hvor lenge én request maksimalt venter på bilder. */
  batchDeadlineMs?: number;
  /** Hvor lenge en feilet tittel hoppes over før vi prøver TMDB igjen. */
  negativeTtlMs?: number;
  /** Hvor lenge vi lar TMDB være i fred etter 401/403. */
  disableMs?: number;
  fetch?: typeof fetch;
  log?: (msg: string) => void;
}

interface TmdbResult {
  poster_path?: unknown;
  backdrop_path?: unknown;
  overview?: unknown;
}

const str = (v: unknown): string | null => (typeof v === 'string' && v.length > 0 ? v : null);

/**
 * TMDB-klient med DB-cache. Én instans per prosess (og per test), fordi negativ cache,
 * «nøkkelen er ugyldig»-tilstand og samtidighetsgrensen skal deles av alle requests.
 */
export class ArtworkService {
  readonly imageUrl: string;
  private readonly pool: Pool;
  private readonly apiKey: string | undefined;
  private readonly apiUrl: string;
  private readonly concurrency: number;
  private readonly callTimeoutMs: number;
  private readonly batchDeadlineMs: number;
  private readonly negativeTtlMs: number;
  private readonly disableMs: number;
  private readonly fetchImpl: typeof fetch;
  private readonly log: (msg: string) => void;

  private active = 0;
  private readonly waiting: (() => void)[] = [];
  /** Samme tittel spurt av flere requests samtidig gir ett TMDB-kall. */
  private readonly inflight = new Map<string, Promise<Outcome>>();
  private readonly failedUntil = new Map<string, number>();
  private disabledUntil = 0;

  constructor(opts: ArtworkOptions) {
    this.pool = opts.pool;
    this.apiKey = opts.apiKey || undefined;
    this.apiUrl = (opts.apiUrl ?? config.tmdbApiUrl).replace(/\/+$/, '');
    this.imageUrl = (opts.imageUrl ?? config.tmdbImageUrl).replace(/\/+$/, '');
    this.concurrency = opts.concurrency ?? 8;
    this.callTimeoutMs = opts.callTimeoutMs ?? 4000;
    this.batchDeadlineMs = opts.batchDeadlineMs ?? 2500;
    this.negativeTtlMs = opts.negativeTtlMs ?? 5 * 60_000;
    this.disableMs = opts.disableMs ?? 10 * 60_000;
    this.fetchImpl = opts.fetch ?? fetch;
    this.log = opts.log ?? ((m) => console.warn(m));
  }

  get enabled(): boolean {
    return this.apiKey !== undefined && Date.now() >= this.disabledUntil;
  }

  /**
   * Cachede rader fra databasen, og TMDB-oppslag for resten innen tidsgrensen. Titler uten svar
   * i tide utelates (→ null hos kalleren); oppslaget fullføres og lagres likevel i bakgrunnen.
   */
  async resolve(refs: { id: string; kind: TitleKind }[]): Promise<Map<string, Artwork | null>> {
    const result = new Map<string, Artwork | null>();
    const ids = [...new Set(refs.map((r) => r.id))];
    if (ids.length === 0) return result;

    const { rows } = await this.pool.query<{
      title_id: string;
      status: 'found' | 'missing';
      poster_path: string | null;
      backdrop_path: string | null;
      overview: string | null;
    }>(
      'SELECT title_id, status, poster_path, backdrop_path, overview FROM title_artwork WHERE title_id = ANY($1::text[])',
      [ids],
    );
    for (const r of rows) {
      result.set(
        r.title_id,
        r.status === 'found'
          ? { posterPath: r.poster_path, backdropPath: r.backdrop_path, overview: r.overview }
          : null,
      );
    }

    if (!this.enabled) return result;
    const now = Date.now();
    const todo = refs.filter((r, i) => {
      if (result.has(r.id) || refs.findIndex((x) => x.id === r.id) !== i) return false;
      const until = this.failedUntil.get(r.id);
      return until === undefined || until <= now;
    });
    if (todo.length === 0) return result;

    const settled = Promise.all(
      todo.map(async (r) => {
        const outcome = await this.lookup(r.id, r.kind);
        if (outcome.kind === 'found') result.set(r.id, outcome.artwork);
        else if (outcome.kind === 'missing') result.set(r.id, null);
      }),
    );
    let timer: NodeJS.Timeout | undefined;
    const deadline = new Promise<void>((resolve) => {
      timer = setTimeout(resolve, this.batchDeadlineMs);
    });
    try {
      await Promise.race([settled, deadline]);
    } finally {
      clearTimeout(timer);
    }
    // Kopi: oppslag som ferdigstilles etter fristen skal ikke endre et svar som allerede er levert.
    return new Map(result);
  }

  /** Slår opp én tittel hos TMDB og lagrer resultatet. Kaster aldri. */
  lookup(id: string, kind: TitleKind): Promise<Outcome> {
    const existing = this.inflight.get(id);
    if (existing) return existing;
    const p = this.doLookup(id, kind)
      .catch((err: unknown): Outcome => {
        this.log(`Uventet feil i artwork-oppslag: ${(err as Error).message}`);
        return { kind: 'error' };
      })
      .finally(() => this.inflight.delete(id));
    this.inflight.set(id, p);
    return p;
  }

  private async doLookup(id: string, kind: TitleKind): Promise<Outcome> {
    if (!this.enabled) return { kind: 'disabled' };
    await this.acquire();
    let outcome: Outcome;
    try {
      // Nøkkelen kan ha blitt avvist mens vi sto i kø.
      outcome = this.enabled ? await this.fetchFind(id, kind) : { kind: 'disabled' };
    } finally {
      this.release();
    }
    if (outcome.kind === 'error') {
      if (this.failedUntil.size > 50_000) this.failedUntil.clear();
      this.failedUntil.set(id, Date.now() + this.negativeTtlMs);
    } else if (outcome.kind === 'found' || outcome.kind === 'missing') {
      await this.store(id, outcome);
    }
    return outcome;
  }

  private async fetchFind(id: string, kind: TitleKind): Promise<Outcome> {
    const url = new URL(`${this.apiUrl}/find/${encodeURIComponent(id)}`);
    url.searchParams.set('external_source', 'imdb_id');
    const headers: Record<string, string> = { accept: 'application/json' };
    const key = this.apiKey!;
    // v4-lesetoken er en JWT og sendes som Bearer; v3-nøkkelen er en kort hex-streng i query.
    if (key.startsWith('eyJ')) headers.authorization = `Bearer ${key}`;
    else url.searchParams.set('api_key', key);

    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), this.callTimeoutMs);
    try {
      const res = await this.fetchImpl(url, { headers, signal: ctrl.signal });
      if (res.status === 401 || res.status === 403) {
        await res.body?.cancel().catch(() => {});
        this.disable(res.status);
        return { kind: 'disabled' };
      }
      if (!res.ok) {
        await res.body?.cancel().catch(() => {});
        return { kind: 'error' };
      }
      const body = (await res.json()) as {
        movie_results?: unknown;
        tv_results?: unknown;
      } | null;
      const list = (v: unknown): TmdbResult[] => (Array.isArray(v) ? (v as TmdbResult[]) : []);
      const movies = list(body?.movie_results);
      const tv = list(body?.tv_results);
      const hit = (kind === 'MOVIE' ? [...movies, ...tv] : [...tv, ...movies])[0];
      if (!hit || typeof hit !== 'object') return { kind: 'missing' };
      return {
        kind: 'found',
        artwork: {
          posterPath: str(hit.poster_path),
          backdropPath: str(hit.backdrop_path),
          overview: str(hit.overview),
        },
      };
    } catch {
      // Nettverksfeil, timeout (abort) eller ugyldig JSON: alt er forbigående. Feilmeldingen
      // kan inneholde URL-en (og dermed nøkkelen), så den logges ikke.
      return { kind: 'error' };
    } finally {
      clearTimeout(timer);
    }
  }

  private disable(status: number): void {
    if (Date.now() < this.disabledUntil) return;
    this.disabledUntil = Date.now() + this.disableMs;
    this.log(
      `TMDB avviste API-nøkkelen (HTTP ${status}). Slår av TMDB-oppslag i ${Math.round(this.disableMs / 60_000)} min; sjekk TMDB_API_KEY.`,
    );
  }

  private async store(id: string, outcome: Outcome): Promise<void> {
    const a = outcome.kind === 'found' ? outcome.artwork : null;
    try {
      // Upsert: to requests kan ha slått opp samme tittel samtidig (eller i to prosesser).
      await this.pool.query(
        `INSERT INTO title_artwork (title_id, status, poster_path, backdrop_path, overview)
         VALUES ($1, $2, $3, $4, $5)
         ON CONFLICT (title_id) DO UPDATE SET
           status = EXCLUDED.status, poster_path = EXCLUDED.poster_path,
           backdrop_path = EXCLUDED.backdrop_path, overview = EXCLUDED.overview,
           fetched_at = now()`,
        [
          id,
          a ? 'found' : 'missing',
          a?.posterPath ?? null,
          a?.backdropPath ?? null,
          a?.overview ?? null,
        ],
      );
    } catch (err) {
      // Bakgrunnsoppslag kan fullføres etter at basen er lukket eller tittelen slettet.
      this.log(`Kunne ikke lagre artwork for ${id}: ${(err as Error).message}`);
    }
  }

  private acquire(): Promise<void> {
    if (this.active < this.concurrency) {
      this.active++;
      return Promise.resolve();
    }
    return new Promise((resolve) => this.waiting.push(resolve));
  }

  private release(): void {
    const next = this.waiting.shift();
    if (next)
      next(); // plassen går direkte videre til neste i køen
    else this.active--;
  }
}

/** Per-request-loader: alle titler i samme tick slås opp samlet. */
export function createArtworkLoader(service: ArtworkService) {
  const loader = batchLoader<Artwork | null>(async (keys) => {
    const refs = keys.map((k) => ({
      kind: k.slice(0, k.indexOf(':')) as TitleKind,
      id: k.slice(k.indexOf(':') + 1),
    }));
    const found = await service.resolve(refs);
    return new Map(refs.map((r) => [`${r.kind}:${r.id}`, found.get(r.id) ?? null]));
  }, null);
  return { load: (id: string, kind: TitleKind) => loader.load(`${kind}:${id}`) };
}

export type ArtworkLoader = ReturnType<typeof createArtworkLoader>;
