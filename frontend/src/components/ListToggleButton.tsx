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
 * en bryter med dynamisk navn leses opp motstridende («Fjern fra min liste, trykket»). En etikett som
 * sier hva et trykk gjør er tydeligere enn en tilstand man må tolke, og utfallet kunngjøres i statusregionen.
 */
export function ListToggleButton({ titleId, inMyList, variant = 'primary' }: Props) {
  const [toggleList, { loading }] = useMutation(TOGGLE_LIST_MUTATION);
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');

  const onClick = async () => {
    if (loading) return;
    setError('');
    try {
      // Tittelen normaliseres på id, så knappen oppdateres av cachen uten ekstra kode.
      const { data } = await toggleList({
        variables: { titleId },
        // «Min liste» er en egen liste i cachen som ikke vet om denne endringen. Uten å kaste den ville en
        // tilbakenavigering vist gammelt innhold til nettverkssvaret kom (eller for alltid ved nedetid).
        update(cache) {
          cache.evict({ fieldName: 'myList' });
          cache.gc();
        },
      });
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
        // aria-disabled i stedet for disabled: en disabled knapp mister fokus i Chrome mens mutasjonen pågår.
        aria-disabled={loading || undefined}
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
