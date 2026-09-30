import { useCallback, useMemo } from 'react';
import { useSearchParams } from 'react-router';
import { parseSearchState, serializeSearchState, type SearchState } from '../lib/searchState';

/**
 * Søketilstanden bor i URL-en. Endringer bruker `replace` slik at hvert
 * tastetrykk/avkrysning ikke fyller historikken; «tilbake» går da til forrige side.
 */
export function useSearchState() {
  const [params, setParams] = useSearchParams();
  const state = useMemo(() => parseSearchState(params), [params]);

  const update = useCallback(
    (patch: Partial<SearchState>) => {
      setParams((prev) => serializeSearchState({ ...parseSearchState(prev), ...patch }), {
        replace: true,
      });
    },
    [setParams],
  );

  return { state, update };
}
