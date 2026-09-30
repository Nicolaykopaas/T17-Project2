export function ResultSkeleton({ count = 6 }: { count?: number }) {
  return (
    <ul className="results skeleton" aria-hidden="true" data-testid="skeleton">
      {Array.from({ length: count }, (_, i) => (
        <li key={i} className="card">
          <div className="skeleton__line skeleton__line--title" />
          <div className="skeleton__line skeleton__line--short" />
          <div className="skeleton__line" />
        </li>
      ))}
    </ul>
  );
}
