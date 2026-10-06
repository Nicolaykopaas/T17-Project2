import { makeVar } from '@apollo/client';
import { useReactiveVar } from '@apollo/client/react';
import { CombinedGraphQLErrors, ServerError, ServerParseError } from '@apollo/client/errors';

/**
 * Én felles «API utilgjengelig»-tilstand. Uten den viser hver rad og hvert søk sin egen feil
 * når serveren ikke svarer, og brukeren får aldri vite hvorfor.
 *
 * Banneret følger siste svar: ett vellykket svar beviser at API-et nås og nullstiller det, så en enkelt
 * treg spørring som gir 504 kan blinke banneret kort. Vi aksepterer det i stedet for å skjule ekte nedetid.
 */
export const apiUnavailable = makeVar(false);

/**
 * Hvorfor API-et er utilgjengelig: 'network' = ingen kontakt med serveren (nede, ikke startet, VPN),
 * 'service' = backend svarer, men databasen er nede. Brukes til å utelate VPN-hintet når det ikke hjelper.
 */
export type ApiFailureKind = 'network' | 'service';
export const apiFailureKind = makeVar<ApiFailureKind>('network');

export const useApiUnavailable = () => useReactiveVar(apiUnavailable);

// Apache svarer med disse når Node-backenden eller proxyen er nede.
const GATEWAY_STATUSES = new Set([502, 503, 504]);

/**
 * Bare ekte nedetid teller. GraphQL-feil (validering, ugyldig input) betyr at serveren svarte og
 * er vår bug eller brukerens input; da ville et «ingen kontakt»-banner være feil og villedende.
 */
export function classifyApiFailure(error: unknown): ApiFailureKind | null {
  if (CombinedGraphQLErrors.is(error)) {
    // Backenden svarer HTTP 200 med denne koden når Node lever, men databasen ikke gjør det.
    return error.errors.some((e) => e.extensions?.code === 'SERVICE_UNAVAILABLE')
      ? 'service'
      : null;
  }
  if (ServerError.is(error)) return GATEWAY_STATUSES.has(error.statusCode) ? 'network' : null;
  // Ikke-JSON-svar (f.eks. HTML-feilside fra proxyen eller en innloggingsside) betyr at API-et ikke nås.
  if (ServerParseError.is(error)) return 'network';
  // fetch() kaster TypeError ved nettverksfeil (DNS, VPN, blokkert, avbrutt). Enkelte nettlesere
  // og tester bruker bare en Error med «Failed to fetch» som melding.
  return error instanceof TypeError ||
    (error instanceof Error && /failed to fetch|networkerror|load failed/i.test(error.message))
    ? 'network'
    : null;
}
