/**
 * Minimal DataLoader: samler alle load()-kall som skjer i samme tick til ett batch-kall.
 * GraphQL kaller feltresolvere for alle elementene i en liste synkront etter hverandre, så
 * en microtask-flush fanger dem alle. Resultatene caches per instans (= per request).
 */
export function batchLoader<V>(
  batchFn: (keys: string[]) => Promise<Map<string, V>>,
  fallback: V,
): { load: (key: string) => Promise<V> } {
  const cache = new Map<string, Promise<V>>();
  let pending: { key: string; resolve: (v: V) => void; reject: (e: unknown) => void }[] = [];

  const flush = async () => {
    const batch = pending;
    pending = [];
    try {
      const result = await batchFn([...new Set(batch.map((b) => b.key))]);
      for (const b of batch) b.resolve(result.get(b.key) ?? fallback);
    } catch (err) {
      for (const b of batch) b.reject(err);
    }
  };

  return {
    load(key) {
      const cached = cache.get(key);
      if (cached) return cached;
      const promise = new Promise<V>((resolve, reject) => {
        if (pending.length === 0) queueMicrotask(flush);
        pending.push({ key, resolve, reject });
      });
      cache.set(key, promise);
      return promise;
    },
  };
}
