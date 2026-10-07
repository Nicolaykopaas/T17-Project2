import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';
import { MY_LIST_QUERY } from '../graphql/operations';
import {
  buildMocks,
  emptyLog,
  makeConnection,
  makeTitle,
  renderApp,
  type Vars,
} from '../test/utils';
import MyListPage from './MyListPage';

describe('MyListPage', () => {
  it('viser titlene i lista med antall', async () => {
    renderApp(<MyListPage />, {
      mocks: buildMocks(
        { MyList: () => ({ myList: makeConnection([makeTitle(1), makeTitle(2)]) }) },
        emptyLog(),
      ),
    });
    expect(screen.getByRole('heading', { level: 1, name: 'Min liste' })).toBeInTheDocument();
    expect(await screen.findByRole('link', { name: 'Tittel 2' })).toBeInTheDocument();
    expect(screen.getByRole('status')).toHaveTextContent('2 titler');
  });

  it('viser plakatkort i et rutenett med fjern-knapp per kort', async () => {
    renderApp(<MyListPage />, {
      mocks: buildMocks(
        {
          MyList: () => ({
            myList: makeConnection([makeTitle(1, { poster342: 'http://img/1.jpg' }), makeTitle(2)]),
          }),
        },
        emptyLog(),
      ),
    });
    await screen.findByRole('link', { name: 'Tittel 1' });
    expect(screen.getAllByRole('article')).toHaveLength(2);
    expect(document.querySelector('ul.poster-grid')).not.toBeNull();
    expect(screen.getAllByRole('button', { name: /^Fjern/ })).toHaveLength(2);
  });

  it('viser tom tilstand med lenke til søk', async () => {
    renderApp(<MyListPage />, {
      mocks: buildMocks({ MyList: () => ({ myList: makeConnection([]) }) }, emptyLog()),
    });
    expect(await screen.findByText('Listen din er tom.')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Søk etter titler' })).toHaveAttribute('href', '/');
  });

  it('fjerner en tittel fra lista uten å hente den på nytt', async () => {
    const user = userEvent.setup();
    const log = emptyLog();
    renderApp(<MyListPage />, {
      mocks: buildMocks(
        {
          MyList: () => ({ myList: makeConnection([makeTitle(1), makeTitle(2)]) }),
          ToggleList: (vars) => ({
            toggleList: { __typename: 'Title', id: vars.titleId, inMyList: false },
          }),
        },
        log,
      ),
    });
    await screen.findByRole('link', { name: 'Tittel 1' });
    await user.click(screen.getByRole('button', { name: 'Fjern Tittel 1 fra listen' }));

    await waitFor(() =>
      expect(screen.queryByRole('link', { name: 'Tittel 1' })).not.toBeInTheDocument(),
    );
    expect(log.ToggleList).toEqual([{ titleId: 'tt0000001' }]);
    expect(screen.getByRole('status')).toHaveTextContent('Fjernet «Tittel 1» fra listen.');
    expect(screen.getByRole('link', { name: 'Tittel 2' })).toBeInTheDocument();
    expect(screen.getByRole('heading', { level: 1 })).toHaveFocus();
  });

  it('viser feil med «Prøv igjen»', async () => {
    const user = userEvent.setup();
    renderApp(<MyListPage />, {
      mocks: buildMocks(
        { MyList: () => ({ myList: makeConnection([makeTitle(1)]) }) },
        emptyLog(),
        [
          {
            request: { query: MY_LIST_QUERY, variables: () => true },
            maxUsageCount: 1,
            error: new Error('Failed to fetch'),
          },
        ],
      ),
    });
    expect(await screen.findByRole('alert')).toHaveTextContent('Kunne ikke hente listen');
    await user.click(screen.getByRole('button', { name: 'Prøv igjen' }));
    expect(await screen.findByRole('link', { name: 'Tittel 1' })).toBeInTheDocument();
  });
});

describe('MyListPage: fokus', () => {
  it('«Last flere» som fjernes etter siste side flytter fokus til overskriften', async () => {
    const user = userEvent.setup();
    const log = emptyLog();
    renderApp(<MyListPage />, {
      mocks: buildMocks(
        {
          MyList: (vars: Vars) => ({
            myList: vars.after
              ? makeConnection([makeTitle(2)], 2, false)
              : makeConnection([makeTitle(1)], 2, true),
          }),
        },
        log,
      ),
    });
    await screen.findByRole('link', { name: 'Tittel 1' });
    await user.click(screen.getByRole('button', { name: 'Last flere' }));
    await screen.findByRole('link', { name: 'Tittel 2' });
    expect(screen.queryByRole('button', { name: 'Last flere' })).not.toBeInTheDocument();
    expect(screen.getByRole('heading', { level: 1 })).toHaveFocus();
  });

  it('«Fjern» beholder fokus mens den jobber (aria-disabled) og hindrer dobbel forespørsel', async () => {
    const user = userEvent.setup();
    const log = emptyLog();
    const mocks = buildMocks(
      {
        MyList: () => ({ myList: makeConnection([makeTitle(1), makeTitle(2)]) }),
        ToggleList: (vars) => ({
          toggleList: { __typename: 'Title', id: vars.titleId, inMyList: false },
        }),
      },
      log,
    );
    for (const m of mocks) m.delay = 100;
    renderApp(<MyListPage />, { mocks });
    await screen.findByRole('link', { name: 'Tittel 1' });
    const button = screen.getByRole('button', { name: 'Fjern Tittel 1 fra listen' });
    await user.click(button);
    expect(button).toHaveAttribute('aria-disabled', 'true');
    expect(button).toHaveFocus();
    await user.click(button);
    await waitFor(() =>
      expect(screen.queryByRole('link', { name: 'Tittel 1' })).not.toBeInTheDocument(),
    );
    expect(log.ToggleList).toHaveLength(1);
  });
});

describe('MyListPage: feil', () => {
  it('feil ved «Last flere» gir egen melding, ikke «Kunne ikke fjerne»', async () => {
    const user = userEvent.setup();
    renderApp(<MyListPage />, {
      mocks: [
        {
          request: { query: MY_LIST_QUERY, variables: (v: Vars) => !v.after },
          maxUsageCount: Number.POSITIVE_INFINITY,
          result: { data: { myList: makeConnection([makeTitle(1)], 2, true) } },
        },
        // Neste side feiler som ved nettverksbrudd.
        {
          request: { query: MY_LIST_QUERY, variables: (v: Vars) => !!v.after },
          maxUsageCount: Number.POSITIVE_INFINITY,
          error: new Error('Failed to fetch'),
        },
      ],
    });
    await screen.findByRole('link', { name: 'Tittel 1' });
    await user.click(screen.getByRole('button', { name: 'Last flere' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('Kunne ikke hente flere titler');
    expect(screen.queryByText(/Kunne ikke fjerne/)).not.toBeInTheDocument();
    // Knappen er brukbar igjen så brukeren kan prøve på nytt.
    expect(screen.getByRole('button', { name: 'Last flere' })).toBeEnabled();
  });

  it('feil ved «Fjern» gir fortsatt «Kunne ikke fjerne tittelen»', async () => {
    const user = userEvent.setup();
    // Ingen ToggleList-mock: mutasjonen feiler.
    renderApp(<MyListPage />, {
      mocks: buildMocks({ MyList: () => ({ myList: makeConnection([makeTitle(1)]) }) }, emptyLog()),
    });
    await screen.findByRole('link', { name: 'Tittel 1' });
    await user.click(screen.getByRole('button', { name: 'Fjern Tittel 1 fra listen' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('Kunne ikke fjerne tittelen');
  });
});
