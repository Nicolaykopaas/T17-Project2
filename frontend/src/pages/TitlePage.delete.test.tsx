import { screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { GraphQLError } from 'graphql';
import { Route, Routes } from 'react-router';
import { describe, expect, it } from 'vitest';
import {
  ADD_REVIEW_MUTATION,
  DELETE_REVIEW_MUTATION,
  TOGGLE_LIST_MUTATION,
} from '../graphql/operations';
import {
  buildMocks,
  emptyLog,
  makeDetails,
  makeReview,
  makeReviewConnection,
  renderApp,
  type Vars,
} from '../test/utils';
import TitlePage from './TitlePage';

const mine = makeReview(1, { isMine: true, author: 'Meg' });
const other = makeReview(2, { author: 'Andre' });

function setup(
  before: Parameters<typeof buildMocks>[2] = [],
  handlers: Parameters<typeof buildMocks>[0] = {},
) {
  const log = emptyLog();
  renderApp(
    <Routes>
      <Route path="/title/:id" element={<TitlePage />} />
    </Routes>,
    {
      route: '/title/tt0000001',
      mocks: buildMocks(
        {
          TitleDetails: () => ({
            title: makeDetails({
              userRating: 3,
              reviewCount: 2,
              reviews: makeReviewConnection([mine, other]),
            }),
          }),
          ...handlers,
        },
        log,
        before,
      ),
    },
  );
  return { log, user: userEvent.setup() };
}

const rateLimited = (query: unknown, seconds: number | undefined) => ({
  request: { query: query as never, variables: () => true },
  maxUsageCount: 1,
  result: {
    errors: [
      new GraphQLError('For mange forsøk.', {
        extensions: { code: 'RATE_LIMITED', retryAfterSeconds: seconds },
      }),
    ],
  },
});

describe('TitlePage: slett egen anmeldelse', () => {
  it('viser «Slett» bare på egne anmeldelser', async () => {
    setup();
    await screen.findByText('Andre');
    expect(screen.getAllByRole('button', { name: /^Slett/ })).toHaveLength(1);
    const own = screen.getByText('Meg').closest('article')!;
    expect(within(own).getByRole('button', { name: /^Slett/ })).toBeInTheDocument();
  });

  it('krever bekreftelse, fjerner anmeldelsen, oppdaterer snitt og flytter fokus', async () => {
    const { log, user } = setup([], {
      DeleteReview: (vars: Vars) => ({
        deleteReview: {
          __typename: 'DeleteReviewPayload',
          deletedId: vars.id,
          title: { __typename: 'Title', id: 'tt0000001', userRating: 4, reviewCount: 1 },
        },
      }),
    });
    await user.click(await screen.findByRole('button', { name: /^Slett/ }));
    // Første trykk sletter ikke; fokus flyttes til bekreftelsen.
    expect(log.DeleteReview).toHaveLength(0);
    const confirm = screen.getByRole('button', { name: 'Bekreft sletting' });
    expect(confirm).toHaveFocus();
    expect(screen.getByRole('button', { name: 'Avbryt' })).toBeInTheDocument();

    await user.click(confirm);
    await screen.findByText('Anmeldelsen er slettet.');
    expect(log.DeleteReview).toEqual([{ id: 'r1' }]);
    expect(screen.queryByText('Meg')).not.toBeInTheDocument();
    expect(screen.getByText('Andre')).toBeInTheDocument();
    expect(screen.getByRole('heading', { level: 2, name: 'Anmeldelser' })).toHaveFocus();
    // Snitt og antall kommer fra payloaden, uten ny henting av tittelen.
    expect(screen.getByText(/1 anmeldelse\)/)).toBeInTheDocument();
    expect(screen.getByText('4,0')).toBeInTheDocument();
    expect(log.TitleDetails).toHaveLength(1);
  });

  it('«Avbryt» sletter ikke og gir fokus tilbake til «Slett»', async () => {
    const { log, user } = setup();
    await user.click(await screen.findByRole('button', { name: /^Slett/ }));
    await user.click(screen.getByRole('button', { name: 'Avbryt' }));
    expect(log.DeleteReview).toHaveLength(0);
    expect(screen.getByRole('button', { name: /^Slett/ })).toHaveFocus();
    expect(screen.getByText('Meg')).toBeInTheDocument();
  });

  it('kan betjenes med tastatur', async () => {
    const { log, user } = setup();
    const start = await screen.findByRole('button', { name: /^Slett/ });
    start.focus();
    await user.keyboard('{Enter}');
    // Tab fra bekreft-knappen går til «Avbryt» (to-trinns, ingen felle).
    expect(log.DeleteReview).toHaveLength(0);
    expect(screen.getByRole('button', { name: 'Bekreft sletting' })).toHaveFocus();
    await user.tab();
    expect(screen.getByRole('button', { name: 'Avbryt' })).toHaveFocus();
  });

  it('viser tydelig feil og beholder anmeldelsen når sletting feiler', async () => {
    const { user } = setup();
    // Ingen DeleteReview-mock: mutasjonen feiler som ved nettverksbrudd.
    await user.click(await screen.findByRole('button', { name: /^Slett/ }));
    await user.click(screen.getByRole('button', { name: 'Bekreft sletting' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('Kunne ikke slette anmeldelsen');
    expect(screen.getByText('Meg')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /^Slett/ })).toBeInTheDocument();
  });

  it('viser ventetid ved RATE_LIMITED', async () => {
    const { user } = setup([rateLimited(DELETE_REVIEW_MUTATION, 12)]);
    await user.click(await screen.findByRole('button', { name: /^Slett/ }));
    await user.click(screen.getByRole('button', { name: 'Bekreft sletting' }));
    expect(await screen.findByRole('alert')).toHaveTextContent(
      'For mange forsøk. Vent 12 sekunder og prøv igjen.',
    );
  });
});

describe('TitlePage: RATE_LIMITED på de andre mutasjonene', () => {
  it('listeknappen viser ventetid', async () => {
    const { user } = setup([rateLimited(TOGGLE_LIST_MUTATION, 1)]);
    await user.click(await screen.findByRole('button', { name: 'Legg i min liste' }));
    expect(await screen.findByRole('alert')).toHaveTextContent(
      'For mange forsøk. Vent 1 sekund og prøv igjen.',
    );
  });

  it('anmeldelsesskjemaet viser ventetid og beholder det brukeren skrev', async () => {
    const { user } = setup([rateLimited(ADD_REVIEW_MUTATION, 30)]);
    await user.type(await screen.findByLabelText('Navn'), 'Kari');
    await user.click(screen.getByRole('radio', { name: '4 stjerner' }));
    await user.click(screen.getByRole('button', { name: 'Send anmeldelse' }));
    expect(await screen.findByRole('alert')).toHaveTextContent(
      'For mange forsøk. Vent 30 sekunder og prøv igjen.',
    );
    expect(screen.getByLabelText('Navn')).toHaveValue('Kari');
  });

  it('faller tilbake til generell tekst uten retryAfterSeconds', async () => {
    const { user } = setup([rateLimited(TOGGLE_LIST_MUTATION, undefined)]);
    await user.click(await screen.findByRole('button', { name: 'Legg i min liste' }));
    expect(await screen.findByRole('alert')).toHaveTextContent(
      'For mange forsøk. Vent litt og prøv igjen.',
    );
  });
});
