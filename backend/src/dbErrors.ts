import { GraphQLError } from 'graphql';

const CONNECTION_CODES = new Set([
  'ECONNREFUSED',
  'ENOTFOUND',
  'ETIMEDOUT',
  'ECONNRESET',
  'EAI_AGAIN',
]);

/**
 * Er dette en feil fordi databasen ikke kan nås (i motsetning til en bug i en spørring)?
 * Klient og helsesjekk skal skille de to: nedetid forklares med ett banner, bugs vises som feil.
 */
export function isDatabaseUnavailable(error: unknown): boolean {
  // Resolverfeil kommer pakket i GraphQLError; pg-feilen ligger i originalError.
  const err = ((error as GraphQLError)?.originalError ?? error) as {
    code?: unknown;
    message?: unknown;
    errors?: unknown[];
  } | null;
  if (!err || typeof err !== 'object') return false;
  const code = typeof err.code === 'string' ? err.code : '';
  // 57P01/57P03: Postgres stenger ned eller starter opp. Klasse 08: tilkoblingsfeil.
  if (CONNECTION_CODES.has(code) || code === '57P01' || code === '57P03' || code.startsWith('08')) {
    return true;
  }
  // pg-pool gir en vanlig Error uten kode når connectionTimeoutMillis utløper.
  if (
    typeof err.message === 'string' &&
    /timeout exceeded when trying to connect/i.test(err.message)
  ) {
    return true;
  }
  // Node 20+ pakker flere adresseforsøk (IPv4 og IPv6) i en AggregateError.
  return (
    Array.isArray(err.errors) && err.errors.length > 0 && err.errors.every(isDatabaseUnavailable)
  );
}

/** Generisk melding og kode uten SQL, vertsnavn eller stack. */
export function serviceUnavailableError(): GraphQLError {
  return new GraphQLError('Tjenesten er midlertidig utilgjengelig.', {
    extensions: { code: 'SERVICE_UNAVAILABLE' },
  });
}
