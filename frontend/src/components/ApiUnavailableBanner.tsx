import { useState } from 'react';
import { useApolloClient } from '@apollo/client/react';
import { apiUnavailable, useApiUnavailable } from '../apollo/apiStatus';

/**
 * Ett felles banner i stedet for én feil per rad. Selve meldingen ligger i role="alert" og
 * knappen utenfor, slik at tekstskiftet «Prøver …» ikke kunngjøres på nytt.
 */
export function ApiUnavailableBanner() {
  const unavailable = useApiUnavailable();
  const client = useApolloClient();
  const [retrying, setRetrying] = useState(false);
  const [failed, setFailed] = useState(false);

  if (!unavailable) return null;

  const retry = async () => {
    setRetrying(true);
    setFailed(false);
    try {
      await client.refetchQueries({ include: 'active' });
    } catch {
      // Banneret blir stående hvis det fortsatt feiler; ingenting mer å gjøre her.
    }
    setRetrying(false);
    if (apiUnavailable()) {
      setFailed(true);
    } else {
      // Knappen forsvant mens den hadde fokus; uten dette havner fokus på body og tastaturbrukeren mister plassen.
      document.getElementById('innhold')?.focus({ preventScroll: true });
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
        {/* Egen status-region utenfor alerten: tilbakemelding på mislykket forsøk uten å gjenta hele varselet. */}
        <p role="status" className={failed ? 'api-banner__status' : 'sr-only'}>
          {failed ? 'Fortsatt ingen kontakt med serveren.' : ''}
        </p>
      </div>
    </div>
  );
}
