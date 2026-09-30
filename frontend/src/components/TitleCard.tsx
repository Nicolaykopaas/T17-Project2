import type { ReactNode } from 'react';
import { Link } from 'react-router';
import type { TitleSummary } from '../graphql/types';
import { formatNumber, formatRating, formatYears, typeLabel } from '../lib/format';

export function TitleCard({ title, actions }: { title: TitleSummary; actions?: ReactNode }) {
  return (
    <li className="card">
      <article aria-labelledby={`title-${title.id}`}>
        <h3 className="card__title">
          <Link id={`title-${title.id}`} to={`/title/${title.id}`}>
            {title.primaryTitle}
          </Link>
        </h3>
        <p className="card__meta">
          <span>{formatYears(title)}</span>
          <span aria-hidden="true">·</span>
          <span>{typeLabel(title.type)}</span>
        </p>
        {title.genres.length > 0 && (
          <ul className="tags" aria-label="Sjangre">
            {title.genres.map((g) => (
              <li key={g}>{g}</li>
            ))}
          </ul>
        )}
        <p className="card__rating">
          {title.averageRating != null ? (
            <>
              <span aria-hidden="true">★ </span>
              <strong>{formatRating(title.averageRating)}</strong>{' '}
              <span className="sr-only">av 10 på IMDb</span>
              <span className="muted"> IMDb</span>
            </>
          ) : (
            <span className="muted">Ingen IMDb-rating</span>
          )}
          <span className="muted"> · {formatNumber(title.numVotes)} stemmer</span>
        </p>
        {actions && <div className="card__actions">{actions}</div>}
      </article>
    </li>
  );
}
