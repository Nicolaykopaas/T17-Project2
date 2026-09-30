import { useLayoutEffect } from 'react';

/**
 * Sider med heltebilde øverst markerer det på <html>, så headeren kan være gjennomsiktig
 * over bildet til man scroller. Layout-effekt: ellers blinker en heldekkende header ett bilde.
 */
export function useHeaderOverlay() {
  useLayoutEffect(() => {
    document.documentElement.dataset.hero = '';
    return () => {
      delete document.documentElement.dataset.hero;
    };
  }, []);
}
