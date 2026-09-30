import { screen, within } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { makeTitle, renderApp } from '../test/utils';
import { PosterCard, GRID_SIZES } from './PosterCard';

const withPoster = makeTitle(3, {
  primaryTitle: 'Heat',
  startYear: 1995,
  averageRating: 8.3,
  poster185: 'http://img/185.jpg',
  poster342: 'http://img/342.jpg',
});

const renderCard = (title = withPoster, sizes?: string) =>
  renderApp(
    <ul>
      <PosterCard title={title} sizes={sizes} />
    </ul>,
  );

describe('PosterCard', () => {
  it('har tittelen som eneste tilgjengelige navn på lenken', () => {
    renderCard();
    const link = screen.getByRole('link');
    expect(link).toHaveAccessibleName('Heat');
    expect(link).toHaveAttribute('href', '/title/tt0000003');
    expect(screen.getByRole('article')).toHaveAccessibleName('Heat');
  });

  it('viser plakat med srcset, sizes, lat lasting, mål og tom alt', () => {
    renderCard(withPoster, GRID_SIZES);
    const img = document.querySelector('img')!;
    expect(img).toHaveAttribute('alt', '');
    expect(img).toHaveAttribute('srcset', 'http://img/185.jpg 185w, http://img/342.jpg 342w');
    expect(img).toHaveAttribute('sizes', GRID_SIZES);
    expect(img).toHaveAttribute('loading', 'lazy');
    expect(img).toHaveAttribute('decoding', 'async');
    expect(img).toHaveAttribute('width', '185');
    expect(img).toHaveAttribute('height', '278');
    expect(img).toHaveAttribute('src', 'http://img/342.jpg');
  });

  it('viser rating, år og type slik at E2E kan lese ratingen ut av teksten', () => {
    renderCard();
    const card = screen.getByRole('article');
    expect(card.textContent).toMatch(/★\s*8,3/);
    expect(within(card).getByText('1995')).toBeInTheDocument();
    expect(within(card).getByText('Film')).toBeInTheDocument();
  });

  it('bruker en gradient-plassholder med tittelen når plakat mangler', () => {
    renderCard(makeTitle(4, { primaryTitle: 'Uten plakat' }));
    expect(document.querySelector('img')).toBeNull();
    const placeholder = document.querySelector<HTMLElement>('.poster__placeholder')!;
    expect(placeholder).toHaveTextContent('Uten plakat');
    // Tittelen leses ikke to ganger: plassholderen er skjult for hjelpemidler.
    expect(placeholder).toHaveAttribute('aria-hidden', 'true');
    expect(screen.getAllByText('Uten plakat')).toHaveLength(2);
  });

  it('gir samme farge for samme id og (nesten alltid) ulik farge for ulike id-er', () => {
    const hue = (n: number) => {
      const { unmount } = renderCard(makeTitle(n));
      const value = document
        .querySelector<HTMLElement>('.poster__placeholder')!
        .style.getPropertyValue('--hue');
      unmount();
      return value;
    };
    expect(hue(4)).toBe(hue(4));
    expect(new Set([1, 2, 3, 4, 5, 6].map(hue)).size).toBeGreaterThan(3);
  });

  it('tåler manglende rating og år, og veldig lange titler', () => {
    renderCard(
      makeTitle(5, {
        primaryTitle: 'Å'.repeat(300),
        averageRating: null,
        startYear: null,
        genres: [],
      }),
    );
    expect(screen.getByText('Ingen rating')).toBeInTheDocument();
    expect(screen.getByText('Ukjent år')).toBeInTheDocument();
  });
});

describe('PosterCard: overskriftsnivå', () => {
  it('bruker h3 som standard og h2 når siden ikke har noe h2 over kortene', () => {
    const { unmount } = renderApp(
      <ul>
        <PosterCard title={makeTitle(1)} />
      </ul>,
    );
    expect(screen.getByRole('heading', { level: 3 })).toBeInTheDocument();
    unmount();
    renderApp(
      <ul>
        <PosterCard title={makeTitle(1)} headingLevel={2} />
      </ul>,
    );
    expect(screen.getByRole('heading', { level: 2 })).toBeInTheDocument();
  });
});

describe('PosterCard: «Se nå»-merke', () => {
  it('viser «Se nå» som tekst når tittelen har stream', () => {
    renderCard(makeTitle(5, { primaryTitle: 'Gratis', stream: { url: 'http://x/v.mp4' } }));
    const card = screen.getByRole('article');
    expect(within(card).getByText('Se nå')).toBeVisible();
    // Kortets tilgjengelige navn er fortsatt bare tittelen.
    expect(card).toHaveAccessibleName('Gratis');
  });

  it('viser ikke merket uten stream', () => {
    renderCard();
    expect(screen.queryByText('Se nå')).not.toBeInTheDocument();
  });
});
