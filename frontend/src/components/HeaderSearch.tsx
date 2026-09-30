import { useNavigate, useLocation } from 'react-router';
import { useSearchState } from '../hooks/useSearchState';
import { EMPTY_STATE, serializeSearchState } from '../lib/searchState';
import { SearchBox } from './SearchBox';

/**
 * Søkefeltet bor i headeren og er derfor med på alle sider. På forsiden endrer det bare `q`
 * (øvrige filtre beholdes); andre steder sender det brukeren til forsiden med søket.
 */
export function HeaderSearch() {
  const { pathname } = useLocation();
  const navigate = useNavigate();
  const { state, update } = useSearchState();
  const onHome = pathname === '/';

  return (
    <SearchBox
      value={onHome ? state.q : ''}
      onCommit={(q) => {
        if (onHome) update({ q });
        else
          void navigate({
            pathname: '/',
            search: serializeSearchState({ ...EMPTY_STATE, q }).toString(),
          });
      }}
    />
  );
}
