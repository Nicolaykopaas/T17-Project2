import { act, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { Route, Routes } from 'react-router';
import { describe, expect, it } from 'vitest';
import { WATCH_QUERY } from '../graphql/operations';
import {
  buildMocks,
  currentUrl,
  emptyLog,
  makeStream,
  makeWatchTitle,
  renderApp,
  type CallLog,
} from '../test/utils';
import WatchPage from './WatchPage';

function setup(
  handlers: Parameters<typeof buildMocks>[0],
  before: Parameters<typeof buildMocks>[2] = [],
) {
  const log: CallLog = emptyLog();
  renderApp(
    <Routes>
      <Route path="/watch/:id" element={<WatchPage />} />
    </Routes>,
    { route: '/watch/tt0000001', mocks: buildMocks(handlers, log, before) },
  );
  return { log, user: userEvent.setup() };
}

describe('WatchPage', () => {
  it('viser tittel som eneste h1, spiller, tilbakelenke, lisens og kilde', async () => {
    const { log } = setup({
      Watch: () => ({
        title: makeWatchTitle({
          stream: makeStream({ license: 'CC BY 4.0', durationSeconds: 5530 }),
        }),
      }),
    });
    expect(await screen.findByRole('heading', { level: 1, name: 'Nosferatu' })).toBeInTheDocument();
    expect(screen.getAllByRole('heading', { level: 1 })).toHaveLength(1);
    expect(log.Watch).toEqual([{ id: 'tt0000001' }]);

    const video = document.querySelector('video')!;
    expect(video).toHaveAttribute('src', 'https://archive.example/download/film/film.mp4');
    expect(video).toHaveAttribute('preload', 'metadata');
    expect(screen.getByRole('group', { name: 'Videospiller: Nosferatu' })).toBeInTheDocument();

    const back = screen.getByRole('link', { name: /Tilbake/ });
    expect(back).toHaveAttribute('href', '/title/tt0000001');
    expect(back.textContent).toContain('← Tilbake');
    expect(screen.getByRole('link', { name: /CC BY 4\.0/ })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: /Internet Archive/ })).toHaveAttribute(
      'href',
      'https://archive.example/details/film',
    );
    expect(screen.getByText(/1:32:10/, { selector: 'p' })).toBeInTheDocument();
    expect(document.title).toBe('Se Nosferatu – Filmsøk');
  });

  it('viser «ingen gratisversjon» med lenke til detaljsiden når stream mangler', async () => {
    setup({ Watch: () => ({ title: makeWatchTitle({ stream: null }) }) });
    expect(await screen.findByRole('heading', { level: 1, name: 'Nosferatu' })).toBeInTheDocument();
    expect(screen.getByText(/ingen gratisversjon/)).toBeInTheDocument();
    expect(document.querySelector('video')).toBeNull();
    expect(screen.getByRole('link', { name: /Se detaljer/ })).toHaveAttribute(
      'href',
      '/title/tt0000001',
    );
  });

  it('viser 404 når tittelen ikke finnes', async () => {
    setup({ Watch: () => ({ title: null }) });
    expect(
      await screen.findByRole('heading', { level: 1, name: 'Fant ikke tittelen' }),
    ).toBeInTheDocument();
    expect(document.querySelector('video')).toBeNull();
  });

  it('viser lasteskjelett først', () => {
    setup({ Watch: () => ({ title: makeWatchTitle() }) });
    expect(screen.getByRole('heading', { level: 1, name: 'Laster …' })).toBeInTheDocument();
  });

  it('viser feil med «Prøv igjen» ved nettverksfeil', async () => {
    const { user } = setup({ Watch: () => ({ title: makeWatchTitle() }) }, [
      {
        request: { query: WATCH_QUERY, variables: () => true },
        maxUsageCount: 1,
        error: new Error('Failed to fetch'),
      },
    ]);
    expect(await screen.findByRole('alert')).toHaveTextContent('Kunne ikke hente filmen');
    await user.click(screen.getByRole('button', { name: 'Prøv igjen' }));
    expect(await screen.findByRole('heading', { level: 1, name: 'Nosferatu' })).toBeInTheDocument();
  });
});

describe('WatchPage: tilbake', () => {
  const handlers = { Watch: () => ({ title: makeWatchTitle() }) };

  it('går tilbake i historikken når man kom fra tittelsiden (ingen ring tittel ↔ spiller)', async () => {
    const log: CallLog = emptyLog();
    const { router } = renderApp(
      <Routes>
        <Route path="/title/:id" element={<p>Tittelside</p>} />
        <Route path="/watch/:id" element={<WatchPage />} />
      </Routes>,
      { route: '/title/tt0000001', mocks: buildMocks(handlers, log) },
    );
    await act(() => router.navigate('/watch/tt0000001'));
    await screen.findByRole('heading', { level: 1, name: 'Nosferatu' });

    // En knapp (navigate(-1)), ikke en lenke som ville lagt tittelsiden på historikken én gang til.
    expect(screen.queryByRole('link', { name: /Tilbake/ })).not.toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: /Tilbake/ }));
    expect(await screen.findByText('Tittelside')).toBeInTheDocument();
    expect(currentUrl().pathname).toBe('/title/tt0000001');
    expect(router.state.historyAction).toBe('POP');
  });

  it('lenker til tittelsiden ved direkte åpning, der det ikke finnes noen forrige side', async () => {
    setup(handlers);
    const back = await screen.findByRole('link', { name: /Tilbake\s*til Nosferatu/ });
    expect(back).toHaveAttribute('href', '/title/tt0000001');
    expect(screen.queryByRole('button', { name: /Tilbake/ })).not.toBeInTheDocument();
  });
});
