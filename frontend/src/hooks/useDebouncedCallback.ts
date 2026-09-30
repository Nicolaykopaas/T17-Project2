import { useCallback, useEffect, useRef } from 'react';

/** Kaller `fn` først etter `delay` ms uten nye kall. `cancel` stopper ventende kall. */
export function useDebouncedCallback<A extends unknown[]>(fn: (...args: A) => void, delay: number) {
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const latest = useRef(fn);

  useEffect(() => {
    latest.current = fn;
  });

  const cancel = useCallback(() => clearTimeout(timer.current), []);
  useEffect(() => cancel, [cancel]);

  const call = useCallback(
    (...args: A) => {
      clearTimeout(timer.current);
      timer.current = setTimeout(() => latest.current(...args), delay);
    },
    [delay],
  );

  return { call, cancel };
}
