import { ActiveFilters } from '../components/ActiveFilters';
import { FilterPanel } from '../components/FilterPanel';
import { SearchBox } from '../components/SearchBox';
import { SearchResults } from '../components/SearchResults';
import { SortControls } from '../components/SortControls';
import { useDocumentTitle } from '../hooks/useDocumentTitle';
import { useSearchState } from '../hooks/useSearchState';

export default function HomePage() {
  useDocumentTitle('Søk');
  const { state, update } = useSearchState();
  const reset = () => update({ genres: [], decades: [], types: [], minRating: null });

  return (
    <>
      <h1>Søk i filmer og serier</h1>
      <SearchBox value={state.q} onCommit={(q) => update({ q })} />
      <div className="layout">
        <FilterPanel state={state} onChange={update} />
        <div className="layout__results">
          <SortControls state={state} onChange={update} />
          <ActiveFilters state={state} onChange={update} onReset={reset} />
          <SearchResults state={state} onReset={reset} />
        </div>
      </div>
    </>
  );
}
