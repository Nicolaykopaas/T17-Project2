import { GraphQLError, type ValidationRule } from 'graphql';
import { createYoga, type Plugin } from 'graphql-yoga';
import { ArtworkService } from './artwork.js';
import { config } from './config.js';
import { createContext, type Context } from './context.js';
import type { Pool } from './db.js';
import { isDatabaseUnavailable, serviceUnavailableError } from './dbErrors.js';
import { depthLimit } from './depthLimit.js';
import { schema } from './schema.js';

export const MAX_QUERY_DEPTH = 6;

/**
 * Egen regel i stedet for graphqls NoSchemaIntrospectionCustomRule: den bruker instanceof-sjekker
 * som feiler når graphql lastes to ganger (ESM + CJS), noe som skjer under enkelte verktøy.
 */
const noIntrospection: ValidationRule = (context) => ({
  Field(node) {
    if (node.name.value === '__schema' || node.name.value === '__type') {
      context.reportError(
        new GraphQLError('GraphQL introspection er slått av.', {
          nodes: [node],
          extensions: { code: 'BAD_USER_INPUT' },
        }),
      );
    }
  },
});

const HEALTH_TIMEOUT_MS = 2000;

/**
 * Kort tidsgrense utenom poolens egen: en database bak en brannmur svarer ikke i det hele tatt,
 * og helsesjekken skal da svare 503 raskt i stedet for å henge til Apache gir opp.
 */
async function databaseResponds(pool: Pool, timeoutMs = HEALTH_TIMEOUT_MS): Promise<boolean> {
  let timer: NodeJS.Timeout | undefined;
  const timeout = new Promise<false>((resolve) => {
    timer = setTimeout(() => resolve(false), timeoutMs);
  });
  const query = pool.query('SELECT 1').then(
    () => true,
    () => false,
  );
  try {
    return await Promise.race([query, timeout]);
  } finally {
    clearTimeout(timer);
  }
}

export interface AppOptions {
  pool: Pool;
  /** Slår av introspeksjon og GraphiQL. Standard: NODE_ENV === 'production'. */
  production?: boolean;
  /** Tillatt CORS-opprinnelse (kun utvikling). false = ingen CORS-headere. */
  corsOrigin?: string | false;
  /** TMDB-tjenesten. Standard: bygges fra miljøvariablene (TMDB_API_KEY osv.). */
  artwork?: ArtworkService;
  /** Base-URL for Internet Archive i stream-URL-ene. Standard: ARCHIVE_URL. */
  archiveUrl?: string;
}

/**
 * Bygger Yoga-appen uten å åpne noen port, slik at testene kan kalle yoga.fetch() direkte.
 * Yoga selv er en (req, res)-handler for node:http og en fetch-funksjon i én.
 */
export function createApp({
  pool,
  production,
  corsOrigin = false,
  artwork,
  archiveUrl,
}: AppOptions) {
  const artworkService = artwork ?? new ArtworkService({ pool, apiKey: config.tmdbApiKey });
  const isProd = production ?? process.env.NODE_ENV === 'production';

  // Egendefinert plugin i stedet for ekstra pakker: envelop lar oss legge til valideringsregler.
  const limits: Plugin = {
    onValidate({ addValidationRule }) {
      addValidationRule(depthLimit(MAX_QUERY_DEPTH));
      if (isProd) addValidationRule(noIntrospection);
    },
  };

  // Yogas innebygde /health svarer «alive» uten å se på databasen. Vi trenger det motsatte: frontend
  // og sjekk.sh skal få vite om API-et faktisk kan svare, så Yogas flyttes og vår tar over stien.
  const health: Plugin = {
    async onRequest({ request, url, endResponse }) {
      if (url.pathname !== '/health' || request.method !== 'GET') return;
      const ok = await databaseResponds(pool);
      endResponse(
        Response.json(
          { status: ok ? 'ok' : 'db-unavailable' },
          { status: ok ? 200 : 503, headers: { 'cache-control': 'no-store' } },
        ),
      );
    },
  };

  return createYoga<object, Context>({
    schema,
    graphqlEndpoint: '/graphql',
    healthCheckEndpoint: '/__yoga-health',
    plugins: [health, limits],
    context: ({ request }) =>
      createContext(pool, request, artworkService, archiveUrl ?? config.archiveUrl),
    logging: process.env.NODE_ENV !== 'test',
    graphiql: !isProd,
    landingPage: !isProd,
    // I produksjon står Apache foran og frontend er same-origin; CORS trengs bare i utvikling.
    cors: corsOrigin
      ? {
          origin: corsOrigin,
          methods: ['GET', 'POST', 'OPTIONS'],
          allowedHeaders: ['content-type', 'x-user-id'],
        }
      : false,
    maskedErrors: {
      // Uventede feil (databasen nede, bugs) skal aldri lekke SQL eller stack til klienten.
      maskError(error: unknown): Error {
        // Egne, forventede feil (GraphQLError uten underliggende systemfeil) slippes gjennom.
        const cause = (error as GraphQLError).originalError ?? error;
        if (cause instanceof GraphQLError) return cause;
        // Protokollfeil fra Yoga selv (ugyldig JSON, feil metode) bærer en http-status og er trygge.
        const http = (error as GraphQLError).extensions?.http as { status?: number } | undefined;
        if (http?.status && http.status < 500) {
          return error as GraphQLError;
        }
        if (isDatabaseUnavailable(error)) return serviceUnavailableError();
        if (process.env.NODE_ENV !== 'test') console.error('Uventet feil:', error);
        return new GraphQLError('Intern feil.', { extensions: { code: 'INTERNAL_SERVER_ERROR' } });
      },
    },
  });
}
