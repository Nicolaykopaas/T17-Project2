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
        // React Router pakker ellers URL-endringen i en transition. Avkrysningsboksene er kontrollert
        // av URL-en, så React tilbakestiller dem til gammel verdi helt til transitionen er ferdig,
        // og brukeren (og hjelpemidler) ser en boks som «hopper tilbake» i et øyeblikk etter klikket.
        flushSync: true,
      });
    },
    [setParams],
  );

  return { state, update };
}
