import { decadeLabel, typeLabel } from '../lib/format';
import { activeFilterCount, type SearchState } from '../lib/searchState';

interface Props {
  state: SearchState;
  onChange: (patch: Partial<SearchState>) => void;
  onReset: () => void;
}

export function ActiveFilters({ state, onChange, onReset }: Props) {
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
      label: 'Kun filmer du kan se',
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
      <ul aria-label="Aktive filtre">
        {chips.map((c) => (
          <li key={c.key}>
            <button type="button" className="chip" onClick={c.remove}>
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
