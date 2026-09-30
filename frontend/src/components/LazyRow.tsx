import { useRef } from 'react';
import { useQuery } from '@apollo/client/react';
import { SEARCH_QUERY } from '../graphql/operations';
import { useNearViewport } from '../hooks/useNearViewport';
import { rowVariables, seeAllSearch, type BrowseRow } from '../lib/browseRows';
import { TitleRow } from './TitleRow';

/**
 * Rader under folden henter først data når de nærmer seg viewport. Det sparer requests
 * (og TMDB-oppslag på serveren) for rader brukeren aldri scroller ned til.
 */
export function LazyRow({ row }: { row: BrowseRow }) {
  const anchor = useRef<HTMLDivElement>(null);
  const near = useNearViewport(anchor);
  const { data, loading, error, refetch } = useQuery(SEARCH_QUERY, {
    variables: rowVariables(row.state),
    skip: !near,
  });

  return (
    <div ref={anchor}>
      <TitleRow
        heading={row.heading}
        seeAllTo={seeAllSearch(row.state)}
        titles={data?.search.edges.map((e) => e.node)}
        loading={near && loading}
        error={!!error}
        onRetry={() => void refetch().catch(() => undefined)}
      />
    </div>
  );
}
