const STORAGE_KEY = 'it2810.userId';

const UUID_V4 = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

let memoryFallback: string | null = null;

/**
 * UUID v4 uten crypto.randomUUID: den finnes bare i sikre kontekster (https/localhost), og VM-en
 * serverer appen over vanlig http. getRandomValues er tilgjengelig overalt.
 */
export function uuidV4(): string {
  const b = crypto.getRandomValues(new Uint8Array(16));
  b[6] = (b[6]! & 0x0f) | 0x40; // versjon 4
  b[8] = (b[8]! & 0x3f) | 0x80; // variant 10xx
  const h = Array.from(b, (x) => x.toString(16).padStart(2, '0')).join('');
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`;
}

/**
 * Anonym bruker-id. Lagres i localStorage slik at «Min liste» og egne
 * anmeldelser overlever omlasting. Faller tilbake til minnet hvis lagring
 * er blokkert (privat modus), så appen fortsatt virker i økta.
 */
export function getUserId(): string {
  try {
    const stored = localStorage.getItem(STORAGE_KEY);
    if (stored && UUID_V4.test(stored)) return stored;
    const id = uuidV4();
    localStorage.setItem(STORAGE_KEY, id);
    return id;
  } catch {
    memoryFallback ??= uuidV4();
    return memoryFallback;
  }
}
