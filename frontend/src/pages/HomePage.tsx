import { useQuery } from '@apollo/client/react';
import { ActiveFilters } from '../components/ActiveFilters';
import { FilterPanel } from '../components/FilterPanel';
import { Hero, HeroSkeleton } from '../components/Hero';
import { LazyRow } from '../components/LazyRow';
import { SearchResults } from '../components/SearchResults';
import { SortControls } from '../components/SortControls';
import { TitleRow } from '../components/TitleRow';
import { FEATURED_QUERY } from '../graphql/operations';
import { useDocumentTitle } from '../hooks/useDocumentTitle';
import { useSearchState } from '../hooks/useSearchState';
import { BROWSE_ROWS, rowVariables, seeAllSearch } from '../lib/browseRows';
import { isBrowseState, type SearchState } from '../lib/searchState';

const [FEATURED_ROW, ...OTHER_ROWS] = BROWSE_ROWS;

/** Forsiden uten søk eller filtre: heltebanner og rader å bla i. */
function BrowseView() {
  const { data, loading, error, refetch } = useQuery(FEATURED_QUERY, {
    variables: rowVariables(FEATURED_ROW!.state),
  });
  const titles = data?.search.edges.map((e) => e.node);
  // Første tittel med bakgrunnsbilde; uten noen bilder brukes rett og slett den første.
  const hero = titles?.find((t) => t.backdrop1280 || t.backdrop780) ?? titles?.[0];

  return (
    <>
      <h1 className="sr-only">Søk i filmer og serier</h1>
      {hero ? <Hero title={hero} /> : loading ? <HeroSkeleton /> : null}
      <div className={hero || loading ? 'rows' : 'rows rows--plain'}>
        <TitleRow
          heading={FEATURED_ROW!.heading}
          seeAllTo={seeAllSearch(FEATURED_ROW!.state)}
          titles={titles}
          loading={loading}
          error={!!error}
          onRetry={() => void refetch().catch(() => undefined)}
        />
        {OTHER_ROWS.map((row) => (
          <LazyRow key={row.id} row={row} />
        ))}
      </div>
    </>
  );
}

/** Treffliste med filtre, sortering og aktive filtre. Alt speiles i URL-en. */
function SearchView({
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

export default function HomePage() {
  useDocumentTitle('Søk');
  const { state, update } = useSearchState();
  return isBrowseState(state) ? <BrowseView /> : <SearchView state={state} update={update} />;
}
