import { CombinedGraphQLErrors } from '@apollo/client/errors';

/**
 * Forståelig melding når serveren begrenser mutations (`RATE_LIMITED`), ellers `null`.
 * Ventetiden kommer fra serveren, så brukeren vet når det er vits å prøve igjen.
 */
export function rateLimitMessage(error: unknown): string | null {
  if (!CombinedGraphQLErrors.is(error)) return null;
  const limited = error.errors.find((e) => e.extensions?.code === 'RATE_LIMITED');
  if (!limited) return null;
  const seconds = Number(limited.extensions?.retryAfterSeconds);
  if (!Number.isFinite(seconds) || seconds < 1) {
    return 'For mange forsøk. Vent litt og prøv igjen.';
  }
  const n = Math.ceil(seconds);
  return `For mange forsøk. Vent ${n} ${n === 1 ? 'sekund' : 'sekunder'} og prøv igjen.`;
}
