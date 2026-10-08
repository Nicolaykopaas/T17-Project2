import { useEffect, useRef, type FocusEvent, type RefObject } from 'react';

/**
 * «Last flere»/«Vis flere» fjernes når siste side er hentet. Hadde knappen fokus, faller det til <body>
 * og tastaturbrukeren mister plassen. Da flyttes fokus til `target` (et statisk punkt nær listen).
 *
 * Vi husker fokus via onFocus/onBlur i stedet for å se på document.activeElement etter at knappen er borte:
 * da er det for sent. Blur med relatedTarget betyr at brukeren selv flyttet fokus videre; blur uten
 * (nettleseren fjerner et fokusert element) skal ikke avvæpne oss.
 */
export function useMoreButtonFocus(hasNext: boolean, target: RefObject<HTMLElement | null>) {
  const focused = useRef(false);

  useEffect(() => {
    if (hasNext || !focused.current) return;
    focused.current = false;
    if (document.activeElement === document.body) target.current?.focus({ preventScroll: true });
  }, [hasNext, target]);

  return {
    onFocus: () => {
      focused.current = true;
    },
    onBlur: (e: FocusEvent) => {
      if (e.relatedTarget) focused.current = false;
    },
  };
}
