import { makeVar } from '@apollo/client';
import { useReactiveVar } from '@apollo/client/react';
import { CombinedGraphQLErrors, ServerError, ServerParseError } from '@apollo/client/errors';

/**
 * Én felles «API utilgjengelig»-tilstand. Uten den viser hver rad og hvert søk sin egen feil
 * når serveren ikke svarer, og brukeren får aldri vite hvorfor.
 */
export const apiUnavailable = makeVar(false);

export const useApiUnavailable = () => useReactiveVar(apiUnavailable);

// Apache svarer med disse når Node-backenden eller proxyen er nede.
const GATEWAY_STATUSES = new Set([502, 503, 504]);

/**
 * Bare ekte nedetid teller. GraphQL-feil (validering, ugyldig input) betyr at serveren svarte og
 * er vår bug eller brukerens input; da ville et «ingen kontakt»-banner være feil og villedende.
 */
export function isNetworkDown(error: unknown): boolean {
  if (CombinedGraphQLErrors.is(error)) return false;
  if (ServerError.is(error)) return GATEWAY_STATUSES.has(error.statusCode);
  // Ikke-JSON-svar (f.eks. HTML-feilside fra proxyen eller en innloggingsside) betyr at API-et ikke nås.
  if (ServerParseError.is(error)) return true;
  // fetch() kaster TypeError ved nettverksfeil (DNS, VPN, blokkert, avbrutt). Enkelte nettlesere
  // og tester bruker bare en Error med «Failed to fetch» som melding.
  return (
    error instanceof TypeError ||
    (error instanceof Error && /failed to fetch|networkerror|load failed/i.test(error.message))
  );
}
