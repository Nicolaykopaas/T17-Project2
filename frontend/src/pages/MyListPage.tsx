import { useRef, useState } from 'react';
import { Link } from 'react-router';
import { useMutation, useQuery } from '@apollo/client/react';
import { ErrorMessage } from '../components/ErrorMessage';
import { GRID_SIZES, PosterCard } from '../components/PosterCard';
import { PosterSkeleton } from '../components/PosterSkeleton';
import { MY_LIST_QUERY, TOGGLE_LIST_MUTATION } from '../graphql/operations';
import { useDocumentTitle } from '../hooks/useDocumentTitle';
import { rateLimitMessage } from '../lib/apiError';
import { formatNumber } from '../lib/format';

const PAGE_SIZE = 20;

export default function MyListPage() {
  useDocumentTitle('Min liste');
  // cache-and-network: lista kan ha endret seg på en detaljside siden sist.
  const { data, loading, error, fetchMore, refetch } = useQuery(MY_LIST_QUERY, {
    variables: { first: PAGE_SIZE },
    fetchPolicy: 'cache-and-network',
  });
  const [toggleList, { loading: removing }] = useMutation(TOGGLE_LIST_MUTATION);
  const [message, setMessage] = useState('');
  const [removeError, setRemoveError] = useState('');
  const [moreFailed, setMoreFailed] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const heading = useRef<HTMLHeadingElement>(null);

  const list = data?.myList;

  const remove = async (id: string, name: string) => {
    setRemoveError('');
    try {
      await toggleList({
        variables: { titleId: id },
        update(cache) {
          // Fjerner raden lokalt i stedet for å hente hele lista på nytt.
          cache.modify({
            fields: {
              myList(existing, { readField }) {
                const edges = (existing.edges as unknown[]).filter(
                  (edge) => readField('id', readField('node', edge as never)) !== id,
                );
                return {
                  ...existing,
                  edges,
                  totalCount: Math.max(
                    0,
                    existing.totalCount - (existing.edges.length - edges.length),
                  ),
                };
              },
            },
          });
        },
      });
      setMessage(`Fjernet «${name}» fra listen.`);
      // Knappen som hadde fokus forsvinner; flytt fokus til overskriften så tastaturbrukere ikke mister plassen.
      heading.current?.focus();
    } catch (e) {
      setRemoveError(rateLimitMessage(e) ?? 'Kunne ikke fjerne tittelen. Prøv igjen.');
    }
  };

  return (
    <div className="container">
      <h1 ref={heading} tabIndex={-1}>
        Min liste
      </h1>
      <p className="count" role="status" aria-live="polite">
        {message || (list ? `${formatNumber(list.totalCount)} titler` : '')}
      </p>
      {removeError && (
        <p className="error-text" role="alert">
          {removeError}
        </p>
      )}

      {error && !list && (
        <ErrorMessage
          message="Kunne ikke hente listen din. Sjekk nettverket og prøv igjen."
          onRetry={() => void refetch().catch(() => undefined)}
        />
      )}
      {!list && loading && <PosterSkeleton grid count={6} />}

      {list && list.edges.length === 0 && (
        <div className="notice">
          <p>
            <strong>Listen din er tom.</strong> Åpne en tittel og velg «Legg i min liste».
          </p>
          <Link className="btn" to="/">
            Søk etter titler
          </Link>
        </div>
      )}

      {list && list.edges.length > 0 && (
        <>
          <ul className="poster-grid" aria-busy={loading}>
            {list.edges.map(({ node }) => (
              <PosterCard
                key={node.id}
                title={node}
                sizes={GRID_SIZES}
                headingLevel={2}
                actions={
                  <button
                    type="button"
                    className="btn"
                    disabled={removing}
                    onClick={() => void remove(node.id, node.primaryTitle)}
                  >
                    Fjern <span className="sr-only">{node.primaryTitle} fra listen</span>
                  </button>
                }
              />
            ))}
          </ul>
          {moreFailed && (
            <p className="error-text" role="alert">
              Kunne ikke hente flere titler. Prøv igjen.
            </p>
          )}
          {list.pageInfo.hasNextPage && (
            <div className="more">
              <button
                type="button"
                className="btn"
                disabled={loadingMore}
                onClick={() => {
                  setLoadingMore(true);
                  setMoreFailed(false);
                  fetchMore({ variables: { after: list.pageInfo.endCursor } })
                    .catch(() => setMoreFailed(true))
                    .finally(() => setLoadingMore(false));
                }}
              >
                {loadingMore ? 'Laster …' : 'Last flere'}
              </button>
            </div>
          )}
        </>
      )}
    </div>
  );
}
