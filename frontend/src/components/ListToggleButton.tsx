import { useState } from 'react';
import { useMutation } from '@apollo/client/react';
import { TOGGLE_LIST_MUTATION } from '../graphql/operations';
import { rateLimitMessage } from '../lib/apiError';

interface Props {
  titleId: string;
  inMyList: boolean;
  /** «secondary» brukes over heltebilder, ved siden av en primærknapp. */
  variant?: 'primary' | 'secondary';
}

/**
 * Handlingsetikett som skifter («Legg i» / «Fjern fra min liste»), bevisst uten `aria-pressed`:
 * en bryter med dynamisk navn leses opp motstridende («Fjern fra min liste, trykket»), og et
 * fast navn ville stride mot den synlige teksten (WCAG 2.5.3). Resultatet kunngjøres i statusregionen.
 */
export function ListToggleButton({ titleId, inMyList, variant = 'primary' }: Props) {
  const [toggleList, { loading }] = useMutation(TOGGLE_LIST_MUTATION);
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');

  const onClick = async () => {
    setError('');
    try {
      // Tittelen normaliseres på id, så knappen oppdateres av cachen uten ekstra kode.
      const { data } = await toggleList({ variables: { titleId } });
      setMessage(data?.toggleList.inMyList ? 'Lagt til i min liste.' : 'Fjernet fra min liste.');
    } catch (e) {
      setMessage('');
      setError(rateLimitMessage(e) ?? 'Kunne ikke oppdatere listen. Prøv igjen.');
    }
  };

  return (
    <>
      <button
        type="button"
        className={`btn ${variant === 'primary' ? 'btn--primary' : 'btn--ghost'}`}
        disabled={loading}
        onClick={() => void onClick()}
      >
        {inMyList ? 'Fjern fra min liste' : 'Legg i min liste'}
      </button>
      <p className="sr-only" role="status" aria-live="polite">
        {message}
      </p>
      {error && (
        <p className="error-text" role="alert">
          {error}
        </p>
      )}
    </>
  );
}
