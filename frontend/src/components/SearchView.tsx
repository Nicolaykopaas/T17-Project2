import { useEffect, useRef } from 'react';
import { ActiveFilters } from './ActiveFilters';
import { FilterPanel } from './FilterPanel';
import { SearchResults } from './SearchResults';
import { SortControls } from './SortControls';
import { focusResults } from '../lib/focus';
import type { SearchState } from '../lib/searchState';

/** Treffliste med filtre, sortering og aktive filtre. Alt speiles i URL-en. */
export default function SearchView({
  state,
  update,
}: {
  state: SearchState;
  update: (patch: Partial<SearchState>) => void;
}) {
  // «Nullstill alle» og «Fjern alle filtre» forsvinner når filtrene er borte; fokus flyttes til
  // resultatoverskriften. (Ender vi i bla-modus, tar useFocusOnViewSwitch i HomePage over.)
  const resetFocus = useRef(false);
  useEffect(() => {
    if (!resetFocus.current) return;
    resetFocus.current = false;
    if (document.activeElement === document.body) focusResults();
  });
  const reset = () => {
    resetFocus.current = true;
    update({ genres: [], decades: [], types: [], minRating: null, available: false });
  };

  return (
    <div className="container">
      <h1 className="page-title">Søk i filmer og serier</h1>
      <div className="layout">
        <FilterPanel state={state} onChange={update} />
        <div className="layout__results">
          <SortControls state={state} onChange={update} />
          <ActiveFilters state={state} onChange={update} onReset={reset} />
          <SearchResults state={state} onReset={reset} />
        </div>
      </div>
    </div>
  );
}
