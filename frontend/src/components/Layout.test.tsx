import { MockedProvider } from '@apollo/client/testing/react';
import { act, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useEffect, useState } from 'react';
import { createMemoryRouter, RouterProvider } from 'react-router';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createCache } from '../apollo/cache';
import { Layout } from './Layout';

/** Som en lazy-lastet side: h1 kommer først etter «Laster …», og byttes ut når data er hentet. */
function LatePage() {
  const [ready, setReady] = useState(false);
  useEffect(() => {
    const t = setTimeout(() => setReady(true), 20);
    return () => clearTimeout(t);
  }, []);
  return ready ? <h1>Ferdig lastet</h1> : <p>Laster …</p>;
}

// ScrollRestoration i Layout krever en data-router, så vi bruker createMemoryRouter her.
function setup(route = '/') {
  const router = createMemoryRouter(
    [
      {
        element: <Layout />,
        children: [
          { index: true, element: <h1>Forside</h1> },
          { path: 'title/:id', element: <h1>Detalj</h1> },
          {
            path: 'sr',
            element: (
              <>
                <h1 className="sr-only">Skjult overskrift</h1>
                <h2>Synlig</h2>
              </>
            ),
          },
          { path: 'uten-h1', element: <p>Bare tekst</p> },
          { path: 'sen', element: <LatePage /> },
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

// jsdom implementerer ikke scrollTo; ScrollRestoration kaller den ved hvert rutebytte.
beforeEach(() => void vi.stubGlobal('scrollTo', vi.fn()));
afterEach(() => {
  vi.unstubAllGlobals();
  scrollTo(0);
});

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

  describe('fokus ved rutebytte', () => {
    it('flytter fokus til sidens h1, ikke til main', async () => {
      const router = setup('/');
      await act(() => router.navigate('/title/tt1'));
      const h1 = await screen.findByRole('heading', { level: 1, name: 'Detalj' });
      expect(h1).toHaveFocus();
      expect(h1).toHaveAttribute('tabindex', '-1');
    });

    it('fungerer med en sr-only h1 og velger den første h1', async () => {
      const router = setup('/');
      await act(() => router.navigate('/sr'));
      expect(await screen.findByRole('heading', { level: 1 })).toHaveFocus();
    });

    it('faller tilbake til main når siden ikke har h1', async () => {
      const router = setup('/');
      await act(() => router.navigate('/uten-h1'));
      await screen.findByText('Bare tekst');
      expect(screen.getByRole('main')).toHaveFocus();
    });

    it('flytter fokus til h1 som først kommer etter «Laster …»', async () => {
      const router = setup('/');
      await act(() => router.navigate('/sen'));
      expect(screen.getByRole('main')).toHaveFocus();
      const h1 = await screen.findByRole('heading', { level: 1, name: 'Ferdig lastet' });
      await waitFor(() => expect(h1).toHaveFocus());
    });

    it('stjeler ikke fokus hvis brukeren har flyttet det før h1 kommer', async () => {
      const router = setup('/');
      await act(() => router.navigate('/sen'));
      const search = screen.getByLabelText('Søk etter tittel');
      search.focus();
      // Søkefeltet står utenfor main; endringen i innholdet skal ikke dra fokus tilbake.
      await screen.findByRole('heading', { level: 1, name: 'Ferdig lastet' });
      expect(search).toHaveFocus();
    });
  });
});
