import { createArtworkLoader, type ArtworkLoader, type ArtworkService } from './artwork.js';
import type { Pool } from './db.js';
import { config } from './config.js';
import { batchLoader } from './loaders.js';
import { createStreamLoader, type StreamLoader } from './stream.js';
import { parseUserId } from './validation.js';

export interface ReviewStats {
  count: number;
  average: number | null;
}

export interface Context {
  pool: Pool;
  /** Gyldig, normalisert UUID fra x-user-id, ellers null. */
  userId: string | null;
  artwork: ArtworkService;
  loaders: {
    artwork: ArtworkLoader;
    stream: StreamLoader;
    reviewStats: { load: (titleId: string) => Promise<ReviewStats> };
    inMyList: { load: (titleId: string) => Promise<boolean> };
  };
}

/** Bygges per request, slik at loader-cachene aldri lekker data mellom brukere. */
export function createContext(
  pool: Pool,
  request: Request,
  artwork: ArtworkService,
  archiveUrl: string = config.archiveUrl,
): Context {
  const userId = parseUserId(request.headers.get('x-user-id'));
  return {
    pool,
    userId,
    artwork,
    loaders: {
      artwork: createArtworkLoader(artwork),
      stream: createStreamLoader(pool, archiveUrl),
      // Én spørring for hele resultatsiden i stedet for én per tittel (N+1).
      reviewStats: batchLoader<ReviewStats>(
        async (ids) => {
          const { rows } = await pool.query<{ title_id: string; n: string; avg: string }>(
            `SELECT title_id, count(*) AS n, avg(rating) AS avg
             FROM reviews WHERE title_id = ANY($1::text[]) GROUP BY title_id`,
            [ids],
          );
          return new Map(
            rows.map((r) => [
              r.title_id,
              { count: Number(r.n), average: Math.round(Number(r.avg) * 100) / 100 },
            ]),
          );
        },
        { count: 0, average: null },
      ),
      inMyList: batchLoader<boolean>(async (ids) => {
        if (!userId) return new Map();
        const { rows } = await pool.query<{ title_id: string }>(
          'SELECT title_id FROM list_items WHERE user_id = $1 AND title_id = ANY($2::text[])',
          [userId, ids],
        );
        return new Map(rows.map((r) => [r.title_id, true]));
      }, false),
    },
  };
}
