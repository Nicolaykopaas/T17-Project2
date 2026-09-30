import { InMemoryCache } from '@apollo/client';
import { relayStylePagination } from '@apollo/client/utilities';

/**
 * keyArgs bestemmer hva som gir egen cache-oppføring. Sortering og filtre
 * hører med (ulike resultater), mens `first`/`after` ikke gjør det: sidene
 * for ett søk slås sammen til én liste. Det gjør at «tilbake» viser alle
 * innlastede sider uten ny request.
 */
export function createCache() {
  return new InMemoryCache({
    typePolicies: {
      Query: {
        fields: {
          search: relayStylePagination(['query', 'filters', 'sort']),
          myList: relayStylePagination(false),
        },
      },
      Title: {
        fields: {
          // Anmeldelsene tilhører én tittel; sidene slås sammen, og ny første side erstatter lista.
          reviews: relayStylePagination(false),
          // Lister henter bare `stream { url }`, detaljene henter resten; feltene skal flettes, ikke erstatte.
          stream: { merge: true },
        },
      },
    },
  });
}
