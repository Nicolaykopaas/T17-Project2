import { useEffect, useRef, useState } from 'react';
import { useMutation } from '@apollo/client/react';
import { DELETE_REVIEW_MUTATION } from '../graphql/operations';
import { rateLimitMessage } from '../lib/apiError';

interface Props {
  reviewId: string;
  /** Kalles etter vellykket sletting, mens raden fortsatt er i DOM-en. Forelderen eier fokus og kunngjøring. */
  onDeleted: () => void;
}

/**
 * To-trinns sletting inline («Slett» → «Bekreft sletting»/«Avbryt») i stedet for window.confirm,
 * som ikke kan stiles, er stygg på mobil og blokkerer tråden.
 */
export function DeleteReviewButton({ reviewId, onDeleted }: Props) {
  const [deleteReview, { loading }] = useMutation(DELETE_REVIEW_MUTATION);
  const [confirming, setConfirming] = useState(false);
  const [error, setError] = useState('');
  // Hvor fokus skal havne etter neste render. Knappene byttes ut, så fokus kan først flyttes når
  // React har committet den nye knappen (et microtask rekker det ikke).
  const focusNext = useRef<'start' | 'confirm' | null>(null);
  const confirmRef = useRef<HTMLButtonElement>(null);
  const startRef = useRef<HTMLButtonElement>(null);

  // Uten avhengighetsliste: hver endring som bytter knapp gir en render, og da skal fokus flyttes.
  useEffect(() => {
    if (!focusNext.current) return;
    (focusNext.current === 'confirm' ? confirmRef : startRef).current?.focus();
    focusNext.current = null;
  });

  const ask = () => {
    setError('');
    setConfirming(true);
    focusNext.current = 'confirm';
  };
  const cancel = () => {
    if (loading) return;
    setConfirming(false);
    focusNext.current = 'start';
  };

  const confirm = async () => {
    if (loading) return;
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
        },
      });
      onDeleted();
    } catch (e) {
      setConfirming(false);
      setError(rateLimitMessage(e) ?? 'Kunne ikke slette anmeldelsen. Prøv igjen.');
      focusNext.current = 'start';
    }
  };

  return (
    <div className="review__actions">
      {confirming ? (
        <>
          <button
            ref={confirmRef}
            type="button"
            className="btn btn--danger"
            // aria-disabled i stedet for disabled: en disabled knapp mister fokus i Chrome mens sletting pågår.
            aria-disabled={loading || undefined}
            onClick={() => void confirm()}
          >
            {loading ? 'Sletter …' : 'Bekreft sletting'}
          </button>
          <button
            type="button"
            className="btn btn--ghost"
            aria-disabled={loading || undefined}
            onClick={cancel}
          >
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
