import { screen } from '@testing-library/react';
import { act } from 'react';
import { afterEach, describe, expect, it } from 'vitest';
import { apiUnavailable } from '../apollo/apiStatus';
import { FACETS_QUERY } from '../graphql/operations';
import { EMPTY_STATE } from '../lib/searchState';
import { FACETS, GENRE_LIST, buildMocks, emptyLog, renderApp } from '../test/utils';
import { FilterPanel } from './FilterPanel';

const noop = () => undefined;

afterEach(() => act(() => apiUnavailable(false)));

describe('FilterPanel', () => {
  it('viser ikke «(0)» for valgt tiår, type eller sjanger før fasettene er lastet', async () => {
    const mocks = buildMocks(
      { Facets: () => ({ facets: FACETS }), Genres: () => ({ genres: GENRE_LIST }) },
      emptyLog(),
    );
    for (const m of mocks) m.delay = 100;
    renderApp(
      <FilterPanel
        state={{ ...EMPTY_STATE, decades: [1980], types: ['MOVIE'], genres: ['Horror'] }}
        onChange={noop}
      />,
      { mocks },
    );
    const decade = screen.getByRole('checkbox', { name: /1980-tallet/ });
    expect(decade).toBeChecked();
    expect(decade.closest('label')).not.toHaveTextContent('(0)');
    expect(screen.getByRole('checkbox', { name: /Horror/ }).closest('label')).not.toHaveTextContent(
      '(0)',
    );
    expect(screen.getByRole('checkbox', { name: /Film/ }).closest('label')).not.toHaveTextContent(
      '(0)',
    );

    // Når fasettene er lastet, er 0 et ekte tall for verdier uten treff.
    await screen.findByRole('checkbox', { name: /1990-tallet/ });
    expect(
      (await screen.findByRole('checkbox', { name: /1980-tallet/ })).closest('label'),
    ).toHaveTextContent('1980-tallet (0)');
  });

  it('forteller at tallene mangler når fasettene ikke kan hentes (ikke feil stille)', async () => {
    renderApp(<FilterPanel state={EMPTY_STATE} onChange={noop} />, {
      mocks: [
        {
          request: { query: FACETS_QUERY, variables: () => true },
          error: new Error('Noe gikk galt'),
        },
      ],
    });
    expect(await screen.findByRole('alert')).toHaveTextContent('Kunne ikke hente antall treff');
    // Selve filtrene virker fortsatt.
    expect(screen.getByRole('checkbox', { name: /Serie/ })).toBeInTheDocument();
  });

  it('overlater feilmeldingen til banneret ved nedetid', async () => {
    apiUnavailable(true);
    renderApp(<FilterPanel state={EMPTY_STATE} onChange={noop} />, {
      mocks: [
        {
          request: { query: FACETS_QUERY, variables: () => true },
          error: new Error('Failed to fetch'),
        },
      ],
    });
    await screen.findByRole('checkbox', { name: /Serie/ });
    await new Promise((r) => setTimeout(r, 50));
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });
});
