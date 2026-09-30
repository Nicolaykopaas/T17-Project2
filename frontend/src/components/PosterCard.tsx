import { useId, type CSSProperties, type ReactNode } from 'react';
import { Link } from 'react-router';
import type { TitleSummary } from '../graphql/types';
import { formatNumber, formatRating, formatYears, hueFromId, typeLabel } from '../lib/format';

interface Props {
  title: TitleSummary;
  /** Ekstra kontroller under kortet, f.eks. «Fjern» på Min liste. */
  actions?: ReactNode;
  /** Forteller nettleseren hvor bredt bildet vises, så den velger riktig srcset-kandidat. */
  sizes?: string;
  /** Overskriftsnivå må passe sidens struktur (Min liste har ingen h2 over kortene). */
  headingLevel?: 2 | 3;
}

// Kortene står i to sammenhenger: rader (fast bredde) og rutenett (flytende).
export const ROW_SIZES = '(min-width: 48rem) 11rem, 9rem';
export const GRID_SIZES = '(min-width: 64rem) 12rem, (min-width: 40rem) 30vw, 45vw';

/**
 * Tittelen er lenken, og lenken strekkes over hele kortet (CSS `::after`). Da er kortet
 * klikkbart uten at hele innholdet blir lenketekst for skjermlesere, og tastaturfokus
 * får én tydelig ramme rundt plakaten.
 */
export function PosterCard({ title, actions, sizes = ROW_SIZES, headingLevel = 3 }: Props) {
  // Samme tittel kan stå i flere rader på samme side, så id-en kan ikke bygge på tittel-id alene.
  const headingId = useId();
  const Heading = `h${headingLevel}` as const;
  const src = title.poster342 ?? title.poster185;
  const srcSet =
    title.poster185 && title.poster342
      ? `${title.poster185} 185w, ${title.poster342} 342w`
      : undefined;

  return (
    <li className="poster">
      <article className="poster__card" aria-labelledby={headingId}>
        <div className="poster__art">
          {src ? (
            // alt er tomt fordi tittelen står som tekst rett under; ellers leses den to ganger.
            <img
              src={src}
              srcSet={srcSet}
              sizes={srcSet ? sizes : undefined}
              alt=""
              width={185}
              height={278}
              loading="lazy"
              decoding="async"
            />
          ) : (
            <div
              className="poster__placeholder"
              aria-hidden="true"
              style={{ '--hue': hueFromId(title.id) } as CSSProperties}
            >
              <span>{title.primaryTitle}</span>
            </div>
          )}
          {title.stream && (
            // Tekst, ikke bare ikon: fargen alene skal ikke bære betydningen.
            <span className="poster__badge">
              <span aria-hidden="true">▶ </span>Se nå
            </span>
          )}
          <div className="poster__overlay">
            {title.genres.length > 0 && (
              <ul className="tags" aria-label="Sjangre">
                {title.genres.slice(0, 3).map((g) => (
                  <li key={g}>{g}</li>
                ))}
              </ul>
            )}
            <span className="poster__votes">{formatNumber(title.numVotes)} stemmer</span>
          </div>
        </div>
        <div className="poster__caption">
          <Heading className="poster__title">
            <Link id={headingId} to={`/title/${title.id}`}>
              {title.primaryTitle}
            </Link>
          </Heading>
          <p className="poster__meta">
            {title.averageRating != null ? (
              <span className="poster__rating">
                <span aria-hidden="true">★ </span>
                <strong>{formatRating(title.averageRating)}</strong>
                <span className="sr-only"> av 10 på IMDb</span>
              </span>
            ) : (
              <span className="muted">Ingen rating</span>
            )}
            <span>{formatYears(title)}</span>
            <span>{typeLabel(title.type)}</span>
          </p>
        </div>
        {actions && <div className="poster__actions">{actions}</div>}
      </article>
    </li>
  );
}
