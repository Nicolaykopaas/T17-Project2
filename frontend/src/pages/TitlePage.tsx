import { useEffect, useRef, useState, type CSSProperties } from 'react';
import { Link, useParams } from 'react-router';
import { useQuery } from '@apollo/client/react';
import { CombinedGraphQLErrors } from '@apollo/client';
import { useApiUnavailable } from '../apollo/apiStatus';
import { BackLink } from '../components/BackLink';
import { ErrorMessage } from '../components/ErrorMessage';
import { ListToggleButton } from '../components/ListToggleButton';
import { ReviewForm } from '../components/ReviewForm';
import { ReviewList } from '../components/ReviewList';
import { Stars } from '../components/Stars';
import { StreamInfo } from '../components/StreamInfo';
import { TITLE_QUERY } from '../graphql/operations';
import { useMoreButtonFocus } from '../hooks/useMoreButtonFocus';
import { useHeaderOverlay } from '../hooks/useHeaderOverlay';
import { useDocumentTitle } from '../hooks/useDocumentTitle';
import { formatNumber, formatRating, formatYears, hueFromId, typeLabel } from '../lib/format';
import NotFoundPage from './NotFoundPage';

const REVIEWS_PAGE_SIZE = 10;

/** Markerer siden som «heltebilde øverst», så headeren er gjennomsiktig til man scroller. */
function HeaderOverlay() {
  useHeaderOverlay();
  return null;
}

export default function TitlePage() {
  const { id = '' } = useParams();
  const { data, loading, error, refetch, fetchMore } = useQuery(TITLE_QUERY, {
    variables: { id, first: REVIEWS_PAGE_SIZE },
  });
  const [loadingMore, setLoadingMore] = useState(false);
  const [moreFailed, setMoreFailed] = useState(false);
  const [deleted, setDeleted] = useState('');
  const reviewsHeading = useRef<HTMLHeadingElement>(null);
  const deletedTimer = useRef<number>(undefined);
  // «Vis flere» forsvinner når alle anmeldelser er lastet; da flyttes fokus til overskriften.
  const moreFocus = useMoreButtonFocus(
    data?.title?.reviews.pageInfo.hasNextPage ?? false,
    reviewsHeading,
  );
  const apiDown = useApiUnavailable();
  // Ellers kan timeren sette state etter at siden er forlatt.
  useEffect(() => () => window.clearTimeout(deletedTimer.current), []);
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
      <div className="container">
        <h1>Tittel</h1>
        <ErrorMessage
          message="Kunne ikke hente tittelen. Sjekk nettverket og prøv igjen."
          onRetry={() => void refetch().catch(() => undefined)}
        />
      </div>
    );
  }

  if (!title) {
    return (
      <div aria-busy={loading}>
        <HeaderOverlay />
        <div className="title-hero title-hero--skeleton">
          <div className="title-hero__inner container">
            <h1>Laster …</h1>
          </div>
        </div>
      </div>
    );
  }

  const reviews = title.reviews;
  const loadMoreReviews = async () => {
    if (loadingMore) return;
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

  const poster = title.poster342 ?? title.poster500;
  const backdrop = title.backdrop1280 ?? title.backdrop780;

  return (
    <article>
      <HeaderOverlay />
      <div className="title-hero" style={{ '--hue': hueFromId(title.id) } as CSSProperties}>
        <div className="title-hero__media" aria-hidden="true">
          {backdrop && (
            <img
              src={backdrop}
              srcSet={
                title.backdrop780 && title.backdrop1280
                  ? `${title.backdrop780} 780w, ${title.backdrop1280} 1280w`
                  : undefined
              }
              sizes="100vw"
              alt=""
              width={1280}
              height={720}
              fetchPriority="high"
              decoding="async"
            />
          )}
        </div>
        <div className="title-hero__inner container">
          <BackLink fallbackTo="/" fallbackLabel="← Til søket" />
          <div className="title-hero__body">
            <div className="title-hero__poster" aria-hidden="true">
              {poster ? (
                <img
                  src={poster}
                  srcSet={
                    title.poster342 && title.poster500
                      ? `${title.poster342} 342w, ${title.poster500} 500w`
                      : undefined
                  }
                  sizes="(min-width: 48rem) 18rem, 9rem"
                  alt=""
                  width={342}
                  height={513}
                  decoding="async"
                />
              ) : (
                <div className="poster__placeholder">
                  <span>{title.primaryTitle}</span>
                </div>
              )}
            </div>
            <div className="title-hero__text">
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
                  <dt>IMDb-rating</dt>
                  <dd className="facts__rating">
                    {title.averageRating != null ? (
                      <>
                        <span aria-hidden="true">★ </span>
                        {`${formatRating(title.averageRating)} / 10 (${formatNumber(title.numVotes)} stemmer)`}
                      </>
                    ) : (
                      'Ingen rating'
                    )}
                  </dd>
                </div>
              </dl>

              {title.genres.length > 0 && (
                <ul className="tags tags--large" aria-label="Sjangre">
                  {title.genres.map((g) => (
                    <li key={g}>{g}</li>
                  ))}
                </ul>
              )}

              {title.overview && <p className="title-hero__overview">{title.overview}</p>}

              <div className="actions">
                {title.stream && (
                  <Link className="btn btn--primary" to={`/watch/${title.id}`}>
                    <span aria-hidden="true">▶&nbsp;</span>Se filmen
                  </Link>
                )}
                <ListToggleButton titleId={title.id} inMyList={title.inMyList} />
              </div>
              {title.stream && <StreamInfo stream={title.stream} />}
            </div>
          </div>
        </div>
      </div>

      <div className="container">
        <section aria-labelledby="reviews-heading" className="section">
          <h2 id="reviews-heading" ref={reviewsHeading} tabIndex={-1}>
            Anmeldelser
          </h2>
          {/* Regionen finnes hele tiden, ellers leses ikke meldingen opp. */}
          <p className="sr-only" role="status" aria-live="polite">
            {deleted}
          </p>
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

          <ReviewList
            reviews={reviews.edges.map((e) => e.node)}
            onDeleted={() => {
              // Regionen tømmes først: identisk tekst som ved forrige sletting leses ellers ikke opp igjen.
              setDeleted('');
              window.clearTimeout(deletedTimer.current);
              deletedTimer.current = window.setTimeout(
                () => setDeleted('Anmeldelsen er slettet.'),
                100,
              );
              // Slett-knappen forsvinner med raden; overskriften er et fast punkt å lande på.
              reviewsHeading.current?.focus();
            }}
          />

          {moreFailed && (
            <p className="error-text" role={apiDown ? undefined : 'alert'}>
              Kunne ikke laste flere anmeldelser.
            </p>
          )}
          {reviews.pageInfo.hasNextPage && (
            <button
              type="button"
              className="btn"
              // aria-disabled i stedet for disabled: en disabled knapp mister fokus i Chrome mens den laster.
              aria-disabled={loadingMore || undefined}
              onClick={() => void loadMoreReviews()}
              {...moreFocus}
            >
              {loadingMore ? 'Laster …' : 'Vis flere'}
            </button>
          )}

          <ReviewForm titleId={title.id} onSubmitted={() => refetch()} />
        </section>
      </div>
    </article>
  );
}
