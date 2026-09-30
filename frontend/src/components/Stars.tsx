export function Stars({ value, max = 5 }: { value: number; max?: number }) {
  const full = Math.round(value);
  return (
    <span className="stars" role="img" aria-label={`${value} av ${max} stjerner`}>
      {'★'.repeat(full)}
      <span className="stars__empty">{'★'.repeat(Math.max(0, max - full))}</span>
    </span>
  );
}
