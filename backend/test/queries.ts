/* eslint-disable @typescript-eslint/no-explicit-any -- dynamiske GraphQL-svar */
import type { GqlResult, TestEnv } from './helpers.js';

export const SEARCH = /* GraphQL */ `
  query Search(
    $query: String
    $filters: SearchFilters
    $sort: SortInput
    $first: Int
    $after: String
  ) {
    search(query: $query, filters: $filters, sort: $sort, first: $first, after: $after) {
      totalCount
      pageInfo {
        hasNextPage
        endCursor
      }
      edges {
        cursor
        node {
          id
          primaryTitle
          originalTitle
          type
          startYear
          endYear
          genres
          averageRating
          numVotes
        }
      }
    }
  }
`;

export interface SearchVars {
  query?: string | null;
  filters?: Record<string, unknown> | null;
  sort?: { field: string; direction?: string } | null;
  first?: number;
  after?: string | null;
}

/** Henter alle sider til pageInfo.hasNextPage er false, og returnerer id-ene i rekkefølge. */
export async function collectIds(env: TestEnv, vars: SearchVars, pageSize = 50) {
  const ids: string[] = [];
  let after: string | null = null;
  let pages = 0;
  let total = -1;
  for (;;) {
    const res: GqlResult = await env.gql(SEARCH, { ...vars, first: pageSize, after });
    if (res.errors) throw new Error(JSON.stringify(res.errors));
    const conn: Record<string, any> = res.data!.search;
    total = conn.totalCount;
    ids.push(...conn.edges.map((e: { node: { id: string } }) => e.node.id));
    pages++;
    if (!conn.pageInfo.hasNextPage) break;
    after = conn.pageInfo.endCursor;
    if (pages > 200) throw new Error('For mange sider – mulig evig løkke');
  }
  return { ids, pages, total };
}
