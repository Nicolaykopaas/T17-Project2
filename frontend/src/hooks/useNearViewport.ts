import { useEffect, useState, type RefObject } from 'react';

/**
 * Blir `true` (og forblir det) første gang elementet nærmer seg viewport. Brukes til å utsette
 * datahenting for rader langt nede på siden. Uten IntersectionObserver hentes alt med en gang,
 * fordi innhold er viktigere enn besparelsen.
 */
export function useNearViewport(ref: RefObject<Element | null>, rootMargin = '400px 0px') {
  const supported = typeof IntersectionObserver !== 'undefined';
  const [near, setNear] = useState(!supported);

  useEffect(() => {
    const el = ref.current;
    if (near || !el) return;
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries.some((e) => e.isIntersecting)) {
          setNear(true);
          observer.disconnect();
        }
      },
      { rootMargin },
    );
    observer.observe(el);
    return () => observer.disconnect();
  }, [ref, near, rootMargin]);

  return near;
}
