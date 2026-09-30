import { GraphQLError } from 'graphql';

export type ErrorCode = 'BAD_USER_INPUT' | 'NOT_FOUND' | 'UNAUTHENTICATED';

function make(code: ErrorCode) {
  return (message: string) => new GraphQLError(message, { extensions: { code } });
}

export const badInput = make('BAD_USER_INPUT');
export const notFound = make('NOT_FOUND');
export const unauthenticated = make('UNAUTHENTICATED');
