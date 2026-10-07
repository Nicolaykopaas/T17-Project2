import { GraphQLError, parse, type ValidationRule } from 'graphql';
import { createYoga, type Plugin } from 'graphql-yoga';
import { ArtworkService } from './artwork.js';
import { config } from './config.js';
import { createContext, type Context } from './context.js';
import type { Pool } from './db.js';
import { complexityLimit } from './complexityLimit.js';
import { isDatabaseUnavailable, serviceUnavailableError } from './dbErrors.js';
import { depthLimit } from './depthLimit.js';
import { DEFAULT_RATE_LIMITS, MutationLimiter, type RateLimitOptions } from './rateLimit.js';
import { schema } from './schema.js';

/** Serverkonteksten Yoga får fra node:http; fravær av `req` betyr kall via yoga.fetch (tester). */
interface NodeServerContext {
  req?: { socket?: { remoteAddress?: string } };
}

export const MAX_QUERY_DEPTH = 6;
// Frontendens største spørring (Title-detaljene) har ca. 45 felt og ett rotfelt. Grensene gir rundt
// tre ganger slingringsmonn, men stopper hundrevis av aliasede søk eller TMDB-oppslag i ett dokument.
export const MAX_ROOT_FIELDS = 8;
export const MAX_FIELDS = 150;
// Vektet kostnad (felt under en liste teller `first` ganger, variabel `first` = 50). Frontendens
// største spørring (forsiden/Featured) ligger på ca. 1 100; 2 500 slipper den gjennom to ganger,
// men stopper f.eks. 8 x search(first: 50) med nøstede anmeldelser.
export const MAX_COST = 2500;
// Tak på antall tokens i ett dokument. graphql-js sin regel OverlappingFieldsCanBeMerged er
// kvadratisk i antall felt, og complexityLimit stopper ikke de andre reglene: `{ genres genres ... }`
// med 8 000 felt (55 kB) holdt event-loopen i ca. 5 s. Tokengrensen avviser dokumentet under
// parsing, før noen valideringsregel kjører. Frontendens største operasjon har 128 tokens og
// introspeksjonsspørringen til GraphiQL ca. 180, så 1 000 gir åtte ganger slingringsmonn.
export const MAX_TOKENS = 1000;
// Alle legitime forespørsler er små (spørring + variabler); 25 MB-standarden i Yoga lar en
// angriper tvinge oss til å lese og JSON-parse store kropper før noen grense slår inn.
export const MAX_REQUEST_BODY_BYTES = 64 * 1024;

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

interface AppOptions {
  pool: Pool;
  /** Slår av introspeksjon og GraphiQL. Standard: NODE_ENV === 'production'. */
  production?: boolean;
  /** Tillatt CORS-opprinnelse (kun utvikling). false = ingen CORS-headere. */
  corsOrigin?: string | false;
  /** TMDB-tjenesten. Standard: bygges fra miljøvariablene (TMDB_API_KEY osv.). */
  artwork?: ArtworkService;
  /** Base-URL for Internet Archive i stream-URL-ene. Standard: ARCHIVE_URL. */
  archiveUrl?: string;
  /** Overstyrer grensene for mutations (se rateLimit.ts). Standard: DEFAULT_RATE_LIMITS. */
  rateLimits?: Partial<RateLimitOptions>;
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
  rateLimits,
}: AppOptions) {
  // Én begrenser per app: tilstanden må overleve mellom requests, i motsetning til konteksten.
  const limiter = new MutationLimiter({ ...DEFAULT_RATE_LIMITS, ...rateLimits });
  const artworkService = artwork ?? new ArtworkService({ pool, apiKey: config.tmdbApiKey });
  const isProd = production ?? process.env.NODE_ENV === 'production';

  // Egendefinert plugin i stedet for ekstra pakker: envelop lar oss legge til valideringsregler.
  const limits: Plugin = {
    onParse({ setParseFn }) {
      setParseFn((source, options) => parse(source, { ...options, maxTokens: MAX_TOKENS }));
    },
    onValidate({ addValidationRule }) {
      addValidationRule(depthLimit(MAX_QUERY_DEPTH));
      addValidationRule(
        complexityLimit({
          maxRootFields: MAX_ROOT_FIELDS,
          maxFields: MAX_FIELDS,
          maxCost: MAX_COST,
        }),
      );
      if (isProd) addValidationRule(noIntrospection);
    },
  };

  // Yogas innebygde /health svarer «alive» uten å se på databasen. Vi trenger det motsatte: sjekk.sh,
  // Apache og drift skal få vite om API-et faktisk kan svare, så Yogas flyttes og vår tar over stien.
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

  return createYoga<NodeServerContext, Context>({
    schema,
    graphqlEndpoint: '/graphql',
    healthCheckEndpoint: '/__yoga-health',
    plugins: [health, limits],
    maxRequestBodySize: MAX_REQUEST_BODY_BYTES,
    // `req` finnes bare når Yoga kjører under node:http (ikke i yoga.fetch i tester).
    context: ({ request, req }) =>
      createContext(
        pool,
        request,
        artworkService,
        archiveUrl ?? config.archiveUrl,
        limiter,
        req?.socket?.remoteAddress,
      ),
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
