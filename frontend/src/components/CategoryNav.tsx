import type { MouseEvent } from 'react';
import { rowAnchorId, type BrowseRow } from '../lib/browseRows';

const prefersReducedMotion = () =>
  typeof window.matchMedia === 'function' &&
  window.matchMedia('(prefers-reduced-motion: reduce)').matches;

function jumpTo(id: string) {
  const target = document.getElementById(id);
  if (!target) return;
  // Scroll først: da nærmer raden seg viewport og LazyRow starter hentingen av seg selv.
  // `scrollIntoView` kan mangle i testmiljø; hoppet er en forbedring, fokus er det viktige.
  target.scrollIntoView?.({ behavior: prefersReducedMotion() ? 'auto' : 'smooth', block: 'start' });
  // Overskriften er ikke fokuserbar fra før. tabIndex=-1 lar oss flytte fokus dit uten å legge
  // den inn i tab-rekkefølgen. `preventScroll` hindrer at nettleseren avbryter den myke scrollingen.
  const heading = target.querySelector<HTMLElement>('h2') ?? target;
  heading.tabIndex = -1;
  heading.focus({ preventScroll: true });
}

/**
 * Kompakt hoppmeny rett under heltebanneret, så man slipper å scrolle forbi alle radene.
 * Lenkene er ekte ankerlenker (href), men klikket håndteres her fordi vi også må flytte fokus.
 */
export function CategoryNav({ rows }: { rows: BrowseRow[] }) {
  const onClick = (e: MouseEvent<HTMLAnchorElement>, row: BrowseRow) => {
    e.preventDefault();
    jumpTo(rowAnchorId(row));
  };

  return (
    <nav className="catnav container" aria-label="Kategorier">
      <ul className="catnav__list">
        {rows.map((row) => (
          <li key={row.id}>
            <a
              href={`#${rowAnchorId(row)}`}
              className="catnav__link"
              onClick={(e) => onClick(e, row)}
            >
              {row.heading}
            </a>
          </li>
        ))}
      </ul>
    </nav>
  );
}
