import { useRef, useState } from 'react';
import { useMutation } from '@apollo/client/react';
import { DELETE_REVIEW_MUTATION } from '../graphql/operations';
import { rateLimitMessage } from '../lib/apiError';

interface Props {
  reviewId: string;
  titleId: string;
  /** Kalles etter vellykket sletting, mens raden fortsatt er i DOM-en. Forelderen eier fokus og kunngjøring. */
  onDeleted: () => void;
}

/**
 * To-trinns sletting inline («Slett» → «Bekreft sletting»/«Avbryt») i stedet for window.confirm,
 * som ikke kan stiles, er stygg på mobil og blokkerer tråden.
 */
export function DeleteReviewButton({ reviewId, titleId, onDeleted }: Props) {
  const [deleteReview, { loading }] = useMutation(DELETE_REVIEW_MUTATION);
  const [confirming, setConfirming] = useState(false);
  const [error, setError] = useState('');
  const confirmRef = useRef<HTMLButtonElement>(null);
  const startRef = useRef<HTMLButtonElement>(null);

  const ask = () => {
    setError('');
    setConfirming(true);
    // Knappen som hadde fokus byttes ut; uten dette havner fokus på body.
    queueMicrotask(() => confirmRef.current?.focus());
  };
  const cancel = () => {
    setConfirming(false);
    queueMicrotask(() => startRef.current?.focus());
  };

  const confirm = async () => {
    setError('');
    try {
      await deleteReview({
        variables: { id: reviewId },
        update(cache, { data }) {
          if (!data) return;
          const { deletedId, title } = data.deleteReview;
          // Tittelens snitt og antall oppdateres av payloaden (normalisert på Title:<id>);
          // anmeldelsen fjernes fra connection-lista og evictes, så den heller ikke ligger igjen i cachen.
          cache.modify({
            id: cache.identify({ __typename: 'Title', id: title.id }),
            fields: {
              reviews(existing, { readField }) {
                const edges = (existing.edges as unknown[]).filter(
                  (edge) => readField('id', readField('node', edge as never)) !== deletedId,
                );
                return {
                  ...existing,
                  edges,
                  totalCount: Math.max(
                    0,
                    (existing.totalCount as number) - (existing.edges.length - edges.length),
                  ),
                };
              },
            },
          });
          cache.evict({ id: cache.identify({ __typename: 'Review', id: deletedId }) });
          cache.gc();
        },
      });
      onDeleted();
    } catch (e) {
      setConfirming(false);
      setError(rateLimitMessage(e) ?? 'Kunne ikke slette anmeldelsen. Prøv igjen.');
      queueMicrotask(() => startRef.current?.focus());
    }
  };

  return (
    <div className="review__actions" data-title={titleId}>
      {confirming ? (
        <>
          <button
            ref={confirmRef}
            type="button"
            className="btn btn--danger"
            disabled={loading}
            onClick={() => void confirm()}
          >
            {loading ? 'Sletter …' : 'Bekreft sletting'}
          </button>
          <button type="button" className="btn btn--ghost" disabled={loading} onClick={cancel}>
            Avbryt
          </button>
        </>
      ) : (
        <button ref={startRef} type="button" className="btn btn--ghost" onClick={ask}>
          Slett<span className="sr-only"> anmeldelsen din</span>
        </button>
      )}
      {error && (
        <p className="error-text" role="alert">
          {error}
        </p>
      )}
    </div>
  );
}
