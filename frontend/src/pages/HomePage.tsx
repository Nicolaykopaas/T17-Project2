import { lazy, Suspense } from 'react';
import { useQuery } from '@apollo/client/react';
import { CategoryNav } from '../components/CategoryNav';
import { Hero, HeroSkeleton } from '../components/Hero';
import { LazyRow } from '../components/LazyRow';
import { TitleRow } from '../components/TitleRow';
import { FEATURED_QUERY } from '../graphql/operations';
import { useDocumentTitle } from '../hooks/useDocumentTitle';
import { useFocusOnViewSwitch } from '../hooks/useFocusOnViewSwitch';
import { useSearchState } from '../hooks/useSearchState';
import { BROWSE_ROWS, rowAnchorId, rowVariables, seeAllSearch } from '../lib/browseRows';
import { isBrowseState } from '../lib/searchState';

// Filtre, sortering og trefflisten trengs bare når man søker, så forsiden slipper å laste dem.
const SearchView = lazy(() => import('../components/SearchView'));

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
      <CategoryNav rows={BROWSE_ROWS} />
      <div className={hero || loading ? 'rows' : 'rows rows--plain'}>
        <div id={rowAnchorId(FEATURED_ROW!)} className="row-anchor">
          <TitleRow
            heading={FEATURED_ROW!.heading}
            seeAllTo={seeAllSearch(FEATURED_ROW!.state)}
            titles={titles}
            loading={loading}
            error={!!error}
            onRetry={() => void refetch().catch(() => undefined)}
          />
        </div>
        {OTHER_ROWS.map((row) => (
          <LazyRow key={row.id} row={row} />
        ))}
      </div>
    </>
  );
}

export default function HomePage() {
  useDocumentTitle('Søk');
  const { state, update } = useSearchState();
  useFocusOnViewSwitch(isBrowseState(state) ? 'browse' : 'search');
  if (isBrowseState(state)) return <BrowseView />;
  return (
    <Suspense
      fallback={
        <div className="container">
          <h1 className="page-title">Søk i filmer og serier</h1>
          <p role="status">Laster …</p>
        </div>
      }
    >
      <SearchView state={state} update={update} />
    </Suspense>
  );
}
