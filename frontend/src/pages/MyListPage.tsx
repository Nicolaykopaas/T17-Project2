import { useRef, useState } from 'react';
import { Link } from 'react-router';
import { useMutation, useQuery } from '@apollo/client/react';
import { ErrorMessage } from '../components/ErrorMessage';
import { ResultSkeleton } from '../components/ResultSkeleton';
import { TitleCard } from '../components/TitleCard';
import { MY_LIST_QUERY, TOGGLE_LIST_MUTATION } from '../graphql/operations';
import { useDocumentTitle } from '../hooks/useDocumentTitle';
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
  const [failed, setFailed] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const heading = useRef<HTMLHeadingElement>(null);

  const list = data?.myList;

  const remove = async (id: string, name: string) => {
    setFailed(false);
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
    } catch {
      setFailed(true);
    }
  };

  return (
    <>
      <h1 ref={heading} tabIndex={-1}>
        Min liste
      </h1>
      <p className="count" role="status" aria-live="polite">
        {message || (list ? `${formatNumber(list.totalCount)} titler` : '')}
      </p>
      {failed && (
        <p className="error-text" role="alert">
          Kunne ikke fjerne tittelen. Prøv igjen.
        </p>
      )}

      {error && !list && (
        <ErrorMessage
          message="Kunne ikke hente listen din. Sjekk nettverket og prøv igjen."
          onRetry={() => void refetch().catch(() => undefined)}
        />
      )}
      {!list && loading && <ResultSkeleton count={3} />}

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
          <ul className="results" aria-busy={loading}>
            {list.edges.map(({ node }) => (
              <TitleCard
                key={node.id}
                title={node}
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
          {list.pageInfo.hasNextPage && (
            <div className="more">
              <button
                type="button"
                className="btn"
                disabled={loadingMore}
                onClick={() => {
                  setLoadingMore(true);
                  fetchMore({ variables: { after: list.pageInfo.endCursor } })
                    .catch(() => setFailed(true))
                    .finally(() => setLoadingMore(false));
                }}
              >
                {loadingMore ? 'Laster …' : 'Last flere'}
              </button>
            </div>
          )}
        </>
      )}
    </>
  );
}
