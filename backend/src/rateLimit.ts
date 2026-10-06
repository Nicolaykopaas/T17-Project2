import { rateLimited } from './errors.js';

export interface RateLimitOptions {
  /** addReview: anmeldelser per minutt per bruker (også burst-størrelsen). */
  reviewsPerMinute: number;
  /** toggleList og deleteReview: kall per minutt per bruker. */
  mutationsPerMinute: number;
  /** Per-IP-grensen er dette ganger brukergrensen (flere brukere kan dele nett, f.eks. en klasse). */
  ipFactor: number;
}

export const DEFAULT_RATE_LIMITS: RateLimitOptions = {
  // Romslig nok til at en person som rydder opp eller tester appen aldri merker det, men en
  // skript-løkke stoppes etter ett minutts verdi.
  reviewsPerMinute: 10,
  mutationsPerMinute: 60,
  ipFactor: 3,
};

type MutationKind = 'review' | 'mutation';

interface Bucket {
  tokens: number;
  updatedAt: number;
}

/** Hindrer at minnet vokser uten grense hvis noen finner opp nye UUID-er i det uendelige. */
const MAX_KEYS = 50_000;

/**
 * Token bucket i minnet: `capacity` tokens, fylt jevnt opp til full over ett minutt. Et kall koster
 * ett token, så en rolig bruker aldri møter grensen mens en løkke stoppes etter `capacity` kall.
 */
export class TokenBuckets {
  private readonly buckets = new Map<string, Bucket>();

  constructor(
    private readonly capacity: number,
    private readonly now: () => number = Date.now,
  ) {}

  /** Tar ett token. Returnerer 0 hvis det gikk bra, ellers sekunder til neste token er tilgjengelig. */
  take(key: string): number {
    const now = this.now();
    const perMs = this.capacity / 60_000;
    const b = this.buckets.get(key) ?? { tokens: this.capacity, updatedAt: now };
    b.tokens = Math.min(this.capacity, b.tokens + (now - b.updatedAt) * perMs);
    b.updatedAt = now;
    // Flytter nøkkelen sist i Map-rekkefølgen, slik at de eldste er først når vi må rydde.
    this.buckets.delete(key);
    this.buckets.set(key, b);
    if (this.buckets.size > MAX_KEYS) this.prune(now);
    if (b.tokens >= 1) {
      b.tokens -= 1;
      return 0;
    }
    return Math.max(1, Math.ceil((1 - b.tokens) / perMs / 1000));
  }

  private prune(now: number) {
    // En full bøtte er identisk med en ny, så å glemme den endrer ingenting.
    const perMs = this.capacity / 60_000;
    for (const [key, b] of this.buckets) {
      if (b.tokens + (now - b.updatedAt) * perMs >= this.capacity) this.buckets.delete(key);
    }
    // Fortsatt for mange (aktivt misbruk): kast de eldste uansett. Verste utfall er at en
    // misbruker får en ny bøtte; minnet er viktigere enn presisjon her.
    for (const key of this.buckets.keys()) {
      if (this.buckets.size <= MAX_KEYS) break;
      this.buckets.delete(key);
    }
  }
}

/**
 * Enkel begrensning på mutations. Tilstanden ligger i prosessminnet, noe som er greit så lenge
 * backend kjører som én prosess (én systemd-tjeneste på VM-en). Ved flere instanser eller restart
 * nullstilles grensene; en delt grense ville krevd Redis eller en tabell, og det er overkill her.
 */
export class MutationLimiter {
  private readonly user: Record<MutationKind, TokenBuckets>;
  private readonly ip: Record<MutationKind, TokenBuckets>;

  constructor(options: RateLimitOptions = DEFAULT_RATE_LIMITS, now: () => number = Date.now) {
    const cap = { review: options.reviewsPerMinute, mutation: options.mutationsPerMinute };
    const ipCap = (n: number) => Math.max(1, Math.round(n * options.ipFactor));
    this.user = {
      review: new TokenBuckets(cap.review, now),
      mutation: new TokenBuckets(cap.mutation, now),
    };
    this.ip = {
      review: new TokenBuckets(ipCap(cap.review), now),
      mutation: new TokenBuckets(ipCap(cap.mutation), now),
    };
  }

  /** Kaster RATE_LIMITED når brukeren (eller IP-adressen) har brukt opp kvoten for denne typen. */
  check(kind: MutationKind, userId: string, ip: string | null): void {
    // Rekkefølge: IP først, og `||` stopper ved første avvisning. Avvises IP-en, rører vi ikke
    // brukerkvoten. Omvendt har et IP-token allerede blitt brukt når brukerkvoten avviser. Det er
    // bevisst og greit: forespørselen kom fra den IP-en uansett, så en bruker som spammer skal
    // også telle mot IP-ens kvote (og dermed til slutt stoppes på IP selv om hun bytter bruker-id).
    const wait = (ip ? this.ip[kind].take(ip) : 0) || this.user[kind].take(userId);
    if (wait > 0) {
      throw rateLimited(`For mange forsøk. Vent ${wait} sekunder og prøv igjen.`, wait);
    }
  }
}

/** 127.0.0.0/8, ::1 og IPv4-mappede varianter (::ffff:127.0.0.1). */
export function isLoopback(address: string): boolean {
  return /^(::ffff:)?127\./i.test(address) || address === '::1';
}

/**
 * Klientens IP bak Apache: mod_proxy legger den til sist i X-Forwarded-For, så siste ledd er
 * ikke noe klienten kan forfalske (tidligere ledd kan). Headeren stoles BARE på når selve
 * TCP-forbindelsen kommer fra loopback, dvs. fra proxyen på samme maskin. Kommer forbindelsen fra
 * en annen adresse (noen har nådd port 3001 direkte), brukes den adressen og headeren ignoreres,
 * ellers kunne klienten satt en ny falsk IP i hver forespørsel og omgått IP-grensen.
 *
 * `remoteAddress` er undefined når appen kalles uten node:http (tester via yoga.fetch); da finnes
 * ingen forbindelse å sjekke, og headeren brukes som den er. Uten header begrenses bare per bruker.
 */
export function clientIp(request: Request, remoteAddress?: string): string | null {
  if (remoteAddress && !isLoopback(remoteAddress)) return remoteAddress.slice(0, 64);
  const header = request.headers.get('x-forwarded-for');
  if (!header) return null;
  const last = header.split(',').at(-1)?.trim();
  return last ? last.slice(0, 64) : null;
}
