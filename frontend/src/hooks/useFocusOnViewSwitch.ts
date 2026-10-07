import { useEffect, useRef } from 'react';

/**
 * Forsiden bytter mellom bla- og søkevisning ut fra URL-en. Fjernes siste filter (chip, avkrysning,
 * «Nullstill alle»), forsvinner kontrollen som hadde fokus sammen med hele visningen, og fokus faller
 * til <body>: tastaturbrukeren starter på nytt øverst, og skjermleseren sier ingenting.
 * Derfor flyttes fokus til sidens h1 – men bare når det faktisk er mistet, så vi aldri stjeler det
 * fra søkefeltet mens noen skriver. Effekten kjører etter commit, slik at den nye h1 finnes.
 */
export function useFocusOnViewSwitch(view: string) {
  const previous = useRef(view);
  useEffect(() => {
    if (previous.current === view) return;
    previous.current = view;
    if (document.activeElement !== document.body) return;
    const h1 = document.querySelector<HTMLElement>('main h1');
    if (!h1) return;
    if (!h1.hasAttribute('tabindex')) h1.tabIndex = -1;
    h1.focus({ preventScroll: true });
  }, [view]);
}
