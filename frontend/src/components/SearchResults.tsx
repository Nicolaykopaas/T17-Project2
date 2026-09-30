import { useRef, useState } from 'react';
import { useQuery } from '@apollo/client/react';
import { SEARCH_QUERY } from '../graphql/operations';
import { useInfiniteScroll } from '../hooks/useInfiniteScroll';
import { formatNumber } from '../lib/format';
import { activeFilterCount, toFilters, toSort, type SearchState } from '../lib/searchState';
import { ErrorMessage } from './ErrorMessage';
import { GRID_SIZES, PosterCard } from './PosterCard';
import { PosterSkeleton } from './PosterSkeleton';

export const PAGE_SIZE = 20;

interface Props {
  state: SearchState;
  onReset: () => void;
}

export function SearchResults({ state, onReset }: Props) {
  const { data, previousData, loading, error, fetchMore, refetch } = useQuery(SEARCH_QUERY, {
    variables: {
      query: state.q || null,
      filters: toFilters(state),
      sort: toSort(state),
      first: PAGE_SIZE,
    },
  });
  const [loadingMore, setLoadingMore] = useState(false);
  const [moreFailed, setMoreFailed] = useState(false);
  const busy = useRef(false);
  const sentinel = useRef<HTMLDivElement>(null);

  // Mens nye resultater hentes, står de forrige igjen (dempet) i stedet for å hoppe til skjelett.
  const result = (data ?? (loading ? previousData : undefined))?.search;
  const hasNext = result?.pageInfo.hasNextPage ?? false;
  const endCursor = result?.pageInfo.endCursor ?? null;

  const loadMore = async () => {
    if (busy.current || !hasNext || !endCursor) return;
    busy.current = true;
    setLoadingMore(true);
    setMoreFailed(false);
    try {
      await fetchMore({ variables: { after: endCursor } });
    } catch {
      setMoreFailed(true);
    } finally {
      busy.current = false;
      setLoadingMore(false);
    }
  };

  useInfiniteScroll(sentinel, () => void loadMore(), hasNext && !moreFailed, endCursor);

  if (error && !result) {
    return (
      <ErrorMessage
        message="Kunne ikke hente titler. Sjekk nettverket og prøv igjen."
        onRetry={() => void refetch().catch(() => undefined)}
      />
    );
  }

  const filtersActive = activeFilterCount(state) > 0;
  const total = result?.totalCount ?? 0;
  const status = !result ? 'Søker …' : `${formatNumber(total)} treff`;

  return (
    <section aria-labelledby="results-heading" aria-busy={loading || loadingMore}>
      <h2 id="results-heading" className="sr-only">
        Søkeresultater
      </h2>
      <p className="count" role="status" aria-live="polite">
        {status}
      </p>

      {!result && <PosterSkeleton grid count={12} />}

      {result && total === 0 && (
        <div className="notice">
          <p>
            <strong>Ingen treff.</strong>{' '}
            {filtersActive
              ? 'Prøv å fjerne noen av filtrene eller søk på noe annet.'
              : state.q
                ? 'Sjekk stavemåten eller prøv et annet søkeord.'
                : 'Det finnes ingen titler ennå.'}
          </p>
          {filtersActive && (
            <button type="button" className="btn" onClick={onReset}>
              Fjern alle filtre
            </button>
          )}
        </div>
      )}

      {result && total > 0 && (
        <>
          <ul className={`poster-grid${loading ? ' is-stale' : ''}`}>
            {result.edges.map((edge) => (
              <PosterCard key={edge.node.id} title={edge.node} sizes={GRID_SIZES} />
            ))}
          </ul>
          <div ref={sentinel} aria-hidden="true" />
          <div className="more">
            <p className="muted">
              Viser {formatNumber(result.edges.length)} av {formatNumber(total)}
            </p>
            {moreFailed && (
              <p className="error-text" role="alert">
                Kunne ikke laste flere.
              </p>
            )}
            {hasNext && (
              <button
                type="button"
                className="btn"
                disabled={loadingMore}
                onClick={() => void loadMore()}
              >
                {loadingMore ? 'Laster …' : 'Last flere'}
              </button>
            )}
          </div>
        </>
      )}
    </section>
  );
}
