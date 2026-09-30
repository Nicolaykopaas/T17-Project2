import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { GraphQLError } from 'graphql';
import { Route, Routes } from 'react-router';
import { describe, expect, it } from 'vitest';
import { TITLE_QUERY } from '../graphql/operations';
import type { Review } from '../graphql/types';
import {
  buildMocks,
  emptyLog,
  makeDetails,
  makeReview,
  makeReviewConnection,
  renderApp,
  type CallLog,
  type Vars,
} from '../test/utils';
import TitlePage from './TitlePage';

function setup(
  handlers: Parameters<typeof buildMocks>[0],
  before: Parameters<typeof buildMocks>[2] = [],
  log: CallLog = emptyLog(),
) {
  renderApp(
    <Routes>
      <Route path="/title/:id" element={<TitlePage />} />
    </Routes>,
    { route: '/title/tt0000001', mocks: buildMocks(handlers, log, before) },
  );
  return { log, user: userEvent.setup() };
}

describe('TitlePage', () => {
  it('viser all info om tittelen', async () => {
    setup({
      TitleDetails: () => ({
        title: makeDetails({
          primaryTitle: 'Rita',
          originalTitle: 'Rita (original)',
          startYear: 2012,
          endYear: 2020,
          type: 'SERIES',
          runtimeMinutes: 45,
          genres: ['Drama', 'Comedy'],
          averageRating: 7.9,
          numVotes: 12345,
        }),
      }),
    });
    expect(await screen.findByRole('heading', { level: 1, name: 'Rita' })).toBeInTheDocument();
    expect(screen.getAllByRole('heading', { level: 1 })).toHaveLength(1);
    expect(screen.getByText('Originaltittel: Rita (original)')).toBeInTheDocument();
    expect(screen.getByText('Serie')).toBeInTheDocument();
    expect(screen.getByText('2012–2020')).toBeInTheDocument();
    expect(screen.getByText('45 min')).toBeInTheDocument();
    expect(screen.getByText('Drama, Comedy')).toBeInTheDocument();
    expect(screen.getByText(/7,9 \/ 10/).textContent?.replace(/\s/g, ' ')).toContain(
      '12 345 stemmer',
    );
    await waitFor(() => expect(document.title).toBe('Rita – Filmsøk'));
  });

  it('viser lasteskjelett først', () => {
    setup({ TitleDetails: () => ({ title: makeDetails() }) });
    expect(screen.getByRole('heading', { level: 1, name: 'Laster …' })).toBeInTheDocument();
  });

  it('viser 404-tilstand når tittelen ikke finnes (null)', async () => {
    setup({ TitleDetails: () => ({ title: null }) });
    expect(
      await screen.findByRole('heading', { level: 1, name: 'Fant ikke tittelen' }),
    ).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Tilbake til søket' })).toHaveAttribute('href', '/');
  });

  it('viser 404-tilstand for NOT_FOUND-feil fra serveren', async () => {
    setup({}, [
      {
        request: { query: TITLE_QUERY, variables: () => true },
        result: { errors: [new GraphQLError('Not found', { extensions: { code: 'NOT_FOUND' } })] },
      },
    ]);
    expect(await screen.findByRole('heading', { name: 'Fant ikke tittelen' })).toBeInTheDocument();
  });

  it('viser feil med «Prøv igjen» ved nettverksfeil', async () => {
    const { user } = setup({ TitleDetails: () => ({ title: makeDetails() }) }, [
      {
        request: { query: TITLE_QUERY, variables: () => true },
        maxUsageCount: 1,
        error: new Error('Failed to fetch'),
      },
    ]);
    expect(await screen.findByRole('alert')).toHaveTextContent('Kunne ikke hente tittelen');
    await user.click(screen.getByRole('button', { name: 'Prøv igjen' }));
    expect(
      await screen.findByRole('heading', { name: 'The Shawshank Redemption' }),
    ).toBeInTheDocument();
  });
});

describe('TitlePage: Min liste', () => {
  it('bytter mellom «Legg i min liste» og «Fjern fra min liste» med aria-pressed', async () => {
    let inList = false;
    const { user, log } = setup({
      TitleDetails: () => ({ title: makeDetails({ inMyList: inList }) }),
      ToggleList: () => {
        inList = !inList;
        return { toggleList: { __typename: 'Title', id: 'tt0000001', inMyList: inList } };
      },
    });
    const add = await screen.findByRole('button', { name: 'Legg i min liste' });
    expect(add).toHaveAttribute('aria-pressed', 'false');

    await user.click(add);
    const remove = await screen.findByRole('button', { name: 'Fjern fra min liste' });
    expect(remove).toHaveAttribute('aria-pressed', 'true');
    expect(log.ToggleList).toEqual([{ titleId: 'tt0000001' }]);
    expect(screen.getByText('Lagt til i min liste.')).toBeInTheDocument();

    await user.click(remove);
    expect(await screen.findByRole('button', { name: 'Legg i min liste' })).toHaveAttribute(
      'aria-pressed',
      'false',
    );
    expect(screen.getByText('Fjernet fra min liste.')).toBeInTheDocument();
  });

  it('viser feilmelding og beholder tilstanden når oppdateringen feiler', async () => {
    const { user } = setup({ TitleDetails: () => ({ title: makeDetails() }) }, [
      {
        request: { query: TITLE_QUERY, variables: () => false },
        error: new Error('unused'),
      },
    ]);
    // Ingen ToggleList-mock finnes, så mutasjonen feiler som ved nettverksbrudd.
    await user.click(await screen.findByRole('button', { name: 'Legg i min liste' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('Kunne ikke oppdatere listen');
    expect(screen.getByRole('button', { name: 'Legg i min liste' })).toHaveAttribute(
      'aria-pressed',
      'false',
    );
  });
});

describe('TitlePage: anmeldelser', () => {
  const many: Review[] = Array.from({ length: 12 }, (_, i) => makeReview(i + 1));

  it('viser snitt og antall anmeldelser', async () => {
    setup({
      TitleDetails: () => ({
        title: makeDetails({
          userRating: 4.25,
          reviewCount: 4,
          reviews: makeReviewConnection([makeReview(1, { isMine: true })], 4),
        }),
      }),
    });
    expect(await screen.findByText(/Snitt fra brukere/)).toHaveTextContent(
      '4,3 av 5 (4 anmeldelser)',
    );
    expect(screen.getByText('Din anmeldelse')).toBeInTheDocument();
  });

  it('viser tom tilstand uten anmeldelser', async () => {
    setup({ TitleDetails: () => ({ title: makeDetails() }) });
    expect(await screen.findByText('Ingen brukeranmeldelser ennå.')).toBeInTheDocument();
    expect(screen.getByText(/Ingen anmeldelser ennå/)).toBeInTheDocument();
  });

  it('paginerer med «Vis flere»', async () => {
    const { user, log } = setup({
      TitleDetails: (vars: Vars) =>
        vars.after
          ? {
              title: makeDetails({
                reviewCount: 12,
                reviews: makeReviewConnection(many.slice(10), 12, false),
              }),
            }
          : {
              title: makeDetails({
                reviewCount: 12,
                reviews: makeReviewConnection(many.slice(0, 10), 12, true),
              }),
            },
    });
    await screen.findByText('Anmelder 1');
    expect(screen.getByText('Anmelder 10')).toBeInTheDocument();
    expect(screen.queryByText('Anmelder 11')).not.toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Vis flere' }));
    expect(await screen.findByText('Anmelder 12')).toBeInTheDocument();
    expect(screen.getByText('Anmelder 1')).toBeInTheDocument();
    expect(log.TitleDetails.at(-1)).toMatchObject({ after: 'rc-r10' });
    expect(screen.queryByRole('button', { name: 'Vis flere' })).not.toBeInTheDocument();
  });

  it('viser ny anmeldelse øverst uten omlasting, med oppdatert snitt', async () => {
    let reviews: Review[] = [makeReview(1, { author: 'Gammel' })];
    const { user } = setup({
      TitleDetails: () => ({
        title: makeDetails({
          reviewCount: reviews.length,
          userRating: reviews.reduce((s, r) => s + r.rating, 0) / reviews.length,
          reviews: makeReviewConnection(reviews),
        }),
      }),
      AddReview: (vars) => {
        const review = makeReview(2, { ...(vars.input as object), isMine: true });
        reviews = [review, ...reviews];
        return { addReview: review };
      },
    });
    await screen.findByText('Gammel');

    await user.type(screen.getByLabelText('Navn'), 'Nyansatt');
    await user.click(screen.getByRole('radio', { name: '2 stjerner' }));
    await user.type(screen.getByLabelText(/Anmeldelse \(valgfritt\)/), 'Så som så');
    await user.click(screen.getByRole('button', { name: 'Send anmeldelse' }));

    await screen.findByText('Takk! Anmeldelsen din er lagt til.');
    const items = await screen.findAllByRole('article');
    await waitFor(() => expect(screen.getAllByRole('article')[0]).toHaveTextContent('Nyansatt'));
    expect(items.length).toBeGreaterThan(0);
    const list = screen.getAllByRole('list').find((l) => within(l).queryByText('Gammel'))!;
    const authors = within(list)
      .getAllByRole('listitem')
      .map((li) => li.querySelector('strong')?.textContent);
    expect(authors).toEqual(['Nyansatt', 'Gammel']);
    expect(screen.getByText(/Snitt fra brukere/)).toHaveTextContent('3,0 av 5 (2 anmeldelser)');
  });

  it('viser anmeldelsestekst som ren tekst (ingen HTML-injeksjon)', async () => {
    setup({
      TitleDetails: () => ({
        title: makeDetails({
          reviewCount: 1,
          reviews: makeReviewConnection([makeReview(1, { text: '<img src=x onerror=alert(1)>' })]),
        }),
      }),
    });
    expect(await screen.findByText('<img src=x onerror=alert(1)>')).toBeInTheDocument();
    expect(document.querySelector('img')).toBeNull();
  });
});
