/** Plakatformede plassholdere i samme størrelse som ekte kort, så innholdet ikke flytter seg når det kommer. */
export function PosterSkeleton({ count = 6, grid = false }: { count?: number; grid?: boolean }) {
  return (
    <ul
      className={`${grid ? 'poster-grid' : 'row__list'} skeleton`}
      aria-hidden="true"
      data-testid="skeleton"
    >
      {Array.from({ length: count }, (_, i) => (
        <li key={i} className="poster">
          <div className="poster__art skeleton__block" />
          <div className="poster__caption">
            <div className="skeleton__line skeleton__line--title" />
            <div className="skeleton__line skeleton__line--short" />
          </div>
        </li>
      ))}
    </ul>
  );
}
