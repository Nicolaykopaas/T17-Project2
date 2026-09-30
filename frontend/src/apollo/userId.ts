const STORAGE_KEY = 'it2810.userId';

const UUID_V4 = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

let memoryFallback: string | null = null;

/**
 * Anonym bruker-id. Lagres i localStorage slik at «Min liste» og egne
 * anmeldelser overlever omlasting. Faller tilbake til minnet hvis lagring
 * er blokkert (privat modus), så appen fortsatt virker i økta.
 */
export function getUserId(): string {
  try {
    const stored = localStorage.getItem(STORAGE_KEY);
    if (stored && UUID_V4.test(stored)) return stored;
    const id = crypto.randomUUID();
    localStorage.setItem(STORAGE_KEY, id);
    return id;
  } catch {
    memoryFallback ??= crypto.randomUUID();
    return memoryFallback;
  }
}
