import { useEffect, useRef } from 'react';
import { focusResults } from '../lib/focus';
import { decadeLabel, typeLabel } from '../lib/format';
import { activeFilterCount, type SearchState } from '../lib/searchState';

interface Props {
  state: SearchState;
  onChange: (patch: Partial<SearchState>) => void;
  onReset: () => void;
}

export function ActiveFilters({ state, onChange, onReset }: Props) {
  const list = useRef<HTMLUListElement>(null);
  // Fjernes en chip, forsvinner knappen som hadde fokus. Fokus går da til nabo-chipen (så man kan fjerne
  // flere på rad med tastaturet), og når lista blir tom til resultatoverskriften. Uten dette faller fokus
  // til <body>. Verdi: nøkkel til chipen som skal få fokus, 'results', eller null (ingen flytting).
  const focusKey = useRef<string | null>(null);

  // Uten avhengighetsliste: flyttingen skal skje i render-en som følger umiddelbart etter fjerningen,
  // når chipen faktisk er borte fra DOM-en.
  useEffect(() => {
    const target = focusKey.current;
    if (target === null) return;
    focusKey.current = null;
    // Har brukeren (eller et annet element) allerede tatt fokus, lar vi det være.
    if (document.activeElement && document.activeElement !== document.body) return;
    if (target === 'results') return focusResults();
    const chip = [...(list.current?.querySelectorAll<HTMLElement>('button[data-chip]') ?? [])].find(
      (el) => el.dataset.chip === target,
    );
    if (chip) chip.focus();
    else focusResults();
  });

  if (activeFilterCount(state) === 0) return null;

  const chips: { key: string; label: string; remove: () => void }[] = [
    ...state.genres.map((g) => ({
      key: `g-${g}`,
      label: g,
      remove: () => onChange({ genres: state.genres.filter((x) => x !== g) }),
    })),
    ...state.decades.map((d) => ({
      key: `d-${d}`,
      label: decadeLabel(d),
      remove: () => onChange({ decades: state.decades.filter((x) => x !== d) }),
    })),
    ...state.types.map((t) => ({
      key: `t-${t}`,
      label: typeLabel(t),
      remove: () => onChange({ types: state.types.filter((x) => x !== t) }),
    })),
  ];
  if (state.available) {
    chips.unshift({
      key: 'available',
      label: 'Kun filmer som kan strømmes gratis',
      remove: () => onChange({ available: false }),
    });
  }
  if (state.minRating !== null) {
    chips.push({
      key: 'rating',
      label: `Rating minst ${state.minRating}`,
      remove: () => onChange({ minRating: null }),
    });
  }

  return (
    <div className="chips">
      <ul aria-label="Aktive filtre" ref={list}>
        {chips.map((c, i) => (
          <li key={c.key}>
            <button
              type="button"
              className="chip"
              data-chip={c.key}
              onClick={() => {
                focusKey.current = (chips[i + 1] ?? chips[i - 1])?.key ?? 'results';
                c.remove();
              }}
            >
              {c.label}
              <span aria-hidden="true"> ×</span> <span className="sr-only">(fjern filter)</span>
            </button>
          </li>
        ))}
      </ul>
      <button type="button" className="btn btn--link" onClick={onReset}>
        Nullstill alle
      </button>
    </div>
  );
}
