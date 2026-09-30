import { MockedProvider } from '@apollo/client/testing/react';
import { act, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { createMemoryRouter, RouterProvider } from 'react-router';
import { afterEach, describe, expect, it } from 'vitest';
import { createCache } from '../apollo/cache';
import { Layout } from './Layout';

// ScrollRestoration i Layout krever en data-router, så vi bruker createMemoryRouter her.
function setup(route = '/') {
  const router = createMemoryRouter(
    [
      {
        element: <Layout />,
        children: [
          { index: true, element: <h1>Forside</h1> },
          { path: 'title/:id', element: <h1>Detalj</h1> },
        ],
      },
    ],
    { initialEntries: [route] },
  );
  render(
    <MockedProvider mocks={[]} cache={createCache()}>
      <RouterProvider router={router} />
    </MockedProvider>,
  );
  return router;
}

const scrollTo = (y: number) => {
  Object.defineProperty(window, 'scrollY', { value: y, configurable: true });
  act(() => {
    window.dispatchEvent(new Event('scroll'));
  });
};

afterEach(() => scrollTo(0));

describe('Layout', () => {
  it('har skip-link, hovedmeny med Min liste og søkefelt i headeren', () => {
    setup();
    expect(screen.getByRole('link', { name: 'Hopp til innhold' })).toHaveAttribute(
      'href',
      '#innhold',
    );
    const nav = screen.getByRole('navigation', { name: 'Hovedmeny' });
    expect(within(nav).getByRole('link', { name: 'Min liste' })).toHaveAttribute(
      'href',
      '/my-list',
    );
    const header = screen.getByRole('banner');
    expect(within(header).getByLabelText('Søk etter tittel')).toBeInTheDocument();
  });

  it('skip-link flytter fokus til main', async () => {
    setup();
    await userEvent.click(screen.getByRole('link', { name: 'Hopp til innhold' }));
    expect(screen.getByRole('main')).toHaveFocus();
  });

  it('gjør headeren heldekkende først når siden er scrollet', () => {
    setup();
    const header = screen.getByRole('banner');
    expect(header).not.toHaveClass('is-scrolled');
    scrollTo(300);
    expect(header).toHaveClass('is-scrolled');
    scrollTo(0);
    expect(header).not.toHaveClass('is-scrolled');
  });

  it('har TMDB-attribusjon med lenke i footeren', () => {
    setup();
    const footer = screen.getByRole('contentinfo');
    expect(footer).toHaveTextContent(
      'Bilder og beskrivelser fra TMDB (åpnes i ny fane). Dette produktet bruker TMDB-API-et, men er ikke godkjent eller sertifisert av TMDB.',
    );
    const link = within(footer).getByRole('link', { name: /TMDB/ });
    expect(link).toHaveAttribute('href', 'https://www.themoviedb.org/');
    expect(link).toHaveAttribute('rel', expect.stringContaining('noopener'));
  });

  it('søk fra en annen side sender brukeren til forsiden med søket', async () => {
    const user = userEvent.setup();
    const router = setup('/title/tt1');
    const input = screen.getByLabelText('Søk etter tittel');
    await user.type(input, 'heat{Enter}');
    expect(await screen.findByRole('heading', { name: 'Forside' })).toBeInTheDocument();
    expect(router.state.location.pathname + router.state.location.search).toBe('/?q=heat');
    // Fokus blir i søkefeltet slik at brukeren kan fortsette å skrive.
    expect(input).toHaveFocus();
  });
});
