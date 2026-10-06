import { ApolloProvider } from '@apollo/client/react';
import type { ApolloClient } from '@apollo/client';
import { act, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { apiFailureKind, apiUnavailable } from '../apollo/apiStatus';
import { ApiUnavailableBanner } from './ApiUnavailableBanner';

function setup(refetchQueries: () => Promise<unknown>) {
  const client = { refetchQueries: vi.fn(refetchQueries) } as unknown as ApolloClient;
  render(
    <ApolloProvider client={client}>
      <ApiUnavailableBanner />
      <main id="innhold" tabIndex={-1} />
    </ApolloProvider>,
  );
  return client;
}

afterEach(() =>
  act(() => {
    apiUnavailable(false);
    apiFailureKind('network');
  }),
);

describe('ApiUnavailableBanner', () => {
  it('vises ikke når API-et er tilgjengelig', () => {
    setup(async () => []);
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
    expect(screen.queryByRole('button')).not.toBeInTheDocument();
  });

  it('forklarer nedetiden og nevner backend og VPN ved nettverksfeil', () => {
    apiUnavailable(true);
    setup(async () => []);
    const alert = screen.getByRole('alert');
    expect(alert).toHaveTextContent('Får ikke kontakt med serveren akkurat nå.');
    expect(alert).toHaveTextContent('må backend være startet');
    expect(alert).toHaveTextContent('VPN');
    expect(screen.getByRole('button', { name: 'Prøv igjen' })).toBeEnabled();
  });

  it('utelater VPN-hintet når backend svarer, men databasen er nede', () => {
    apiFailureKind('service');
    apiUnavailable(true);
    setup(async () => []);
    const alert = screen.getByRole('alert');
    expect(alert).toHaveTextContent('Tjenesten er midlertidig utilgjengelig.');
    expect(alert).not.toHaveTextContent('Får ikke kontakt');
    expect(alert).toHaveTextContent('databasen er nede');
    expect(alert).not.toHaveTextContent('VPN');
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

  it('gir tilbakemelding i en status-region (ikke alerten) når forsøket mislykkes', async () => {
    apiUnavailable(true);
    setup(async () => []);
    const status = screen.getByRole('status');
    expect(status).toBeEmptyDOMElement();
    await userEvent.click(screen.getByRole('button', { name: 'Prøv igjen' }));
    expect(await screen.findByText('Fortsatt ingen kontakt med serveren.')).toBe(status);
    expect(screen.getByRole('alert')).not.toContainElement(status);
    expect(screen.getAllByRole('alert')).toHaveLength(1);
  });

  it('flytter fokus til main når forsøket lykkes og knappen forsvinner', async () => {
    apiUnavailable(true);
    setup(async () => {
      apiUnavailable(false);
      return [];
    });
    await userEvent.click(screen.getByRole('button', { name: 'Prøv igjen' }));
    await waitFor(() => expect(screen.getByRole('main')).toHaveFocus());
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });
});
