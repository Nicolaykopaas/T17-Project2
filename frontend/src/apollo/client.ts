import { ApolloClient, HttpLink } from '@apollo/client';
import { ApolloLink } from '@apollo/client';
import { SetContextLink } from '@apollo/client/link/context';
import { createCache } from './cache';
import { getUserId } from './userId';

const uri = import.meta.env.VITE_GRAPHQL_URL || import.meta.env.BASE_URL + 'graphql';

// Leses per request slik at id-en alltid finnes, også hvis lagringen ble tømt underveis.
const userIdLink = new SetContextLink((prev) => ({
  headers: { ...prev.headers, 'x-user-id': getUserId() },
}));

export function createClient() {
  return new ApolloClient({
    cache: createCache(),
    link: ApolloLink.from([userIdLink, new HttpLink({ uri })]),
  });
}
