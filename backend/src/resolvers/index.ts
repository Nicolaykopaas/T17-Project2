import { BACKDROP_WIDTHS, POSTER_WIDTHS, buildImageUrl } from '../artwork.js';
import { notFound, unauthenticated } from '../errors.js';
import type { Context } from '../context.js';
import {
  DEFAULT_DIRECTION,
  getFacets,
  getGenres,
  getMyList,
  getReviews,
  getTitle,
  searchTitles,
  type Connection,
  type SortField,
} from '../search.js';
import {
  isPlausibleTitleId,
  validateFilters,
  validateFirst,
  validateQuery,
  validateReview,
  type FiltersInput,
  type ReviewInput,
} from '../validation.js';
import { mapReview, mapTitle, type TitleNode } from './mappers.js';

type Page = ReturnType<typeof mapConnection>;

/** Mapper radene til API-form, men beholder lazy totalCount (kalles bare hvis feltet etterspørres). */
function mapConnection<R, N>(conn: Connection<R>, map: (row: R) => N) {
  return {
    edges: conn.edges.map((e) => ({ cursor: e.cursor, node: map(e.node) })),
    pageInfo: conn.pageInfo,
    totalCount: conn.totalCount,
  };
}

const connectionResolvers = {
  totalCount: (page: Page) => page.totalCount(),
};

interface SearchArgs {
  query?: string | null;
  filters?: FiltersInput | null;
  sort?: { field: SortField; direction?: 'ASC' | 'DESC' | null } | null;
  first?: number | null;
  after?: string | null;
}

export const resolvers = {
  Query: {
    search: async (_: unknown, args: SearchArgs, ctx: Context) => {
      const first = validateFirst(args.first);
      const query = validateQuery(args.query);
      const filters = validateFilters(args.filters);
      const field = args.sort?.field ?? 'RELEVANCE';
      const direction = args.sort?.direction ?? DEFAULT_DIRECTION[field];
      const conn = await searchTitles(ctx.pool, {
        query,
        filters,
        field,
        direction,
        first,
        after: args.after ?? null,
      });
      return mapConnection(conn, mapTitle);
    },

    title: async (_: unknown, args: { id: string }, ctx: Context) => {
      if (!isPlausibleTitleId(args.id)) return null;
      const row = await getTitle(ctx.pool, args.id);
      return row ? mapTitle(row) : null;
    },

    facets: (
      _: unknown,
      args: { query?: string | null; filters?: FiltersInput | null },
      ctx: Context,
    ) => getFacets(ctx.pool, validateQuery(args.query), validateFilters(args.filters)),

    myList: async (
      _: unknown,
      args: { first?: number | null; after?: string | null },
      ctx: Context,
    ) => {
      const conn = await getMyList(
        ctx.pool,
        ctx.userId,
        validateFirst(args.first),
        args.after ?? null,
      );
      return mapConnection(conn, (row) => ({ ...mapTitle(row), inMyList: true }));
    },

    genres: (_: unknown, _args: unknown, ctx: Context) => getGenres(ctx.pool),
  },

  Mutation: {
    addReview: async (_: unknown, args: { input: ReviewInput }, ctx: Context) => {
      if (!ctx.userId) throw unauthenticated('Mangler gyldig x-user-id.');
      const input = validateReview(args.input);
      if (!isPlausibleTitleId(input.titleId) || !(await getTitle(ctx.pool, input.titleId))) {
        throw notFound('Fant ikke tittelen.');
      }
      const { rows } = await ctx.pool.query(
        `INSERT INTO reviews (title_id, user_id, author, rating, body)
         VALUES ($1, $2, $3, $4, $5)
         RETURNING id::text AS id, title_id, user_id, author, rating, body, created_at`,
        [input.titleId, ctx.userId, input.author, input.rating, input.text],
      );
      return mapReview(rows[0], ctx.userId);
    },

    toggleList: async (_: unknown, args: { titleId: string }, ctx: Context) => {
      if (!ctx.userId) throw unauthenticated('Mangler gyldig x-user-id.');
      const title = isPlausibleTitleId(args.titleId)
        ? await getTitle(ctx.pool, args.titleId)
        : null;
      if (!title) throw notFound('Fant ikke tittelen.');
      // Én atomisk setning: slett hvis den finnes, ellers legg til. Unngår at to raske klikk
      // gir en unik-brudd-feil, og returnerer den nye tilstanden uten ekstra spørring.
      const { rows } = await ctx.pool.query<{ in_list: boolean }>(
        `WITH del AS (
           DELETE FROM list_items WHERE user_id = $1 AND title_id = $2 RETURNING 1
         ), ins AS (
           INSERT INTO list_items (user_id, title_id)
           SELECT $1, $2 WHERE NOT EXISTS (SELECT 1 FROM del)
           ON CONFLICT DO NOTHING
           RETURNING 1
         )
         SELECT EXISTS (SELECT 1 FROM ins) AS in_list`,
        [ctx.userId, title.id],
      );
      return { ...mapTitle(title), inMyList: rows[0]?.in_list ?? false };
    },
  },

  Title: {
    userRating: async (t: TitleNode, _: unknown, ctx: Context) =>
      (await ctx.loaders.reviewStats.load(t.id)).average,
    reviewCount: async (t: TitleNode, _: unknown, ctx: Context) =>
      (await ctx.loaders.reviewStats.load(t.id)).count,
    inMyList: (t: TitleNode, _: unknown, ctx: Context) =>
      t.inMyList ?? ctx.loaders.inMyList.load(t.id),
    // Feltene slår bare opp artwork når de er med i queryen (resolvere kjøres kun for valgte felt).
    overview: async (t: TitleNode, _: unknown, ctx: Context) =>
      (await ctx.loaders.artwork.load(t.id, t.type))?.overview ?? null,
    posterUrl: async (t: TitleNode, args: { width?: number | null }, ctx: Context) => {
      const width = args.width ?? 342;
      // Validerer før oppslaget, så en ugyldig bredde aldri koster et TMDB-kall.
      buildImageUrl('', null, width, POSTER_WIDTHS);
      const art = await ctx.loaders.artwork.load(t.id, t.type);
      return buildImageUrl(ctx.artwork.imageUrl, art?.posterPath ?? null, width, POSTER_WIDTHS);
    },
    backdropUrl: async (t: TitleNode, args: { width?: number | null }, ctx: Context) => {
      const width = args.width ?? 1280;
      buildImageUrl('', null, width, BACKDROP_WIDTHS);
      const art = await ctx.loaders.artwork.load(t.id, t.type);
      return buildImageUrl(ctx.artwork.imageUrl, art?.backdropPath ?? null, width, BACKDROP_WIDTHS);
    },
    reviews: async (
      t: TitleNode,
      args: { first?: number | null; after?: string | null },
      ctx: Context,
    ) => {
      const conn = await getReviews(
        ctx.pool,
        t.id,
        validateFirst(args.first ?? 10),
        args.after ?? null,
      );
      return mapConnection(conn, (row) => mapReview(row, ctx.userId));
    },
  },

  TitleConnection: connectionResolvers,
  ReviewConnection: connectionResolvers,
};
