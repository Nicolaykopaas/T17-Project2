import { formatDate } from '../lib/format';
import type { Review } from '../graphql/types';
import { DeleteReviewButton } from './DeleteReviewButton';
import { Stars } from './Stars';

export function ReviewList({
  reviews,
  onDeleted,
}: {
  reviews: Review[];
  /** Kalles etter at brukeren har slettet sin egen anmeldelse. */
  onDeleted?: () => void;
}) {
  if (reviews.length === 0) {
    return <p className="muted">Ingen anmeldelser ennå. Bli den første!</p>;
  }
  return (
    <ul className="reviews">
      {reviews.map((r) => (
        <li key={r.id} className="review">
          <article>
            <header className="review__head">
              <strong>{r.author}</strong>
              {r.isMine && <span className="badge">Din anmeldelse</span>}
              <Stars value={r.rating} />
              <time dateTime={r.createdAt} className="muted">
                {formatDate(r.createdAt)}
              </time>
            </header>
            {r.text && <p className="review__text">{r.text}</p>}
            {r.isMine && <DeleteReviewButton reviewId={r.id} onDeleted={() => onDeleted?.()} />}
          </article>
        </li>
      ))}
    </ul>
  );
}
