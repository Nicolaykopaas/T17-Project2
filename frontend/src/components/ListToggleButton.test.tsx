import { useApolloClient } from '@apollo/client/react';
import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';
import { MY_LIST_QUERY } from '../graphql/operations';
import { buildMocks, emptyLog, makeConnection, makeTitle, renderApp } from '../test/utils';
import { ListToggleButton } from './ListToggleButton';

/** Gjør klienten tilgjengelig for testen, slik at vi kan se hva mutasjonen gjør med cachen. */
function ClientProbe({ onClient }: { onClient: (c: ReturnType<typeof useApolloClient>) => void }) {
  onClient(useApolloClient());
  return null;
}

function setup(inMyList = false, delay = 0) {
  const log = emptyLog();
  const mocks = buildMocks(
    {
      ToggleList: (vars) => ({
        toggleList: { __typename: 'Title', id: vars.titleId, inMyList: !inMyList },
      }),
    },
    log,
  );
  if (delay) for (const m of mocks) m.delay = delay;
  let client!: ReturnType<typeof useApolloClient>;
  renderApp(
    <>
      <ClientProbe onClient={(c) => (client = c)} />
      <ListToggleButton titleId="tt0000001" inMyList={inMyList} />
    </>,
    { mocks },
  );
  return { log, client, user: userEvent.setup() };
}

describe('ListToggleButton', () => {
  it('kunngjør utfallet i statusregionen', async () => {
    const { user } = setup(false);
    await user.click(screen.getByRole('button', { name: 'Legg i min liste' }));
    await waitFor(() =>
      expect(screen.getByRole('status')).toHaveTextContent('Lagt til i min liste.'),
    );
  });

  it('beholder fokus og avviser nytt trykk mens mutasjonen pågår (aria-disabled, ikke disabled)', async () => {
    const { user, log } = setup(false, 100);
    const button = screen.getByRole('button', { name: 'Legg i min liste' });
    await user.click(button);
    expect(button).toHaveAttribute('aria-disabled', 'true');
    expect(button).not.toBeDisabled();
    expect(button).toHaveFocus();
    await user.click(button);
    await waitFor(() => expect(screen.getByRole('status')).toHaveTextContent('Lagt til'));
    expect(log.ToggleList).toHaveLength(1);
    expect(button).not.toHaveAttribute('aria-disabled');
  });

  it('kaster «Min liste» fra cachen, så den ikke viser gammelt innhold etter endringen', async () => {
    const { user, client } = setup(false);
    client.writeQuery({
      query: MY_LIST_QUERY,
      variables: { first: 20 },
      data: { myList: makeConnection([makeTitle(9)]) },
    });
    const listKeys = () => {
      const root = (client.cache.extract() as Record<string, object | undefined>).ROOT_QUERY;
      return Object.keys(root ?? {}).filter((k) => k.startsWith('myList'));
    };
    expect(listKeys()).not.toEqual([]);

    await user.click(screen.getByRole('button', { name: 'Legg i min liste' }));
    await waitFor(() => expect(screen.getByRole('status')).toHaveTextContent('Lagt til'));
    expect(listKeys()).toEqual([]);
  });

  it('viser feil når mutasjonen mislykkes, og knappen er brukbar igjen', async () => {
    // Ingen ToggleList-mock: mutasjonen feiler.
    renderApp(<ListToggleButton titleId="tt0000001" inMyList={false} />, { mocks: [] });
    const user = userEvent.setup();
    await user.click(screen.getByRole('button', { name: 'Legg i min liste' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('Kunne ikke oppdatere listen');
    expect(screen.getByRole('button', { name: 'Legg i min liste' })).not.toHaveAttribute(
      'aria-disabled',
    );
  });
});
