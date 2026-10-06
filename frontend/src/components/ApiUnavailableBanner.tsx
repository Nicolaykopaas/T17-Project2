import { useState } from 'react';
import { useApolloClient, useReactiveVar } from '@apollo/client/react';
import { apiFailureKind, apiUnavailable, useApiUnavailable } from '../apollo/apiStatus';

/**
 * Ett felles banner i stedet for én feil per rad. Selve meldingen ligger i role="alert" og
 * knappen utenfor, slik at tekstskiftet «Prøver …» ikke kunngjøres på nytt.
 */
export function ApiUnavailableBanner() {
  const unavailable = useApiUnavailable();
  const kind = useReactiveVar(apiFailureKind);
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
            <strong>
              {kind === 'service'
                ? 'Tjenesten er midlertidig utilgjengelig.'
                : 'Får ikke kontakt med serveren akkurat nå.'}
            </strong>
          </p>
          {/* VPN-hintet utelates når backend svarer (databasen er nede): da er nettverket ikke problemet. */}
          <p>
            {kind === 'service'
              ? 'Serveren svarer, men databasen er nede. Prøv igjen om litt.'
              : 'Den kan være midlertidig nede, så prøv igjen om litt. Kjører du appen selv, må backend være startet. Åpner du den utenfra, må du være på NTNU-nett eller bruke VPN.'}
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
