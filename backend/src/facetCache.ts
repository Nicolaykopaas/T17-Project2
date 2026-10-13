import type { Filters } from './validation.js';

/**
 * Fasettene uten søketekst er de samme for alle besøkende, men koster fire aggregeringer over hele
 * `titles` (ca. 85 ms på 120 000 syntetiske titler, mer på ekte data). Filterpanelet ber om dem ved
 * hvert besøk på søkesiden uten tekst og hver «Se alle»-lenke fra forsiden, så de holdes i minnet.
 *
 * Hvorfor i minnet og ikke en forhåndsberegnet tabell: tallene endres bare når importskriptene
 * kjører (anmeldelser og «min liste» påvirker ikke fasettene), backenden er én prosess, og en tabell
 * måtte holdes i takt fra tre importskript og testene. Prisen er at tallene kan være opptil
 * `ttlMs` gamle etter en import. Se docs/beslutninger.md.
 */

/** Fem minutter: kort nok til at en import synes raskt, lang nok til at nesten alle treff er i minnet. */
export const FACET_CACHE_TTL_MS = 5 * 60_000;
/**
 * Øvre grense for antall filterkombinasjoner. Forsiden lenker til åtte, men validerte filtre gir
 * svært mange mulige nøkler, og minnet skal ikke kunne vokse ved at noen prøver dem alle.
 */
export const FACET_CACHE_MAX_ENTRIES = 64;

interface Entry<T> {
  value: Promise<T>;
  expiresAt: number;
}

export interface FacetCacheOptions {
  ttlMs?: number;
  maxEntries?: number;
  now?: () => number;
}

/**
 * Liten TTL-cache med LRU-utkasting. Lagrer løftet, ikke svaret, slik at samtidige requests for
 * samme nøkkel deler én databasespørring i stedet for å sende hver sin mens den første pågår.
 */
export class FacetCache<T = unknown> {
  private readonly entries = new Map<string, Entry<T>>();
  private readonly ttlMs: number;
  private readonly maxEntries: number;
  private readonly now: () => number;

  constructor({
    ttlMs = FACET_CACHE_TTL_MS,
    maxEntries = FACET_CACHE_MAX_ENTRIES,
    now = Date.now,
  }: FacetCacheOptions = {}) {
    this.ttlMs = ttlMs;
    this.maxEntries = maxEntries;
    this.now = now;
  }

  get size(): number {
    return this.entries.size;
  }

  async get(key: string, load: () => Promise<T>): Promise<T> {
    const now = this.now();
    const hit = this.entries.get(key);
    if (hit && hit.expiresAt > now) {
      // Flytt bakerst: Map beholder innsettingsrekkefølgen, så første nøkkel er minst nylig brukt.
      this.entries.delete(key);
      this.entries.set(key, hit);
      return hit.value;
    }
    if (hit) this.entries.delete(key);

    const value = load();
    const entry: Entry<T> = { value, expiresAt: now + this.ttlMs };
    this.entries.set(key, entry);
    while (this.entries.size > this.maxEntries) {
      const oldest = this.entries.keys().next().value as string;
      this.entries.delete(oldest);
    }
    // En feil (f.eks. databasen nede) skal ikke bli husket i fem minutter: neste request prøver igjen.
    value.catch(() => {
      if (this.entries.get(key) === entry) this.entries.delete(key);
    });
    return value;
  }

  clear(): void {
    this.entries.clear();
  }
}

/**
 * Nøkkel for fasetter som kan deles mellom brukere, eller null når de ikke skal caches. `query` er
 * allerede validert (tom eller bare mellomrom er null). Med søketekst caches ingenting:
 * nøkkelrommet er ubegrenset, nesten hvert søk er unikt, og trigramindeksene gjør dem raske nok
 * uansett. Filtrene sorteres så rekkefølgen i URL-en ikke gir flere nøkler for samme svar.
 */
export function facetCacheKey(query: string | null, filters: Filters): string | null {
  if (query !== null) return null;
  return JSON.stringify([
    [...filters.genres].sort(),
    [...filters.decades].sort((a, b) => a - b),
    [...filters.types].sort(),
    filters.minRating,
    filters.availableOnly,
  ]);
}
