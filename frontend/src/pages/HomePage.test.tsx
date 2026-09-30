import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { FEATURED_QUERY } from '../graphql/operations';
import {
  FACETS,
  GENRE_LIST,
  buildMocks,
  currentUrl,
  emptyLog,
  makeConnection,
  makeFeatured,
  makeTitle,
  renderApp,
  type Vars,
} from '../test/utils';
import { HeaderSearch } from '../components/HeaderSearch';
import HomePage from './HomePage';

const titles = [makeTitle(1), makeTitle(2)];
const featured = [
  makeFeatured(11, {
    primaryTitle: 'Uten bilde',
  }),
  makeFeatured(12, {
    primaryTitle: 'Med bilde',
    overview: 'En handling.',
    backdrop780: 'http://x/b780.jpg',
    backdrop1280: 'http://x/b1280.jpg',
    poster185: 'http://x/p185.jpg',
    poster342: 'http://x/p342.jpg',
  }),
];

// «/?sort=relevans» er søkemodus uten filtre; «/» alene er bla-modus (se egen describe under).
function setup(route = '/?sort=relevans', searchHandler?: (v: Vars) => unknown) {
  const log = emptyLog();
  const utils = renderApp(
    <>
      <HeaderSearch />
      <HomePage />
    </>,
    {
      route,
      mocks: buildMocks(
        {
          Featured: () => ({ search: makeConnection(featured, 20, true) }),
          Search: searchHandler ?? (() => ({ search: makeConnection(titles, 1234) })),
          Facets: () => ({ facets: FACETS }),
          Genres: () => ({ genres: GENRE_LIST }),
        },
        log,
      ),
    },
  );
  return { log, user: userEvent.setup(), ...utils };
}

const resultLinks = () =>
  screen.getAllByRole('link').filter((a) => a.getAttribute('href')?.startsWith('/title/'));

describe('HomePage: søk', () => {
  it('har én h1 og laster treffene én gang ved oppstart', async () => {
    const { log } = setup();
    expect(screen.getAllByRole('heading', { level: 1 })).toHaveLength(1);
    await screen.findByRole('link', { name: 'Tittel 1' });
    expect(log.Search).toHaveLength(1);
    expect(log.Search[0]).toMatchObject({ query: null, first: 20 });
    expect(log.Featured).toHaveLength(0);
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

  it('fyller feltet fra URL, og tøm-knappen tar bort q og går tilbake til bla-modus', async () => {
    const { log, user } = setup('/?q=alien');
    const input = screen.getByLabelText('Søk etter tittel');
    expect(input).toHaveValue('alien');
    await screen.findByRole('link', { name: 'Tittel 1' });
    await user.click(screen.getByRole('button', { name: 'Tøm søkefeltet' }));
    await waitFor(() => expect(log.Featured).toHaveLength(1));
    expect(currentUrl().searchParams.has('q')).toBe(false);
    expect(input).toHaveValue('');
    expect(screen.queryByText(/treff/)).not.toBeInTheDocument();
  });

  it('beholder filtrene når q endres', async () => {
    const { user } = setup('/?types=film');
    await screen.findByRole('link', { name: 'Tittel 1' });
    await user.type(screen.getByLabelText('Søk etter tittel'), 'heat');
    await waitFor(() => expect(currentUrl().searchParams.get('q')).toBe('heat'), {
      timeout: 2000,
    });
    expect(currentUrl().searchParams.get('types')).toBe('film');
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

/** IntersectionObserver-attrapp som lar testen bestemme hvilke rader som «nærmer seg» viewport. */
function stubIntersectionObserver() {
  const observed = new Map<Element, (entries: IntersectionObserverEntry[]) => void>();
  class FakeObserver {
    constructor(private cb: (entries: IntersectionObserverEntry[]) => void) {}
    observe = (el: Element) => void observed.set(el, this.cb);
    unobserve = () => undefined;
    disconnect = () => undefined;
    takeRecords = () => [];
  }
  vi.stubGlobal('IntersectionObserver', FakeObserver);
  return {
    reveal(el: Element) {
      observed.get(el)?.([{ isIntersecting: true, target: el } as IntersectionObserverEntry]);
    },
    observed,
  };
}

describe('HomePage: bla-modus', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('viser hero for første tittel med bilde, med lenke, oversikt og bilde-attributter', async () => {
    stubIntersectionObserver();
    setup('/');
    const hero = await screen.findByRole('region', { name: 'Med bilde' });
    expect(within(hero).getByText('En handling.')).toBeInTheDocument();
    expect(within(hero).getByRole('link', { name: /Se detaljer/ })).toHaveAttribute(
      'href',
      '/title/tt0000012',
    );
    expect(within(hero).getByRole('button', { name: 'Legg i min liste' })).toBeInTheDocument();
    const img = hero.querySelector('img')!;
    expect(img).toHaveAttribute('fetchpriority', 'high');
    expect(img).toHaveAttribute('srcset', 'http://x/b780.jpg 780w, http://x/b1280.jpg 1280w');
    expect(img).toHaveAttribute('alt', '');
    expect(img).toHaveAttribute('width', '1280');
    expect(img).toHaveAttribute('height', '720');
    expect(screen.getAllByRole('heading', { level: 1 })).toHaveLength(1);
  });

  it('henter toppraden med sortering som variabler og utsetter rader under folden', async () => {
    const io = stubIntersectionObserver();
    const { log } = setup('/');
    await screen.findByRole('region', { name: 'Med bilde' });
    expect(log.Featured).toHaveLength(1);
    expect(log.Featured[0]).toMatchObject({
      query: null,
      sort: { field: 'RELEVANCE', direction: 'DESC' },
      first: 20,
    });
    // Ingen av de andre radene har spurt serveren ennå.
    expect(log.Search).toHaveLength(0);
    expect(screen.getAllByTestId('skeleton').length).toBeGreaterThan(0);

    const topMovies = screen.getByRole('heading', { name: 'Høyest rangerte filmer' });
    io.reveal(topMovies.closest('section')!.parentElement!);
    await screen.findAllByRole('link', { name: 'Tittel 1' });
    expect(log.Search).toHaveLength(1);
    expect(log.Search[0]).toMatchObject({
      filters: { types: ['MOVIE'] },
      sort: { field: 'RATING', direction: 'DESC' },
      first: 20,
    });
  });

  it('har «Se alle»-lenker som setter filtre og sortering i URL-en', async () => {
    stubIntersectionObserver();
    const { user } = setup('/');
    await screen.findByRole('region', { name: 'Med bilde' });
    const link = screen.getByRole('link', { name: /Se alle i Høyest rangerte filmer/ });
    expect(link).toHaveAttribute('href', '/?types=film&sort=rating');
    await user.click(link);
    await waitFor(() => expect(currentUrl().search).toBe('?types=film&sort=rating'));
    // Nå er vi i søkemodus.
    expect(await screen.findByRole('status')).toBeInTheDocument();
  });

  it('feil i toppraden gir en feilmelding med «Prøv igjen» og ingen hero', async () => {
    stubIntersectionObserver();
    const log = emptyLog();
    renderApp(<HomePage />, {
      route: '/',
      mocks: buildMocks({}, log, [
        {
          request: { query: FEATURED_QUERY, variables: () => true },
          error: new Error('Failed to fetch'),
        },
      ]),
    });
    expect(await screen.findByRole('alert')).toHaveTextContent('Kunne ikke hente');
    expect(screen.getByRole('button', { name: 'Prøv igjen' })).toBeInTheDocument();
    expect(screen.queryByRole('region', { name: 'Med bilde' })).not.toBeInTheDocument();
  });
});
