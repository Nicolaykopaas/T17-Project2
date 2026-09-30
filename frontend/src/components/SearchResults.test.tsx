import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';
import { SEARCH_QUERY } from '../graphql/operations';
import { EMPTY_STATE } from '../lib/searchState';
import {
  buildMocks,
  emptyLog,
  makeConnection,
  makeTitle,
  renderApp,
  type Vars,
} from '../test/utils';
import { SearchResults } from './SearchResults';

const page1 = Array.from({ length: 3 }, (_, i) => makeTitle(i + 1));
const page2 = Array.from({ length: 2 }, (_, i) => makeTitle(i + 4));

function paged(vars: Vars) {
  return {
    search: vars.after ? makeConnection(page2, 5, false) : makeConnection(page1, 5, true),
  };
}

const noop = () => undefined;

describe('SearchResults', () => {
  it('viser skjelett med aria-busy mens data lastes, deretter titler og antall treff', async () => {
    const log = emptyLog();
    renderApp(<SearchResults state={EMPTY_STATE} onReset={noop} />, {
      mocks: buildMocks({ Search: paged }, log),
    });
    expect(screen.getByTestId('skeleton')).toBeInTheDocument();
    expect(screen.getByRole('status')).toHaveTextContent('Søker');
    expect(screen.getByRole('region', { name: 'Søkeresultater', busy: true })).toBeInTheDocument();

    expect(await screen.findByRole('link', { name: 'Tittel 1' })).toBeInTheDocument();
    expect(screen.queryByTestId('skeleton')).not.toBeInTheDocument();
    expect(screen.getByRole('status')).toHaveTextContent('5 treff');
    expect(screen.getByRole('status')).toHaveAttribute('aria-live', 'polite');
    expect(screen.getByRole('region', { name: 'Søkeresultater', busy: false })).toBeInTheDocument();
  });

  it('viser tittel (som lenke til detaljsiden), år, type, sjangre, rating og stemmer', async () => {
    const title = makeTitle(7, {
      primaryTitle: 'Heat',
      startYear: 1995,
      genres: ['Action', 'Crime'],
      averageRating: 8.3,
      numVotes: 1234567,
    });
    renderApp(<SearchResults state={EMPTY_STATE} onReset={noop} />, {
      mocks: buildMocks({ Search: () => ({ search: makeConnection([title]) }) }, emptyLog()),
    });
    const link = await screen.findByRole('link', { name: 'Heat' });
    expect(link).toHaveAttribute('href', '/title/tt0000007');
    const card = link.closest('article')!;
    expect(within(card).getByText('1995')).toBeInTheDocument();
    expect(within(card).getByText('Film')).toBeInTheDocument();
    expect(within(card).getByText('Action')).toBeInTheDocument();
    expect(within(card).getByText('Crime')).toBeInTheDocument();
    expect(within(card).getByText('8,3')).toBeInTheDocument();
    expect(card.textContent?.replace(/\s/g, ' ')).toContain('1 234 567 stemmer');
  });

  it('formaterer store treffantall med tusenskille', async () => {
    renderApp(<SearchResults state={EMPTY_STATE} onReset={noop} />, {
      mocks: buildMocks(
        { Search: () => ({ search: makeConnection(page1, 1234, true) }) },
        emptyLog(),
      ),
    });
    await screen.findByRole('link', { name: 'Tittel 1' });
    expect(screen.getByRole('status').textContent?.replace(/\s/g, ' ')).toBe('1 234 treff');
  });

  it('tåler manglende år og rating', async () => {
    const title = makeTitle(1, { startYear: null, averageRating: null, genres: [] });
    renderApp(<SearchResults state={EMPTY_STATE} onReset={noop} />, {
      mocks: buildMocks({ Search: () => ({ search: makeConnection([title]) }) }, emptyLog()),
    });
    expect(await screen.findByText('Ukjent år')).toBeInTheDocument();
    expect(screen.getByText('Ingen IMDb-rating')).toBeInTheDocument();
  });

  it('«Last flere» henter neste side med cursor og legger den til under', async () => {
    const user = userEvent.setup();
    const log = emptyLog();
    renderApp(<SearchResults state={EMPTY_STATE} onReset={noop} />, {
      mocks: buildMocks({ Search: paged }, log),
    });
    await screen.findByRole('link', { name: 'Tittel 1' });
    expect(screen.getByText(/Viser 3 av 5/)).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Last flere' }));

    expect(await screen.findByRole('link', { name: 'Tittel 5' })).toBeInTheDocument();
    expect(screen.getAllByRole('link')).toHaveLength(5);
    expect(log.Search).toHaveLength(2);
    expect(log.Search[1]).toMatchObject({ after: 'cursor-tt0000003' });
    // Siste side er lastet: knappen forsvinner.
    expect(screen.queryByRole('button', { name: 'Last flere' })).not.toBeInTheDocument();
    expect(screen.getByText(/Viser 5 av 5/)).toBeInTheDocument();
  });

  it('viser feil når «Last flere» mislykkes, og lar brukeren prøve på nytt', async () => {
    const user = userEvent.setup();
    const log = emptyLog();
    const failOnce = {
      request: { query: SEARCH_QUERY, variables: (v: Vars) => v.after === 'cursor-tt0000003' },
      error: new Error('Network down'),
    };
    renderApp(<SearchResults state={EMPTY_STATE} onReset={noop} />, {
      mocks: buildMocks({ Search: paged }, log, [failOnce]),
    });
    await screen.findByRole('link', { name: 'Tittel 1' });
    await user.click(screen.getByRole('button', { name: 'Last flere' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('Kunne ikke laste flere');
    expect(screen.getAllByRole('link')).toHaveLength(3);

    await user.click(screen.getByRole('button', { name: 'Last flere' }));
    expect(await screen.findByRole('link', { name: 'Tittel 5' })).toBeInTheDocument();
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });

  it('viser ingen treff-tilstand uten filtre', async () => {
    renderApp(<SearchResults state={{ ...EMPTY_STATE, q: 'zzzz' }} onReset={noop} />, {
      mocks: buildMocks({ Search: () => ({ search: makeConnection([]) }) }, emptyLog()),
    });
    expect(await screen.findByText(/Ingen treff/, { selector: 'strong' })).toBeInTheDocument();
    expect(screen.getByRole('status')).toHaveTextContent('0 treff');
    expect(screen.queryByRole('button', { name: 'Fjern alle filtre' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Last flere' })).not.toBeInTheDocument();
  });

  it('foreslår å fjerne filtre når filtre gir ingen treff', async () => {
    const user = userEvent.setup();
    let resets = 0;
    renderApp(
      <SearchResults
        state={{ ...EMPTY_STATE, genres: ['Action'] }}
        onReset={() => {
          resets++;
        }}
      />,
      { mocks: buildMocks({ Search: () => ({ search: makeConnection([]) }) }, emptyLog()) },
    );
    expect(await screen.findByText(/fjerne noen av filtrene/)).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Fjern alle filtre' }));
    expect(resets).toBe(1);
  });

  it('viser feilmelding med «Prøv igjen» som henter på nytt', async () => {
    const user = userEvent.setup();
    const log = emptyLog();
    const failOnce = {
      request: { query: SEARCH_QUERY, variables: () => true },
      maxUsageCount: 1,
      error: new Error('Failed to fetch'),
    };
    renderApp(<SearchResults state={EMPTY_STATE} onReset={noop} />, {
      mocks: buildMocks({ Search: paged }, log, [failOnce]),
    });
    const alert = await screen.findByRole('alert');
    expect(alert).toHaveTextContent('Kunne ikke hente titler');

    await user.click(screen.getByRole('button', { name: 'Prøv igjen' }));
    expect(await screen.findByRole('link', { name: 'Tittel 1' })).toBeInTheDocument();
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });

  it('sender query, filtre og sortering som variabler (aldri filtrering på klienten)', async () => {
    const log = emptyLog();
    renderApp(
      <SearchResults
        state={{
          ...EMPTY_STATE,
          q: 'alien',
          genres: ['Horror'],
          decades: [1980],
          types: ['MOVIE'],
          minRating: 7,
          sort: 'RATING',
          dir: 'ASC',
        }}
        onReset={noop}
      />,
      { mocks: buildMocks({ Search: () => ({ search: makeConnection(page1) }) }, log) },
    );
    await screen.findByRole('link', { name: 'Tittel 1' });
    await waitFor(() => expect(log.Search).toHaveLength(1));
    expect(log.Search[0]).toEqual({
      query: 'alien',
      filters: { genres: ['Horror'], decades: [1980], types: ['MOVIE'], minRating: 7 },
      sort: { field: 'RATING', direction: 'ASC' },
      first: 20,
    });
  });
});
