import { useCallback, useLayoutEffect, useMemo, useRef } from 'react';
import { useSearchParams } from 'react-router';
import {
  isBrowseState,
  parseSearchState,
  serializeSearchState,
  type SearchState,
} from '../lib/searchState';

/**
 * Søketilstanden bor i URL-en. Endringer bruker `replace` slik at hvert
 * tastetrykk/avkrysning ikke fyller historikken; «tilbake» går da til forrige side.
 * Unntaket er første endring fra forsiden (bla-modus): den bruker `push`, ellers ville søket erstattet
 * forsiden i historikken og «tilbake» hoppet forbi den.
 */
export function useSearchState() {
  const [params, setParams] = useSearchParams();
  const state = useMemo(() => parseSearchState(params), [params]);
  // Valget mellom push og replace avhenger av gjeldende URL, men `update` skal være stabil og kan kalles fra
  // en debouncet closure; derfor leses nåværende tilstand fra en ref som oppdateres etter hver commit.
  const current = useRef(state);
  useLayoutEffect(() => {
    current.current = state;
  }, [state]);

  const update = useCallback(
    (patch: Partial<SearchState>) => {
      setParams((prev) => serializeSearchState({ ...parseSearchState(prev), ...patch }), {
        replace: !isBrowseState(current.current),
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
