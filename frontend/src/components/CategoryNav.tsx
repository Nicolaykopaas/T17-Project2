import type { MouseEvent } from 'react';
import { rowAnchorId, type BrowseRow } from '../lib/browseRows';

function jumpTo(id: string, label: string) {
  const target = document.getElementById(id);
  if (!target) return;
  // Umiddelbart hopp (ikke myk scroll): en myk scroll over mange rader ville utløst lasting av alle
  // radene på veien og landet unøyaktig mens høyden endres. Det respekterer også prefers-reduced-motion.
  // `scrollIntoView` kan mangle i testmiljø; hoppet er en forbedring, fokus er det viktige.
  target.scrollIntoView?.({ behavior: 'auto', block: 'start' });
  // Fokus går til radens ytre element, ikke til overskriften: raden kan senere bli tom og fjerne
  // overskriften fra DOM-en, og da ville fokus falt til body. Elementet får navn og rolle her fordi
  // en navnløs div ikke leses opp. `preventScroll` hindrer at nettleseren flytter seg på nytt.
  target.tabIndex = -1;
  target.setAttribute('role', 'group');
  target.setAttribute('aria-label', label);
  target.focus({ preventScroll: true });
}

/**
 * Kompakt hoppmeny rett under heltebanneret, så man slipper å scrolle forbi alle radene.
 * Lenkene er ekte ankerlenker (href), men klikket håndteres her fordi vi også må flytte fokus.
 */
export function CategoryNav({ rows }: { rows: BrowseRow[] }) {
  const onClick = (e: MouseEvent<HTMLAnchorElement>, row: BrowseRow) => {
    // Ctrl/Cmd/Shift/Alt og midtklikk skal beholde nettleserens vanlige lenkeoppførsel.
    if (e.button !== 0 || e.ctrlKey || e.metaKey || e.shiftKey || e.altKey) return;
    e.preventDefault();
    jumpTo(rowAnchorId(row), row.heading);
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
              // Chrome lar en delvis synlig chip stå halvt klippet når man tabber til den.
              onFocus={(e) =>
                e.currentTarget.scrollIntoView?.({ block: 'nearest', inline: 'nearest' })
              }
            >
              {row.heading}
            </a>
          </li>
        ))}
      </ul>
    </nav>
  );
}
