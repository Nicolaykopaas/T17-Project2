import { useState } from 'react';
import { useApolloClient } from '@apollo/client/react';
import { useApiUnavailable } from '../apollo/apiStatus';

/**
 * Ett felles banner i stedet for én feil per rad. Selve meldingen ligger i role="alert" og
 * knappen utenfor, slik at tekstskiftet «Prøver …» ikke kunngjøres på nytt.
 */
export function ApiUnavailableBanner() {
  const unavailable = useApiUnavailable();
  const client = useApolloClient();
  const [retrying, setRetrying] = useState(false);

  if (!unavailable) return null;

  const retry = async () => {
    setRetrying(true);
    try {
      await client.refetchQueries({ include: 'active' });
    } catch {
      // Banneret blir stående hvis det fortsatt feiler; ingenting mer å gjøre her.
    } finally {
      setRetrying(false);
    }
  };

  return (
    <div className="api-banner">
      <div className="container api-banner__inner">
        <div role="alert" className="api-banner__text">
          <p>
            <strong>Får ikke kontakt med serveren.</strong>
          </p>
          <p>
            Appen kjører på NTNUs nett. Er du utenfor campus, må du koble til NTNU VPN og prøve
            igjen.
          </p>
        </div>
        <button type="button" className="btn" disabled={retrying} onClick={() => void retry()}>
          {retrying ? 'Prøver …' : 'Prøv igjen'}
        </button>
      </div>
    </div>
  );
}
