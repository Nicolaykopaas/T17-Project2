import { ApolloProvider } from '@apollo/client/react';
import { act, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { createMemoryRouter, RouterProvider } from 'react-router';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { apiUnavailable } from '../apollo/apiStatus';
import { createClient } from '../apollo/client';
import { Layout } from '../components/Layout';
import { makeConnection, makeFeatured } from '../test/utils';
import HomePage from './HomePage';

// Ekte klient med ekte linkkjede og falsk fetch: da testes også error-linken i sammenheng.
function setup() {
  const router = createMemoryRouter([
    { element: <Layout />, children: [{ index: true, element: <HomePage /> }] },
  ]);
  render(
    <ApolloProvider client={createClient()}>
      <RouterProvider router={router} />
    </ApolloProvider>,
  );
}

const json = (body: unknown, status = 200) =>
  Promise.resolve(
    new Response(JSON.stringify(body), {
      status,
      headers: { 'content-type': 'application/json' },
    }),
  );

beforeEach(() => {
  localStorage.clear();
  vi.stubGlobal(
    'IntersectionObserver',
    class {
      observe = () => undefined;
      unobserve = () => undefined;
      disconnect = () => undefined;
      takeRecords = () => [];
    },
  );
});
afterEach(() => {
  vi.unstubAllGlobals();
  act(() => void apiUnavailable(false));
});

describe('forsiden når API-et ikke kan nås', () => {
  it('viser ÉN alert (banneret), ikke én feil per rad', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new TypeError('Failed to fetch')));
    setup();
    const alert = await screen.findByRole('alert');
    expect(alert).toHaveTextContent('Får ikke kontakt med serveren akkurat nå.');
    expect(screen.getAllByRole('alert')).toHaveLength(1);
    expect(screen.queryByText('Kunne ikke hente denne raden.')).not.toBeInTheDocument();
    // Raden finnes fortsatt, men som stille skjelett.
    expect(screen.getByRole('region', { name: 'Mest populære' })).toBeInTheDocument();
  });

  it('behandler 502 fra proxyen som nedetid', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(() => Promise.resolve(new Response('<html>Bad gateway</html>', { status: 502 }))),
    );
    setup();
    expect(await screen.findByRole('alert')).toHaveTextContent('Får ikke kontakt med serveren');
  });

  it('«Prøv igjen» henter data og fjerner banneret', async () => {
    const fetchMock = vi.fn().mockRejectedValue(new TypeError('Failed to fetch'));
    vi.stubGlobal('fetch', fetchMock);
    setup();
    await screen.findByRole('alert');

    fetchMock.mockImplementation(() =>
      json({ data: { search: makeConnection([makeFeatured(1), makeFeatured(2)]) } }),
    );
    await userEvent.click(screen.getByRole('button', { name: 'Prøv igjen' }));

    await waitFor(() => expect(screen.queryByRole('alert')).not.toBeInTheDocument());
    const row = screen.getByRole('region', { name: 'Mest populære' });
    expect(await within(row).findAllByRole('article')).toHaveLength(2);
  });

  it('en GraphQL-feil er ikke nedetid: per-rad-feil og ingen banner', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(() => json({ errors: [{ message: 'Ugyldig input' }] })),
    );
    setup();
    const alert = await screen.findByRole('alert');
    expect(alert).toHaveTextContent('Kunne ikke hente denne raden.');
    expect(screen.getAllByRole('alert')).toHaveLength(1);
    expect(screen.queryByText(/Får ikke kontakt med serveren/)).not.toBeInTheDocument();
    expect(within(alert).getByRole('button', { name: 'Prøv igjen' })).toBeInTheDocument();
  });
});
