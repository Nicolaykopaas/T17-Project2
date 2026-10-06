import { useId } from 'react';
import type { SortDirection, SortField } from '../graphql/types';
import { DEFAULT_DIRECTION, type SearchState } from '../lib/searchState';

const FIELDS: { value: SortField; label: string }[] = [
  // Etiketten til RELEVANCE overstyres i komponenten, siden den avhenger av om det finnes søketekst.
  { value: 'RELEVANCE', label: 'Relevans' },
  { value: 'RATING', label: 'Rating' },
  { value: 'YEAR', label: 'År' },
  { value: 'TITLE', label: 'Tittel' },
];

interface Props {
  state: SearchState;
  onChange: (patch: Partial<SearchState>) => void;
}

export function SortControls({ state, onChange }: Props) {
  const fieldId = useId();
  const dirId = useId();
  const field = state.sort ?? 'RELEVANCE';
  // Uten søketekst finnes det ingen relevans å rangere etter; serveren faller da tilbake til
  // popularitet (flest stemmer). Samme enum-verdi og URL-verdi, bare en ærligere etikett.
  // Backend gjør det samme for 1–2 tegn (SHORT_QUERY_MAX i backend/src/search.ts), målt i kodepunkter.
  const relevanceLabel = [...state.q.trim()].length > 2 ? 'Relevans' : 'Popularitet';
  const direction = state.dir ?? DEFAULT_DIRECTION[field];

  return (
    <div className="sort">
      <div className="field">
        <label htmlFor={fieldId}>Sorter etter</label>
        <select
          id={fieldId}
          value={field}
          // Ny sortering starter med feltets naturlige retning (tittel A–Å, resten høyest først).
          onChange={(e) => onChange({ sort: e.target.value as SortField, dir: null })}
        >
          {FIELDS.map((f) => (
            <option key={f.value} value={f.value}>
              {f.value === 'RELEVANCE' ? relevanceLabel : f.label}
            </option>
          ))}
        </select>
      </div>
      <div className="field">
        <label htmlFor={dirId}>Rekkefølge</label>
        <select
          id={dirId}
          value={direction}
          onChange={(e) =>
            onChange({ sort: state.sort ?? field, dir: e.target.value as SortDirection })
          }
        >
          <option value="DESC">Synkende</option>
          <option value="ASC">Stigende</option>
        </select>
      </div>
    </div>
  );
}
