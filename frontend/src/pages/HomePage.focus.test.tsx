import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';
import { HeaderSearch } from '../components/HeaderSearch';
import {
  FACETS,
  GENRE_LIST,
  buildMocks,
  emptyLog,
  makeConnection,
  makeFeatured,
  makeTitle,
  renderApp,
  type Vars,
} from '../test/utils';
import HomePage from './HomePage';

/**
 * Fokus må aldri falle til <body> når kontrollen man brukte forsvinner. Det er nettopp det som
 * skjer når et filter fjernes (chipen er borte) eller siste filter gjør at hele treffvisningen byttes ut.
 */
function setup(route: string, searchHandler?: (v: Vars) => unknown) {
  const log = emptyLog();
  const utils = renderApp(
    // main finnes i Layout i appen; her stiller vi det opp selv slik at `main h1` kan finnes.
    <>
      <HeaderSearch />
      <main>
        <HomePage />
      </main>
    </>,
    {
      route,
      mocks: buildMocks(
        {
          Featured: () => ({ search: makeConnection([makeFeatured(1)], 20, true) }),
          Search:
            searchHandler ?? (() => ({ search: makeConnection([makeTitle(1), makeTitle(2)]) })),
          Row: () => ({ search: makeConnection([makeTitle(3)]) }),
          Facets: () => ({ facets: FACETS }),
          Genres: () => ({ genres: GENRE_LIST }),
        },
        log,
      ),
    },
  );
  return { log, user: userEvent.setup(), ...utils };
}

const chips = () => screen.getByRole('list', { name: 'Aktive filtre' });
const chip = (name: RegExp) => within(chips()).getByRole('button', { name });
const resultsHeading = () => document.getElementById('results-heading');

describe('HomePage: fokus når kontroller forsvinner', () => {
  it('fjerner man en chip, går fokus til neste chip', async () => {
    const { user } = setup('/?genres=Action,Drama&types=film');
    await screen.findByRole('link', { name: 'Tittel 1' });
    await user.click(chip(/Action/));
    await waitFor(() => expect(chip(/Drama/)).toHaveFocus());
  });

  it('fjerner man siste chip i lista, går fokus til forrige', async () => {
    const { user } = setup('/?genres=Action,Drama');
    await screen.findByRole('link', { name: 'Tittel 1' });
    await user.click(chip(/Drama/));
    await waitFor(() => expect(chip(/Action/)).toHaveFocus());
  });

  it('fjerner man eneste chip mens søketekst står igjen, går fokus til resultatoverskriften', async () => {
    const { user } = setup('/?q=alien&genres=Action');
    await screen.findByRole('link', { name: 'Tittel 1' });
    await user.click(chip(/Action/));
    await waitFor(() => expect(screen.queryByRole('list', { name: 'Aktive filtre' })).toBeNull());
    expect(resultsHeading()).toHaveFocus();
    expect(resultsHeading()).toHaveAttribute('tabindex', '-1');
  });

  it('«Nullstill alle» flytter fokus til resultatoverskriften', async () => {
    const { user } = setup('/?q=alien&genres=Action,Drama&types=film');
    await screen.findByRole('link', { name: 'Tittel 1' });
    await user.click(screen.getByRole('button', { name: 'Nullstill alle' }));
    await waitFor(() => expect(resultsHeading()).toHaveFocus());
  });

  it('«Fjern alle filtre» (ingen treff) flytter fokus til resultatoverskriften', async () => {
    const { user } = setup('/?q=zzzz&genres=Action', () => ({ search: makeConnection([]) }));
    await user.click(await screen.findByRole('button', { name: 'Fjern alle filtre' }));
    await waitFor(() => expect(resultsHeading()).toHaveFocus());
  });

  it('når siste filter fjernes og visningen byttes til bla-modus, får h1 fokus', async () => {
    const { user } = setup('/?genres=Action');
    await screen.findByRole('link', { name: 'Tittel 1' });
    await user.click(chip(/Action/));
    const h1 = await screen.findByRole('heading', { level: 1 });
    await waitFor(() => expect(h1).toHaveFocus());
    // Bla-modus: ingen filterpanel lenger.
    expect(screen.queryByRole('complementary', { name: 'Filtre' })).toBeNull();
  });

  it('samme gjelder når siste filter fjernes via avkrysningsboksen i filterpanelet', async () => {
    const { user } = setup('/?genres=Action');
    await user.click(await screen.findByRole('checkbox', { name: /Action/ }));
    const h1 = await screen.findByRole('heading', { level: 1 });
    await waitFor(() => expect(h1).toHaveFocus());
  });

  it('stjeler ikke fokus fra søkefeltet når tøm-knappen tar oss tilbake til bla-modus', async () => {
    const { user } = setup('/?q=alien');
    await screen.findByRole('link', { name: 'Tittel 1' });
    await user.click(screen.getByRole('button', { name: 'Tøm søkefeltet' }));
    await screen.findByRole('heading', { level: 1 });
    await waitFor(() => expect(screen.getByLabelText('Søk etter tittel')).toHaveFocus());
  });
});
