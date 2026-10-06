import { formatRating } from '../lib/format';

export function Stars({ value, max = 5 }: { value: number; max?: number }) {
  const full = Math.round(value);
  return (
    // Norsk desimalkomma og én desimal, slik som resten av appen viser snitt.
    <span className="stars" role="img" aria-label={`${formatRating(value)} av ${max} stjerner`}>
      {'★'.repeat(full)}
      <span className="stars__empty">{'★'.repeat(Math.max(0, max - full))}</span>
    </span>
  );
}
