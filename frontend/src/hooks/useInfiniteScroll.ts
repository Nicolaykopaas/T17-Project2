import { useEffect, useRef, type RefObject } from 'react';

/**
 * Kaller `onReach` når sentinel-elementet nærmer seg viewport. `resetKey`
 * gjør at observatøren settes opp på nytt etter hver side: ellers utløses
 * den ikke igjen hvis sentinelen fortsatt er synlig på en høy skjerm.
 * «Last flere»-knappen dekker miljøer uten IntersectionObserver og tastaturbrukere.
 */
export function useInfiniteScroll(
  ref: RefObject<Element | null>,
  onReach: () => void,
  enabled: boolean,
  resetKey: unknown,
) {
  const callback = useRef(onReach);
  useEffect(() => {
    callback.current = onReach;
  });

  useEffect(() => {
    const el = ref.current;
    if (!enabled || !el || typeof IntersectionObserver === 'undefined') return;
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries.some((e) => e.isIntersecting)) callback.current();
      },
      { rootMargin: '400px 0px' },
    );
    observer.observe(el);
    return () => observer.disconnect();
  }, [ref, enabled, resetKey]);
}
