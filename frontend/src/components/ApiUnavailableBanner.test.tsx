import { ApolloProvider } from '@apollo/client/react';
import type { ApolloClient } from '@apollo/client';
import { act, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { apiUnavailable } from '../apollo/apiStatus';
import { ApiUnavailableBanner } from './ApiUnavailableBanner';

function setup(refetchQueries: () => Promise<unknown>) {
  const client = { refetchQueries: vi.fn(refetchQueries) } as unknown as ApolloClient;
  render(
    <ApolloProvider client={client}>
      <ApiUnavailableBanner />
    </ApolloProvider>,
  );
  return client;
}

afterEach(() => act(() => void apiUnavailable(false)));

describe('ApiUnavailableBanner', () => {
  it('vises ikke når API-et er tilgjengelig', () => {
    setup(async () => []);
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
    expect(screen.queryByRole('button')).not.toBeInTheDocument();
  });

  it('forklarer nedetiden og nevner NTNU VPN', () => {
    apiUnavailable(true);
    setup(async () => []);
    expect(screen.getByRole('alert')).toHaveTextContent('Får ikke kontakt med serveren');
    expect(screen.getByRole('alert')).toHaveTextContent('NTNU VPN');
    expect(screen.getByRole('button', { name: 'Prøv igjen' })).toBeEnabled();
  });

  it('«Prøv igjen» refetcher aktive queries og viser at den jobber', async () => {
    apiUnavailable(true);
    let finish!: () => void;
    const client = setup(() => new Promise((resolve) => (finish = () => resolve([]))));
    await userEvent.click(screen.getByRole('button', { name: 'Prøv igjen' }));
    expect(client.refetchQueries).toHaveBeenCalledWith({ include: 'active' });
    const busy = screen.getByRole('button', { name: 'Prøver …' });
    expect(busy).toBeDisabled();
    // Knappen ligger utenfor alert-regionen, så tekstskiftet kunngjøres ikke på nytt.
    expect(screen.getByRole('alert')).not.toContainElement(busy);
    await act(async () => finish());
    expect(screen.getByRole('button', { name: 'Prøv igjen' })).toBeEnabled();
  });

  it('tåler at refetch feiler', async () => {
    apiUnavailable(true);
    setup(() => Promise.reject(new TypeError('Failed to fetch')));
    await userEvent.click(screen.getByRole('button', { name: 'Prøv igjen' }));
    expect(await screen.findByRole('button', { name: 'Prøv igjen' })).toBeEnabled();
  });
});
