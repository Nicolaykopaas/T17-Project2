import { ApolloClient, HttpLink } from '@apollo/client';
import { ApolloLink } from '@apollo/client';
import { SetContextLink } from '@apollo/client/link/context';
import { tap } from 'rxjs';
import { ErrorLink } from '@apollo/client/link/error';
import { apiFailureKind, apiUnavailable, classifyApiFailure } from './apiStatus';
import { createCache } from './cache';
import { getUserId } from './userId';

const uri = import.meta.env.VITE_GRAPHQL_URL || import.meta.env.BASE_URL + 'graphql';

// Leses per request slik at id-en alltid finnes, også hvis lagringen ble tømt underveis.
const userIdLink = new SetContextLink((prev) => ({
  headers: { ...prev.headers, 'x-user-id': getUserId() },
}));

// Setter tilstanden ved nettverksfeil og nullstiller ved første svar fra serveren (også et
// GraphQL-feilsvar: da svarte den). I linkkjeden slik at alle queries og mutations dekkes.
const apiStatusLink = ApolloLink.from([
  new ErrorLink(({ error }) => {
    const kind = classifyApiFailure(error);
    if (!kind) return;
    apiFailureKind(kind);
    apiUnavailable(true);
  }),
  new ApolloLink((operation, forward) =>
    forward(operation).pipe(
      tap(() => {
        if (apiUnavailable()) apiUnavailable(false);
      }),
    ),
  ),
]);

export function createClient() {
  return new ApolloClient({
    cache: createCache(),
    link: ApolloLink.from([userIdLink, apiStatusLink, new HttpLink({ uri })]),
  });
}
