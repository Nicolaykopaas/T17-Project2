import { useId, type CSSProperties } from 'react';
import { Link } from 'react-router';
import type { FeaturedTitle } from '../graphql/types';
import { useHeaderOverlay } from '../hooks/useHeaderOverlay';
import { formatRating, truncate, formatYears, hueFromId, typeLabel } from '../lib/format';
import { ListToggleButton } from './ListToggleButton';

/** Hero-banner. Bildet er sidens LCP-element, derfor `fetchpriority` og fast størrelse (ingen CLS). */
export function Hero({ title }: { title: FeaturedTitle }) {
  const headingId = useId();
  useHeaderOverlay();
  const src = title.backdrop1280 ?? title.backdrop780;
  const srcSet =
    title.backdrop780 && title.backdrop1280
      ? `${title.backdrop780} 780w, ${title.backdrop1280} 1280w`
      : undefined;

  return (
    <section
      className="hero"
      aria-labelledby={headingId}
      style={{ '--hue': hueFromId(title.id) } as CSSProperties}
    >
      <div className="hero__media" aria-hidden="true">
        {src && (
          <img
            src={src}
            srcSet={srcSet}
            sizes="100vw"
            alt=""
            width={1280}
            height={720}
            fetchPriority="high"
            decoding="async"
          />
        )}
      </div>
      <div className="hero__content container">
        <p className="hero__eyebrow">Mest populære nå</p>
        <h2 id={headingId} className="hero__title">
          {title.primaryTitle}
        </h2>
        <p className="hero__meta">
          {title.averageRating != null && (
            <span className="poster__rating">
              <span aria-hidden="true">★ </span>
              <strong>{formatRating(title.averageRating)}</strong>
              <span className="sr-only"> av 10 på IMDb</span>
            </span>
          )}
          <span>{formatYears(title)}</span>
          <span>{typeLabel(title.type)}</span>
        </p>
        {title.overview && <p className="hero__overview">{truncate(title.overview)}</p>}
        <div className="hero__actions">
          {title.stream && (
            <Link className="btn btn--primary" to={`/watch/${title.id}`}>
              <span aria-hidden="true">▶&nbsp;</span>Se filmen
              <span className="sr-only">: {title.primaryTitle}</span>
            </Link>
          )}
          <Link
            className={`btn ${title.stream ? 'btn--ghost' : 'btn--primary'}`}
            to={`/title/${title.id}`}
          >
            Se detaljer<span className="sr-only">: {title.primaryTitle}</span>
          </Link>
          <ListToggleButton titleId={title.id} inMyList={false} variant="secondary" />
        </div>
      </div>
    </section>
  );
}

/** Reserverer samme plass som Hero mens data hentes. */
export function HeroSkeleton() {
  useHeaderOverlay();
  return (
    <div className="hero hero--skeleton" aria-hidden="true">
      <div className="hero__content container">
        <div className="skeleton__line skeleton__line--title" />
        <div className="skeleton__line skeleton__line--short" />
      </div>
    </div>
  );
}
