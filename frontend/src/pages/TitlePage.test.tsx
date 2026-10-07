import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { GraphQLError } from 'graphql';
import { Route, Routes } from 'react-router';
import { afterEach, describe, expect, it } from 'vitest';
import { apiUnavailable } from '../apollo/apiStatus';
import { TITLE_QUERY } from '../graphql/operations';
import type { Review } from '../graphql/types';
import {
  buildMocks,
  emptyLog,
  makeDetails,
  makeReview,
  makeReviewConnection,
  makeStream,
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
  const { unmount } = renderApp(
    <Routes>
      <Route path="/title/:id" element={<TitlePage />} />
    </Routes>,
    { route: '/title/tt0000001', mocks: buildMocks(handlers, log, before) },
  );
  return { log, unmount, user: userEvent.setup() };
}

afterEach(() => void apiUnavailable(false));

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
    const genres = screen.getByRole('list', { name: 'Sjangre' });
    expect(
      within(genres)
        .getAllByRole('listitem')
        .map((li) => li.textContent),
    ).toEqual(['Drama', 'Comedy']);
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

describe('TitlePage: bilder', () => {
  it('viser bakgrunn (høy prioritet), plakat og handling fra TMDB', async () => {
    setup({
      TitleDetails: () => ({
        title: makeDetails({
          overview: 'To fanger blir venner.',
          poster342: 'http://img/p342.jpg',
          poster500: 'http://img/p500.jpg',
          backdrop780: 'http://img/b780.jpg',
          backdrop1280: 'http://img/b1280.jpg',
        }),
      }),
    });
    expect(await screen.findByText('To fanger blir venner.')).toBeInTheDocument();
    const [backdrop, poster] = Array.from(document.querySelectorAll('img'));
    expect(backdrop).toHaveAttribute('fetchpriority', 'high');
    expect(backdrop).toHaveAttribute(
      'srcset',
      'http://img/b780.jpg 780w, http://img/b1280.jpg 1280w',
    );
    expect(poster).toHaveAttribute('srcset', 'http://img/p342.jpg 342w, http://img/p500.jpg 500w');
    expect(document.querySelectorAll('img[alt=""]')).toHaveLength(2);
    // Headeren blir gjennomsiktig over heltebildet mens siden er åpen.
    expect(document.documentElement).toHaveAttribute('data-hero');
  });

  it('faller pent tilbake til plassholder uten bilder og uten handling', async () => {
    setup({ TitleDetails: () => ({ title: makeDetails() }) });
    await screen.findByRole('heading', { level: 1, name: 'The Shawshank Redemption' });
    expect(document.querySelector('img')).toBeNull();
    expect(document.querySelector('.poster__placeholder')).not.toBeNull();
    expect(document.querySelector('.title-hero__overview')).toBeNull();
  });

  it('fjerner hero-markeringen når man forlater siden', async () => {
    const { unmount } = setup({ TitleDetails: () => ({ title: makeDetails() }) });
    await screen.findByRole('heading', { level: 1, name: 'The Shawshank Redemption' });
    expect(document.documentElement).toHaveAttribute('data-hero');
    unmount();
    expect(document.documentElement).not.toHaveAttribute('data-hero');
  });
});

describe('TitlePage: Min liste', () => {
  it('bytter mellom «Legg i min liste» og «Fjern fra min liste» uten aria-pressed', async () => {
    let inList = false;
    const { user, log } = setup({
      TitleDetails: () => ({ title: makeDetails({ inMyList: inList }) }),
      ToggleList: () => {
        inList = !inList;
        return { toggleList: { __typename: 'Title', id: 'tt0000001', inMyList: inList } };
      },
    });
    const add = await screen.findByRole('button', { name: 'Legg i min liste' });
    // Dynamisk etikett uten aria-pressed, ellers leses «Fjern fra min liste, trykket» opp.
    expect(add).not.toHaveAttribute('aria-pressed');

    await user.click(add);
    const remove = await screen.findByRole('button', { name: 'Fjern fra min liste' });
    expect(remove).not.toHaveAttribute('aria-pressed');
    expect(log.ToggleList).toEqual([{ titleId: 'tt0000001' }]);
    expect(screen.getByText('Lagt til i min liste.')).toBeInTheDocument();

    await user.click(remove);
    expect(await screen.findByRole('button', { name: 'Legg i min liste' })).toBeInTheDocument();
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
    expect(screen.getByRole('button', { name: 'Legg i min liste' })).toBeInTheDocument();
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
    // Knappen hadde fokus og er borte; fokus skal ikke falle til body.
    expect(screen.getByRole('heading', { level: 2, name: 'Anmeldelser' })).toHaveFocus();
  });

  it('«Vis flere» beholder fokus og sender ikke to forespørsler mens den laster', async () => {
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
    const button = screen.getByRole('button', { name: 'Vis flere' });
    await user.click(button);
    // aria-disabled, ikke disabled: ellers mister knappen fokus i Chrome mens den laster.
    expect(screen.getByRole('button', { name: 'Laster …' })).toHaveAttribute(
      'aria-disabled',
      'true',
    );
    expect(button).toHaveFocus();
    await user.click(button);
    await screen.findByText('Anmelder 12');
    expect(log.TitleDetails.filter((v) => v.after)).toHaveLength(1);
  });

  describe.each([
    { down: false, role: 'alert' },
    { down: true, role: null },
  ])('når «Vis flere» feiler (API-banner: $down)', ({ down, role }) => {
    it(`${role ? 'kunngjør feilen' : 'overlater kunngjøringen til banneret'}`, async () => {
      apiUnavailable(down);
      const { user } = setup(
        {
          TitleDetails: () => ({
            title: makeDetails({
              reviewCount: 12,
              reviews: makeReviewConnection(many.slice(0, 10), 12, true),
            }),
          }),
        },
        [
          {
            request: { query: TITLE_QUERY, variables: (v: Vars) => v.after != null },
            result: { errors: [new GraphQLError('Feil')] },
          },
        ],
      );
      await screen.findByText('Anmelder 1');
      await user.click(screen.getByRole('button', { name: 'Vis flere' }));
      const msg = await screen.findByText('Kunne ikke laste flere anmeldelser.');
      if (role) expect(msg).toHaveAttribute('role', 'alert');
      else expect(msg).not.toHaveAttribute('role');
    });
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

describe('TitlePage: gratisversjon', () => {
  it('viser «Se filmen» som primærlenke til spilleren, med lisens og kilde', async () => {
    setup({
      TitleDetails: () => ({
        title: makeDetails({ stream: makeStream({ license: 'CC BY 4.0' }) }),
      }),
    });
    const watch = await screen.findByRole('link', { name: /Se filmen/ });
    expect(watch).toHaveAttribute('href', '/watch/tt0000001');
    expect(watch).toHaveClass('btn--primary');
    const license = screen.getByRole('link', { name: /CC BY 4\.0/ });
    expect(license).toHaveAttribute('href', 'https://creativecommons.org/publicdomain/mark/1.0/');
    const source = screen.getByRole('link', { name: /Internet Archive/ });
    expect(source).toHaveAttribute('href', 'https://archive.example/details/film');
    expect(source).toHaveAttribute('rel', expect.stringContaining('noopener'));
    expect(screen.getByText(/Kilde:/)).toBeInTheDocument();
  });

  it('viser lisensen som ren tekst når den ikke har lenke', async () => {
    setup({
      TitleDetails: () => ({
        title: makeDetails({ stream: makeStream({ licenseUrl: null, license: 'Public Domain' }) }),
      }),
    });
    await screen.findByRole('link', { name: /Se filmen/ });
    expect(screen.getByText('Public Domain')).toBeInTheDocument();
    expect(screen.queryByRole('link', { name: /Public Domain/ })).not.toBeInTheDocument();
  });

  it('har ingen «Se filmen» eller lisens uten stream', async () => {
    setup({ TitleDetails: () => ({ title: makeDetails() }) });
    await screen.findByRole('heading', { level: 1, name: 'The Shawshank Redemption' });
    expect(screen.queryByRole('link', { name: /Se filmen/ })).not.toBeInTheDocument();
    expect(screen.queryByText(/Lisens:/)).not.toBeInTheDocument();
  });
});
