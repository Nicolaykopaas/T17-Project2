/* eslint-disable react-refresh/only-export-components -- testhjelpere, ikke en komponentfil */
import type { ReactElement } from 'react';
import { MockedProvider } from '@apollo/client/testing/react';
import type { MockLink } from '@apollo/client/testing';
import { render, screen } from '@testing-library/react';
import { MemoryRouter, useLocation } from 'react-router';
import { createCache } from '../apollo/cache';
import {
  ADD_REVIEW_MUTATION,
  FACETS_QUERY,
  GENRES_QUERY,
  MY_LIST_QUERY,
  SEARCH_QUERY,
  TITLE_QUERY,
  TOGGLE_LIST_MUTATION,
} from '../graphql/operations';
import type { Review, TitleDetails, TitleSummary } from '../graphql/types';

export type Vars = Record<string, unknown>;
type Handler = (vars: Vars) => unknown;

const OPERATIONS = {
  Search: SEARCH_QUERY,
  Facets: FACETS_QUERY,
  Genres: GENRES_QUERY,
  TitleDetails: TITLE_QUERY,
  MyList: MY_LIST_QUERY,
  AddReview: ADD_REVIEW_MUTATION,
  ToggleList: TOGGLE_LIST_MUTATION,
} as const;
export type OperationName = keyof typeof OPERATIONS;

/** Variablene hver operasjon ble kalt med, i rekkefølge. Det er «requests» i testene. */
export type CallLog = Record<OperationName, Vars[]>;

export function emptyLog(): CallLog {
  return {
    Search: [],
    Facets: [],
    Genres: [],
    TitleDetails: [],
    MyList: [],
    AddReview: [],
    ToggleList: [],
  };
}

/**
 * Lager MockedProvider-mocks der hver operasjon besvares av en funksjon av variablene.
 * `before` legger inn engangs-mocks (f.eks. nettverksfeil) som brukes først.
 */
export function buildMocks(
  handlers: Partial<Record<OperationName, Handler>>,
  log: CallLog,
  before: MockLink.MockedResponse[] = [],
): MockLink.MockedResponse[] {
  const mocks: MockLink.MockedResponse[] = [...before];
  for (const name of Object.keys(handlers) as OperationName[]) {
    const handler = handlers[name]!;
    mocks.push({
      request: { query: OPERATIONS[name], variables: () => true },
      maxUsageCount: Number.POSITIVE_INFINITY,
      result: (vars: Vars) => {
        log[name].push(vars);
        return { data: handler(vars) } as never;
      },
    });
  }
  return mocks;
}

export function LocationProbe() {
  const { pathname, search } = useLocation();
  return <div data-testid="location">{pathname + search}</div>;
}

export function renderApp(
  ui: ReactElement,
  { mocks = [], route = '/' }: { mocks?: MockLink.MockedResponse[]; route?: string } = {},
) {
  return render(
    <MockedProvider mocks={mocks} cache={createCache()}>
      <MemoryRouter initialEntries={[route]}>
        {ui}
        <LocationProbe />
      </MemoryRouter>
    </MockedProvider>,
  );
}

/** Gjeldende URL slik routeren ser den (sti + query). */
export const currentUrl = () => new URL(screen.getByTestId('location').textContent!, 'http://x');

// --- Testdata ---------------------------------------------------------------

export function makeTitle(n: number, overrides: Partial<TitleSummary> = {}): TitleSummary {
  return {
    __typename: 'Title',
    id: `tt${String(n).padStart(7, '0')}`,
    primaryTitle: `Tittel ${n}`,
    type: 'MOVIE',
    startYear: 1990 + (n % 30),
    genres: ['Drama'],
    averageRating: 7.5,
    numVotes: 1234 * n,
    ...overrides,
  };
}

export function makeConnection(nodes: TitleSummary[], total = nodes.length, hasNext = false) {
  return {
    __typename: 'TitleConnection',
    totalCount: total,
    pageInfo: {
      __typename: 'PageInfo',
      hasNextPage: hasNext,
      endCursor: nodes.length ? `cursor-${nodes[nodes.length - 1]!.id}` : null,
    },
    edges: nodes.map((node) => ({ __typename: 'TitleEdge', cursor: `cursor-${node.id}`, node })),
  };
}

export function makeReview(n: number, overrides: Partial<Review> = {}): Review {
  return {
    __typename: 'Review',
    id: `r${n}`,
    titleId: 'tt0000001',
    author: `Anmelder ${n}`,
    rating: 4,
    text: `Tekst ${n}`,
    createdAt: '2025-03-01T12:00:00.000Z',
    isMine: false,
    ...overrides,
  };
}

export function makeReviewConnection(reviews: Review[], total = reviews.length, hasNext = false) {
  return {
    __typename: 'ReviewConnection',
    totalCount: total,
    pageInfo: {
      __typename: 'PageInfo',
      hasNextPage: hasNext,
      endCursor: reviews.length ? `rc-${reviews[reviews.length - 1]!.id}` : null,
    },
    edges: reviews.map((node) => ({ __typename: 'ReviewEdge', cursor: `rc-${node.id}`, node })),
  };
}

export function makeDetails(overrides: Partial<TitleDetails> = {}) {
  return {
    ...makeTitle(1, { primaryTitle: 'The Shawshank Redemption' }),
    originalTitle: 'The Shawshank Redemption',
    endYear: null,
    runtimeMinutes: 142,
    userRating: null,
    reviewCount: 0,
    inMyList: false,
    reviews: makeReviewConnection([]),
    ...overrides,
  };
}

export const FACETS = {
  __typename: 'Facets',
  genres: [
    { __typename: 'FacetCount', value: 'Action', count: 1200 },
    { __typename: 'FacetCount', value: 'Drama', count: 34 },
  ],
  decades: [
    { __typename: 'FacetCount', value: '1990', count: 50 },
    { __typename: 'FacetCount', value: '2000', count: 7 },
  ],
  types: [
    { __typename: 'FacetCount', value: 'MOVIE', count: 40 },
    { __typename: 'FacetCount', value: 'SERIES', count: 17 },
  ],
};

export const GENRE_LIST = ['Action', 'Drama'];
