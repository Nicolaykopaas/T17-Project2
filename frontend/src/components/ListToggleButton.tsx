import { useState } from 'react';
import { useMutation } from '@apollo/client/react';
import { TOGGLE_LIST_MUTATION } from '../graphql/operations';

interface Props {
  titleId: string;
  inMyList: boolean;
}

export function ListToggleButton({ titleId, inMyList }: Props) {
  const [toggleList, { loading }] = useMutation(TOGGLE_LIST_MUTATION);
  const [message, setMessage] = useState('');
  const [failed, setFailed] = useState(false);

  const onClick = async () => {
    setFailed(false);
    try {
      // Tittelen normaliseres på id, så knappen oppdateres av cachen uten ekstra kode.
      const { data } = await toggleList({ variables: { titleId } });
      setMessage(data?.toggleList.inMyList ? 'Lagt til i min liste.' : 'Fjernet fra min liste.');
    } catch {
      setMessage('');
      setFailed(true);
    }
  };

  return (
    <>
      <button
        type="button"
        className="btn btn--primary"
        aria-pressed={inMyList}
        disabled={loading}
        onClick={() => void onClick()}
      >
        {inMyList ? 'Fjern fra min liste' : 'Legg i min liste'}
      </button>
      <p className="sr-only" role="status" aria-live="polite">
        {message}
      </p>
      {failed && (
        <p className="error-text" role="alert">
          Kunne ikke oppdatere listen. Prøv igjen.
        </p>
      )}
    </>
  );
}
