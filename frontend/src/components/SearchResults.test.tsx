import { useState } from 'react';
import { act, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { GraphQLError } from 'graphql';
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

  it('laster de første plakatene eager (den første med høy prioritet) og resten lazy', async () => {
    const titles = Array.from({ length: 8 }, (_, i) =>
      makeTitle(i + 1, { poster342: `http://img/${i + 1}.jpg` }),
    );
    renderApp(<SearchResults state={EMPTY_STATE} onReset={noop} />, {
      mocks: buildMocks({ Search: () => ({ search: makeConnection(titles, 8) }) }, emptyLog()),
    });
    await screen.findByRole('link', { name: 'Tittel 1' });
    const imgs = [...document.querySelectorAll('img')];
    expect(imgs.map((img) => img.getAttribute('loading'))).toEqual([
      ...Array<string>(6).fill('eager'),
      'lazy',
      'lazy',
    ]);
    expect(imgs[0]).toHaveAttribute('fetchpriority', 'high');
    expect(imgs[1]).not.toHaveAttribute('fetchpriority');
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
    expect(screen.getByText('Ingen rating')).toBeInTheDocument();
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

describe('SearchResults: fokus og pagineringsfeil', () => {
  it('«Last flere» beholder fokus og avvises mens den laster (aria-disabled, ikke disabled)', async () => {
    const user = userEvent.setup();
    const log = emptyLog();
    const mocks = buildMocks({ Search: paged }, log);
    for (const m of mocks) m.delay = (op) => (op.variables.after ? 100 : 0);
    renderApp(<SearchResults state={EMPTY_STATE} onReset={noop} />, { mocks });
    await screen.findByRole('link', { name: 'Tittel 1' });
    const button = screen.getByRole('button', { name: 'Last flere' });
    await user.click(button);
    const busy = screen.getByRole('button', { name: 'Laster …' });
    expect(busy).toBe(button);
    expect(busy).toHaveAttribute('aria-disabled', 'true');
    expect(busy).toHaveFocus();
    await user.click(busy);
    await screen.findByRole('link', { name: 'Tittel 5' });
    expect(log.Search.filter((v) => v.after)).toHaveLength(1);
  });

  it('flytter fokus til «Viser X av Y» når «Last flere» forsvinner på siste side', async () => {
    const user = userEvent.setup();
    renderApp(<SearchResults state={EMPTY_STATE} onReset={noop} />, {
      mocks: buildMocks({ Search: paged }, emptyLog()),
    });
    await screen.findByRole('link', { name: 'Tittel 1' });
    await user.click(screen.getByRole('button', { name: 'Last flere' }));
    await screen.findByRole('link', { name: 'Tittel 5' });
    expect(screen.queryByRole('button', { name: 'Last flere' })).not.toBeInTheDocument();
    const summary = screen.getByText(/Viser 5 av 5/);
    expect(summary).toHaveFocus();
    expect(summary).toHaveAttribute('tabindex', '-1');
  });

  it('stjeler ikke fokus når siste side kommer uten at knappen hadde fokus', async () => {
    const user = userEvent.setup();
    renderApp(
      <>
        <input aria-label="Annet felt" />
        <SearchResults state={EMPTY_STATE} onReset={noop} />
      </>,
      { mocks: buildMocks({ Search: paged }, emptyLog()) },
    );
    await screen.findByRole('link', { name: 'Tittel 1' });
    const button = screen.getByRole('button', { name: 'Last flere' });
    await user.click(button);
    // Brukeren flytter selv fokus videre mens neste side lastes inn.
    await act(async () => screen.getByLabelText('Annet felt').focus());
    await screen.findByRole('link', { name: 'Tittel 5' });
    expect(screen.getByLabelText('Annet felt')).toHaveFocus();
  });

  it('søk over 200 tegn gir en forståelig melding uten «Prøv igjen» (BAD_USER_INPUT)', async () => {
    renderApp(<SearchResults state={{ ...EMPTY_STATE, q: 'x'.repeat(201) }} onReset={noop} />, {
      mocks: [
        {
          request: { query: SEARCH_QUERY, variables: () => true },
          result: {
            errors: [
              new GraphQLError('query kan ikke være lengre enn 200 tegn.', {
                extensions: { code: 'BAD_USER_INPUT' },
              }),
            ],
          },
        },
      ],
    });
    const alert = await screen.findByRole('alert');
    expect(alert).toHaveTextContent('Søket kan ikke utføres');
    expect(alert).toHaveTextContent('200 tegn');
    expect(alert).not.toHaveTextContent('nettverket');
    expect(screen.queryByRole('button', { name: 'Prøv igjen' })).not.toBeInTheDocument();
  });

  /** Bytter søk uten å remounte, slik som når URL-en endres på forsiden. */
  function Switchable({ second }: { second: string }) {
    const [q, setQ] = useState('første');
    return (
      <>
        <button type="button" onClick={() => setQ(second)}>
          Bytt søk
        </button>
        <SearchResults state={{ ...EMPTY_STATE, q }} onReset={noop} />
      </>
    );
  }
  const otherPage = Array.from({ length: 3 }, (_, i) => makeTitle(i + 11));
  const byQuery = (vars: Vars) =>
    vars.query === 'andre' ? { search: makeConnection(otherPage, 9, true) } : paged(vars);

  it('«Kunne ikke laste flere» blir ikke stående når søket endres', async () => {
    const user = userEvent.setup();
    const log = emptyLog();
    const failOnce = {
      request: { query: SEARCH_QUERY, variables: (v: Vars) => v.after === 'cursor-tt0000003' },
      error: new Error('Network down'),
    };
    renderApp(<Switchable second="andre" />, {
      mocks: buildMocks({ Search: byQuery }, log, [failOnce]),
    });
    await screen.findByRole('link', { name: 'Tittel 1' });
    await user.click(screen.getByRole('button', { name: 'Last flere' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('Kunne ikke laste flere');

    await user.click(screen.getByRole('button', { name: 'Bytt søk' }));
    await screen.findByRole('link', { name: 'Tittel 11' });
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
    // ...og det nye søket kan paginere videre med sin egen cursor.
    await user.click(screen.getByRole('button', { name: 'Last flere' }));
    await waitFor(() =>
      expect(log.Search.at(-1)).toMatchObject({ query: 'andre', after: 'cursor-tt0000013' }),
    );
  });

  it('«Last flere» finnes ikke mens et nytt søk lastes, og gammel cursor brukes aldri med nye variabler', async () => {
    const user = userEvent.setup();
    const log = emptyLog();
    const mocks = buildMocks({ Search: byQuery }, log);
    for (const m of mocks) m.delay = (op) => (op.variables.query === 'andre' ? 150 : 0);
    renderApp(<Switchable second="andre" />, { mocks });
    await screen.findByRole('link', { name: 'Tittel 1' });
    await user.click(screen.getByRole('button', { name: 'Bytt søk' }));

    // De forrige treffene står (dempet) igjen, men uten knapp som kunne hentet «side 2» av feil søk.
    expect(screen.getByRole('link', { name: 'Tittel 1' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Last flere' })).not.toBeInTheDocument();
    await screen.findByRole('link', { name: 'Tittel 11' });
    expect(screen.getByRole('button', { name: 'Last flere' })).toBeInTheDocument();
    expect(log.Search.filter((v) => v.after)).toHaveLength(0);
  });
});
