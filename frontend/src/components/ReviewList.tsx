import { formatDate } from '../lib/format';
import type { Review } from '../graphql/types';
import { Stars } from './Stars';

export function ReviewList({ reviews }: { reviews: Review[] }) {
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
          </article>
        </li>
      ))}
    </ul>
  );
}
