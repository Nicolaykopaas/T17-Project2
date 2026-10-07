import { ActiveFilters } from './ActiveFilters';
import { FilterPanel } from './FilterPanel';
import { SearchResults } from './SearchResults';
import { SortControls } from './SortControls';
import type { SearchState } from '../lib/searchState';

/** Treffliste med filtre, sortering og aktive filtre. Alt speiles i URL-en. */
export default function SearchView({
  state,
  update,
}: {
  state: SearchState;
  update: (patch: Partial<SearchState>) => void;
}) {
  const reset = () =>
    update({ genres: [], decades: [], types: [], minRating: null, available: false });

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
