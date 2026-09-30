import { useState } from 'react';
import { Link, useLocation, useNavigate, useParams } from 'react-router';
import { useQuery } from '@apollo/client/react';
import { CombinedGraphQLErrors } from '@apollo/client';
import { ErrorMessage } from '../components/ErrorMessage';
import { ListToggleButton } from '../components/ListToggleButton';
import { ReviewForm } from '../components/ReviewForm';
import { ReviewList } from '../components/ReviewList';
import { Stars } from '../components/Stars';
import { TITLE_QUERY } from '../graphql/operations';
import { useDocumentTitle } from '../hooks/useDocumentTitle';
import { formatNumber, formatRating, formatYears, typeLabel } from '../lib/format';
import NotFoundPage from './NotFoundPage';

const REVIEWS_PAGE_SIZE = 10;

/** Fra søket brukes historikken, så resultater og scrollposisjon er intakt. Ved direkte åpning finnes ingen «forrige». */
function BackLink() {
  const navigate = useNavigate();
  const { key } = useLocation();
  if (key === 'default') {
    return (
      <p>
        <Link to="/">← Til søket</Link>
      </p>
    );
  }
  return (
    <p>
      <button type="button" className="btn btn--link" onClick={() => void navigate(-1)}>
        ← Tilbake
      </button>
    </p>
  );
}

export default function TitlePage() {
  const { id = '' } = useParams();
  const { data, loading, error, refetch, fetchMore } = useQuery(TITLE_QUERY, {
    variables: { id, first: REVIEWS_PAGE_SIZE },
  });
  const [loadingMore, setLoadingMore] = useState(false);
  const [moreFailed, setMoreFailed] = useState(false);
  const title = data?.title;
  useDocumentTitle(title?.primaryTitle ?? 'Tittel');

  const notFound =
    (data && data.title === null) ||
    (error &&
      CombinedGraphQLErrors.is(error) &&
      error.errors.some((e) => e.extensions?.code === 'NOT_FOUND'));
  if (notFound) return <NotFoundPage what="tittelen" />;

  if (error && !title) {
    return (
      <>
        <h1>Tittel</h1>
        <ErrorMessage
          message="Kunne ikke hente tittelen. Sjekk nettverket og prøv igjen."
          onRetry={() => void refetch().catch(() => undefined)}
        />
      </>
    );
  }

  if (!title) {
    return (
      <div aria-busy={loading}>
        <h1>Laster …</h1>
        <div className="skeleton" aria-hidden="true">
          <div className="skeleton__line skeleton__line--title" />
          <div className="skeleton__line" />
          <div className="skeleton__line skeleton__line--short" />
        </div>
      </div>
    );
  }

  const reviews = title.reviews;
  const loadMoreReviews = async () => {
    setLoadingMore(true);
    setMoreFailed(false);
    try {
      await fetchMore({ variables: { after: reviews.pageInfo.endCursor } });
    } catch {
      setMoreFailed(true);
    } finally {
      setLoadingMore(false);
    }
  };

  return (
    <article>
      <BackLink />
      <h1>{title.primaryTitle}</h1>
      {title.originalTitle !== title.primaryTitle && (
        <p className="muted">Originaltittel: {title.originalTitle}</p>
      )}

      <dl className="facts">
        <div>
          <dt>Type</dt>
          <dd>{typeLabel(title.type)}</dd>
        </div>
        <div>
          <dt>År</dt>
          <dd>{formatYears(title)}</dd>
        </div>
        {title.runtimeMinutes != null && (
          <div>
            <dt>Spilletid</dt>
            <dd>{title.runtimeMinutes} min</dd>
          </div>
        )}
        <div>
          <dt>Sjangre</dt>
          <dd>{title.genres.length ? title.genres.join(', ') : 'Ukjent'}</dd>
        </div>
        <div>
          <dt>IMDb-rating</dt>
          <dd>
            {title.averageRating != null
              ? `${formatRating(title.averageRating)} / 10 (${formatNumber(title.numVotes)} stemmer)`
              : 'Ingen rating'}
          </dd>
        </div>
      </dl>

      <div className="actions">
        <ListToggleButton titleId={title.id} inMyList={title.inMyList} />
      </div>

      <section aria-labelledby="reviews-heading" className="section">
        <h2 id="reviews-heading">Anmeldelser</h2>
        <p className="average">
          {title.userRating != null && title.reviewCount > 0 ? (
            <>
              Snitt fra brukere: <Stars value={title.userRating} />{' '}
              <strong>{formatRating(title.userRating)}</strong> av 5 ({title.reviewCount}{' '}
              {title.reviewCount === 1 ? 'anmeldelse' : 'anmeldelser'})
            </>
          ) : (
            'Ingen brukeranmeldelser ennå.'
          )}
        </p>

        <ReviewList reviews={reviews.edges.map((e) => e.node)} />

        {moreFailed && (
          <p className="error-text" role="alert">
            Kunne ikke laste flere anmeldelser.
          </p>
        )}
        {reviews.pageInfo.hasNextPage && (
          <button
            type="button"
            className="btn"
            disabled={loadingMore}
            onClick={() => void loadMoreReviews()}
          >
            {loadingMore ? 'Laster …' : 'Vis flere'}
          </button>
        )}

        <ReviewForm titleId={title.id} onSubmitted={() => refetch()} />
      </section>
    </article>
  );
}
