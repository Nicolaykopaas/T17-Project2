import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';
import {
  FACETS,
  GENRE_LIST,
  buildMocks,
  currentUrl,
  emptyLog,
  makeConnection,
  makeTitle,
  renderApp,
  type Vars,
} from '../test/utils';
import HomePage from './HomePage';

const titles = [makeTitle(1), makeTitle(2)];

function setup(route = '/', searchHandler?: (v: Vars) => unknown) {
  const log = emptyLog();
  const utils = renderApp(<HomePage />, {
    route,
    mocks: buildMocks(
      {
        Search: searchHandler ?? (() => ({ search: makeConnection(titles, 1234) })),
        Facets: () => ({ facets: FACETS }),
        Genres: () => ({ genres: GENRE_LIST }),
      },
      log,
    ),
  });
  return { log, user: userEvent.setup(), ...utils };
}

const resultLinks = () =>
  screen.getAllByRole('link').filter((a) => a.getAttribute('href')?.startsWith('/title/'));

describe('HomePage: søk', () => {
  it('har én h1 og laster «bla i alle» én gang ved oppstart', async () => {
    const { log } = setup();
    expect(screen.getAllByRole('heading', { level: 1 })).toHaveLength(1);
    await screen.findByRole('link', { name: 'Tittel 1' });
    expect(log.Search).toHaveLength(1);
    expect(log.Search[0]).toMatchObject({ query: null, first: 20 });
    expect(log.Search[0]?.sort).toBeUndefined();
  });

  it('søker etter debounce, oppdaterer URL og sender trimmet tekst', async () => {
    const { log, user } = setup();
    await screen.findByRole('link', { name: 'Tittel 1' });
    await user.type(screen.getByLabelText('Søk etter tittel'), '  matrix ');
    await waitFor(() => expect(log.Search).toHaveLength(2), { timeout: 2000 });
    expect(log.Search[1]).toMatchObject({ query: 'matrix' });
    expect(currentUrl().searchParams.get('q')).toBe('matrix');
  });

  it('sender ingen ny request når bare mellomrom legges til', async () => {
    const { log, user } = setup('/?q=matrix');
    await screen.findByRole('link', { name: 'Tittel 1' });
    expect(log.Search).toHaveLength(1);
    await user.type(screen.getByLabelText('Søk etter tittel'), '   ');
    // Vent forbi debounce-tiden; deretter skal fortsatt bare den første requesten finnes.
    await new Promise((r) => setTimeout(r, 450));
    expect(log.Search).toHaveLength(1);
  });

  it('fyller feltet fra URL og tøm-knappen går tilbake til «bla i alle»', async () => {
    const { log, user } = setup('/?q=alien');
    const input = screen.getByLabelText('Søk etter tittel');
    expect(input).toHaveValue('alien');
    await screen.findByRole('link', { name: 'Tittel 1' });
    await user.click(screen.getByRole('button', { name: 'Tøm søkefeltet' }));
    await waitFor(() => expect(log.Search).toHaveLength(2));
    expect(log.Search[1]).toMatchObject({ query: null });
    expect(currentUrl().searchParams.has('q')).toBe(false);
    expect(input).toHaveValue('');
  });
});

describe('HomePage: filtre', () => {
  it('viser antall treff per verdi fra facets', async () => {
    setup();
    const label = (name: RegExp) =>
      screen.getByRole('checkbox', { name }).closest('label')!.textContent!.replace(/\s/g, ' ');
    // Sjangerlista og fasettene kommer fra to separate requests.
    await waitFor(() => expect(label(/Action/)).toBe('Action (1 200)'));
    expect(label(/Drama/)).toBe('Drama (34)');
    expect(label(/1990-tallet/)).toBe('1990-tallet (50)');
    expect(label(/2000-tallet/)).toBe('2000-tallet (7)');
    expect(label(/Film/)).toBe('Film (40)');
    expect(label(/Serie/)).toBe('Serie (17)');
  });

  it('avkrysning oppdaterer URL, variabler og viser en fjernbar chip', async () => {
    const { log, user } = setup();
    await user.click(await screen.findByRole('checkbox', { name: /Action/ }));
    await user.click(screen.getByRole('checkbox', { name: /1990-tallet/ }));
    await user.click(screen.getByRole('checkbox', { name: /Serie/ }));

    await waitFor(() => expect(currentUrl().searchParams.get('genres')).toBe('Action'));
    expect(currentUrl().searchParams.get('decades')).toBe('1990');
    expect(currentUrl().searchParams.get('types')).toBe('serie');

    await waitFor(() =>
      expect(log.Search.at(-1)).toMatchObject({
        filters: { genres: ['Action'], decades: [1990], types: ['SERIES'] },
      }),
    );
    // Fasettene hentes også på nytt med de nye filtrene.
    await waitFor(() =>
      expect(log.Facets.at(-1)).toMatchObject({
        filters: { genres: ['Action'], decades: [1990], types: ['SERIES'] },
      }),
    );

    const chips = screen.getByRole('list', { name: 'Aktive filtre' });
    expect(within(chips).getAllByRole('button')).toHaveLength(3);

    await user.click(within(chips).getByRole('button', { name: /Action/ }));
    await waitFor(() => expect(currentUrl().searchParams.has('genres')).toBe(false));
    expect(screen.getByRole('checkbox', { name: /Action/ })).not.toBeChecked();
    expect(
      within(screen.getByRole('list', { name: 'Aktive filtre' })).getAllByRole('button'),
    ).toHaveLength(2);
  });

  it('leser filtre fra URL, og avhuking fjerner dem', async () => {
    const { user } = setup('/?genres=Drama&minRating=7');
    expect(await screen.findByRole('checkbox', { name: /Drama/ })).toBeChecked();
    expect(screen.getByLabelText('Minimum IMDb-rating')).toHaveValue('7');
    await user.click(screen.getByRole('checkbox', { name: /Drama/ }));
    await waitFor(() => expect(currentUrl().searchParams.has('genres')).toBe(false));
  });

  it('minimum rating sendes som minRating', async () => {
    const { log, user } = setup();
    await screen.findByRole('link', { name: 'Tittel 1' });
    await user.selectOptions(screen.getByLabelText('Minimum IMDb-rating'), '8');
    await waitFor(() => expect(log.Search.at(-1)).toMatchObject({ filters: { minRating: 8 } }));
    expect(currentUrl().searchParams.get('minRating')).toBe('8');
    expect(screen.getByRole('button', { name: /Rating minst 8/ })).toBeInTheDocument();
  });

  it('«Nullstill alle» fjerner alle filtre, men beholder søketeksten', async () => {
    const { user, log } = setup(
      '/?q=alien&genres=Action,Drama&decades=1990&types=film&minRating=6',
    );
    await screen.findByRole('link', { name: 'Tittel 1' });
    await user.click(screen.getByRole('button', { name: 'Nullstill alle' }));
    await waitFor(() => expect(currentUrl().search).toBe('?q=alien'));
    expect(screen.queryByRole('list', { name: 'Aktive filtre' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Nullstill alle' })).not.toBeInTheDocument();
    await waitFor(() => expect(log.Search.at(-1)).toEqual({ query: 'alien', first: 20 }));
  });

  it('filterpanelet kan kollapses med en knapp som har aria-expanded', async () => {
    const { user } = setup();
    const toggle = screen.getByRole('button', { name: /^Filtre/ });
    expect(toggle).toHaveAttribute('aria-expanded', 'false');
    await user.click(toggle);
    expect(toggle).toHaveAttribute('aria-expanded', 'true');
    expect(document.getElementById(toggle.getAttribute('aria-controls')!)).toHaveClass('is-open');
  });
});

describe('HomePage: sortering', () => {
  it('sender valgt felt og standardretning som variabel', async () => {
    const { log, user } = setup();
    await screen.findByRole('link', { name: 'Tittel 1' });
    await user.selectOptions(screen.getByLabelText('Sorter etter'), 'Tittel');
    await waitFor(() =>
      expect(log.Search.at(-1)).toMatchObject({ sort: { field: 'TITLE', direction: 'ASC' } }),
    );
    expect(currentUrl().searchParams.get('sort')).toBe('tittel');
  });

  it('sender valgt retning', async () => {
    const { log, user } = setup();
    await screen.findByRole('link', { name: 'Tittel 1' });
    await user.selectOptions(screen.getByLabelText('Sorter etter'), 'Rating');
    await user.selectOptions(screen.getByLabelText('Rekkefølge'), 'Stigende');
    await waitFor(() =>
      expect(log.Search.at(-1)).toMatchObject({ sort: { field: 'RATING', direction: 'ASC' } }),
    );
    expect(currentUrl().searchParams.get('dir')).toBe('asc');
  });

  it('rekkefølgen på resultatene bestemmes av serveren, ikke klienten', async () => {
    // Serveren svarer med «feil» rekkefølge for å bevise at klienten ikke sorterer om.
    const reversed = [
      makeTitle(9, { primaryTitle: 'Zebra' }),
      makeTitle(3, { primaryTitle: 'Alfa' }),
    ];
    setup('/?sort=tittel', () => ({ search: makeConnection(reversed) }));
    await screen.findByRole('link', { name: 'Zebra' });
    expect(resultLinks().map((a) => a.textContent)).toEqual(['Zebra', 'Alfa']);
  });
});
