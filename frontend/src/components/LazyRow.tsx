import { useRef } from 'react';
import { useQuery } from '@apollo/client/react';
import { ROW_QUERY } from '../graphql/operations';
import { useNearViewport } from '../hooks/useNearViewport';
import { rowAnchorId, rowVariables, seeAllSearch, type BrowseRow } from '../lib/browseRows';
import { TitleRow } from './TitleRow';

/**
 * Rader under folden henter først data når de nærmer seg viewport. Det sparer requests
 * (og TMDB-oppslag på serveren) for rader brukeren aldri scroller ned til.
 */
export function LazyRow({ row }: { row: BrowseRow }) {
  const anchor = useRef<HTMLDivElement>(null);
  const near = useNearViewport(anchor);
  const { data, loading, error, refetch } = useQuery(ROW_QUERY, {
    variables: rowVariables(row.state),
    skip: !near,
  });

  return (
    // Id og scroll-margin lar kategorinavigasjonen hoppe hit forbi den faste headeren.
    <div ref={anchor} id={rowAnchorId(row)} className="row-anchor">
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
