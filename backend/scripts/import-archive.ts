import { pathToFileURL } from 'node:url';
import { config } from '../src/config.js';
import { createPool, type Pool } from '../src/db.js';
import { isSafeArchiveId, isSafeFileName } from '../src/stream.js';

/**
 * Importerer lovlige gratisfilmer fra Internet Archive til title_streams. Vi lagrer bare pekere
 * (element-id og filnavn); videoen strømmes fra archive.org. Se docs/beslutninger.md for
 * lisensregelen og koblingen til IMDb-titler. Trygt å kjøre flere ganger (upsert).
 */

// --- Lisensregel --------------------------------------------------------------------------

/** Kuraterte samlinger der Internet Archive selv kun tar imot public domain-filmer. */
export const CURATED_COLLECTIONS = ['feature_films', 'film_noir', 'silent_films'] as const;

export type Field = string | number | (string | number)[] | null | undefined;

/** Scrape-API-et gir enten én verdi eller en liste, avhengig av hvor mange elementet har. */
function values(field: Field): string[] {
  if (field === null || field === undefined) return [];
  return (Array.isArray(field) ? field : [field]).map(String).filter((v) => v.length > 0);
}

function licenseUrls(field: Field): URL[] {
  const urls: URL[] = [];
  for (const v of values(field)) {
    try {
      // Noen elementer har «creativecommons.org/…» uten skjema.
      urls.push(new URL(/^[a-z][a-z0-9+.-]*:\/\//i.test(v) ? v.trim() : `http://${v.trim()}`));
    } catch {
      // Ugyldig URL = ingen lisens å stole på.
    }
  }
  return urls;
}

const isCreativeCommons = (u: URL) =>
  u.hostname === 'creativecommons.org' || u.hostname.endsWith('.creativecommons.org');
const isPublicDomainUrl = (u: URL) => u.href.toLowerCase().includes('publicdomain');

export interface LicenseInput {
  licenseurl?: Field;
  collection?: Field;
}

/**
 * Er elementet fritt å vise? Ja hvis lisens-URL-en er Creative Commons (verten er
 * creativecommons.org, ikke bare en URL som nevner det) eller en public domain-erklæring, eller
 * hvis elementet ligger i en kuratert public domain-samling. Alt annet, også elementer uten
 * lisens, er ikke lovlig for oss.
 */
export function isLawful(item: LicenseInput): boolean {
  if (licenseUrls(item.licenseurl).some((u) => isCreativeCommons(u) || isPublicDomainUrl(u))) {
    return true;
  }
  const collections = new Set(values(item.collection).map((c) => c.toLowerCase()));
  return CURATED_COLLECTIONS.some((c) => collections.has(c));
}

/** Menneskelesbar lisens til visning under spilleren. Forutsetter isLawful(item). */
export function licenseLabel(item: LicenseInput): string {
  for (const u of licenseUrls(item.licenseurl)) {
    if (!isCreativeCommons(u) && !isPublicDomainUrl(u)) continue;
    const path = u.pathname.toLowerCase();
    if (path.includes('/publicdomain/zero')) return 'CC0';
    if (path.includes('/publicdomain')) return 'Public Domain';
    const m = /\/licenses\/([a-z-]+)\/(\d+\.\d+)/.exec(path);
    if (m) return `CC ${m[1]!.toUpperCase()} ${m[2]}`;
    if (isPublicDomainUrl(u)) return 'Public Domain';
    return 'Creative Commons';
  }
  return 'Public Domain';
}

/** Lisens-URL vi viser videre, bare hvis den er en vanlig http(s)-lenke. */
export function licenseLink(item: LicenseInput): string | null {
  const u = licenseUrls(item.licenseurl).find((x) => isCreativeCommons(x) || isPublicDomainUrl(x));
  return u && (u.protocol === 'http:' || u.protocol === 'https:') ? u.href : null;
}

// --- Kobling til IMDb-titler ------------------------------------------------------------

/**
 * Sammenligningsnøkkel for tittel: uten aksenter, tegnsetting og ledende «the»/«a», slik at
 * «The Amélie!» og «amelie» blir like. Tom streng betyr at tittelen ikke kan brukes til kobling.
 */
export function normalizeTitle(title: string): string {
  const base = title
    .normalize('NFKD')
    .replace(/\p{M}+/gu, '')
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .trim();
  return base.replace(/^(the|a)\s+/, '');
}

export function extractImdbId(field: Field): string | null {
  for (const v of values(field)) {
    const m = /urn:imdb:(tt\d{7,9})\b/i.exec(v);
    if (m) return m[1]!.toLowerCase();
  }
  return null;
}

/** År fra `year`, ellers fra `date` (ISO-tekst). */
export function extractYear(item: { year?: Field; date?: Field }): number | null {
  for (const v of [...values(item.year), ...values(item.date)]) {
    const m = /^\s*(\d{4})/.exec(v);
    if (m) {
      const y = Number(m[1]);
      if (y >= 1850 && y <= 2100) return y;
    }
  }
  return null;
}

export interface TitleEntry {
  id: string;
  year: number | null;
}

/** normalisert tittel -> IMDb-filmer med den tittelen (primær- og originaltittel). */
export type TitleIndex = Map<string, TitleEntry[]>;

export function buildTitleIndex(
  rows: { id: string; primary_title: string; original_title: string; start_year: number | null }[],
): TitleIndex {
  const index: TitleIndex = new Map();
  for (const r of rows) {
    for (const t of new Set([r.primary_title, r.original_title])) {
      const key = normalizeTitle(t);
      if (!key) continue;
      const list = index.get(key);
      const entry = { id: r.id, year: r.start_year };
      if (list) list.push(entry);
      else index.set(key, [entry]);
    }
  }
  return index;
}

/**
 * Tittel + år ±1 (Archive og IMDb er sjelden enige om årstallet). Bare ved entydig treff: en
 * feil kobling ville vist feil film under en annen films side, så tvetydige hoppes over.
 */
export function matchByTitle(index: TitleIndex, title: string, year: number | null): string | null {
  if (year === null) return null;
  const key = normalizeTitle(title);
  if (!key) return null;
  const ids = new Set(
    (index.get(key) ?? [])
      .filter((e) => e.year !== null && Math.abs(e.year - year) <= 1)
      .map((e) => e.id),
  );
  return ids.size === 1 ? [...ids][0]! : null;
}

export interface ArchiveItem extends LicenseInput {
  identifier: string;
  title?: Field;
  year?: Field;
  date?: Field;
  'external-identifier'?: Field;
}

export interface Link {
  titleId: string;
  via: 'imdb' | 'title';
}

/**
 * 1) IMDb-ID i external-identifier hvis tittelen finnes hos oss, 2) ellers tittel + år.
 * En IMDb-ID vi ikke kjenner faller videre til tittel + år (IDen kan gjelde en tittel vi
 * ikke har importert, men tittelen kan likevel finnes under en annen id).
 */
export function linkItem(
  item: ArchiveItem,
  known: { hasId: (id: string) => boolean; titles: TitleIndex },
): Link | null {
  const imdb = extractImdbId(item['external-identifier']);
  if (imdb && known.hasId(imdb)) return { titleId: imdb, via: 'imdb' };
  const title = values(item.title)[0];
  if (!title) return null;
  const id = matchByTitle(known.titles, title, extractYear(item));
  return id ? { titleId: id, via: 'title' } : null;
}

// --- Filvalg ------------------------------------------------------------------------------

export interface ArchiveFile {
  name?: string;
  format?: string;
  size?: string | number;
  length?: string | number;
  source?: string;
}

export interface ChosenFile {
  fileName: string;
  durationSeconds: number | null;
  subtitlesFile: string | null;
}

/** `length` er sekunder («5401.23») eller tid («01:30:01», «90:01»). Ugyldig eller 0 = null. */
export function parseDuration(value: unknown): number | null {
  if (typeof value === 'number') {
    return Number.isFinite(value) && value > 0 ? Math.round(value) : null;
  }
  if (typeof value !== 'string') return null;
  const text = value.trim();
  let seconds: number;
  if (/^\d+(\.\d+)?$/.test(text)) seconds = Number(text);
  else if (/^\d+(:\d{1,2}){1,2}(\.\d+)?$/.test(text)) {
    seconds = text.split(':').reduce((acc, part) => acc * 60 + Number(part), 0);
  } else return null;
  return seconds > 0 && seconds < 24 * 3600 ? Math.round(seconds) : null;
}

const MP4_FORMATS: Record<string, number> = {
  // Lavere tall = bedre. h.264 er Archives eget strømmeformat (moderat størrelse), 512Kb er
  // minst (bærekraft), og «MPEG4» er ofte den store originalen.
  'h.264': 0,
  'h.264 ia': 0,
  '512kb mpeg4': 1,
  mpeg4: 2,
};

function rank(file: ArchiveFile): number | null {
  const name = file.name ?? '';
  if (!isSafeFileName(name)) return null;
  const lower = name.toLowerCase();
  const format = (file.format ?? '').toLowerCase();
  // Nettleserne spiller MP4 (H.264) overalt; WebM og Ogg er reserve. Rekkefølgen er
  // container først, deretter formatklasse.
  if (lower.endsWith('.mp4')) return 10 + (MP4_FORMATS[format] ?? 3);
  if (lower.endsWith('.webm')) return 20;
  if (lower.endsWith('.ogv')) return 30;
  return null;
}

const sizeOf = (f: ArchiveFile) => {
  const n = Number(f.size);
  return Number.isFinite(n) && n > 0 ? n : Number.MAX_SAFE_INTEGER;
};

/** Beste spillbare fil i nettleseren, eller null. Mindre filer foretrekkes innen samme klasse. */
export function chooseFiles(files: unknown): ChosenFile | null {
  if (!Array.isArray(files)) return null;
  const list = files.filter((f): f is ArchiveFile => typeof f === 'object' && f !== null);
  const candidates = list
    .map((file) => ({ file, r: rank(file) }))
    .filter((c): c is { file: ArchiveFile; r: number } => c.r !== null)
    .sort(
      (a, b) =>
        a.r - b.r || sizeOf(a.file) - sizeOf(b.file) || a.file.name!.localeCompare(b.file.name!),
    );
  const best = candidates[0]?.file;
  if (!best) return null;

  const base = best.name!.replace(/\.[^.]+$/, '').toLowerCase();
  const vtts = list
    .filter((f) => typeof f.name === 'string' && f.name.toLowerCase().endsWith('.vtt'))
    .filter((f) => isSafeFileName(f.name!))
    .sort((a, b) => a.name!.localeCompare(b.name!));
  // Undertekst med samme grunnnavn som videoen hører til akkurat den videoen.
  const vtt = vtts.find((f) => f.name!.toLowerCase().startsWith(base)) ?? vtts[0];

  // Varigheten står ofte bare på originalfilen, ikke på avledede versjoner.
  const duration =
    parseDuration(best.length) ?? list.map((f) => parseDuration(f.length)).find((d) => d !== null);
  return {
    fileName: best.name!,
    durationSeconds: duration ?? null,
    subtitlesFile: vtt?.name ?? null,
  };
}

// --- HTTP ---------------------------------------------------------------------------------

/**
 * Kuraterte samlinger tas med uansett. Lisensbaserte treff krever i tillegg en IMDb-referanse:
 * av ca. 259 000 Creative Commons-elementer ble under 1 % koblet til en IMDb-film (resten er
 * hjemmevideoer o.l.), og å skanne alle tok 10-30 minutter. `classic_tv` er utelatt fordi
 * samlingen bare er lovlig med lisens-URL, og de treffene dekkes av lisensgrenen.
 */
export const CANDIDATE_QUERY =
  'mediatype:movies AND (collection:feature_films OR collection:film_noir OR collection:silent_films OR ' +
  '((licenseurl:*creativecommons* OR licenseurl:*publicdomain*) AND external-identifier:*imdb*))';

const SCRAPE_FIELDS = 'identifier,title,year,date,licenseurl,external-identifier,collection';

export interface HttpOptions {
  fetch?: typeof fetch;
  timeoutMs: number;
  /** Minste tid mellom starten på to kall (alle arbeidere sammen). */
  paceMs: number;
  retryDelayMs: number;
}

/** Deler taktgiveren mellom samtidige arbeidere, slik at 4 tråder ikke gir 4x belastning. */
class Pacer {
  private next = 0;
  constructor(private readonly ms: number) {}
  async wait(): Promise<void> {
    const now = Date.now();
    const at = Math.max(now, this.next);
    this.next = at + this.ms;
    if (at > now) await new Promise((r) => setTimeout(r, at - now));
  }
}

class HttpError extends Error {
  constructor(readonly status: number) {
    super(`HTTP ${status}`);
  }
}

function makeGetJson(opts: HttpOptions) {
  const pacer = new Pacer(opts.paceMs);
  const fetchImpl = opts.fetch ?? fetch;
  const once = async (url: string): Promise<unknown> => {
    await pacer.wait();
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), opts.timeoutMs);
    try {
      const res = await fetchImpl(url, {
        headers: {
          accept: 'application/json',
          'user-agent': 'it2810-project2-import/1.0 (student project; metadata only)',
        },
        signal: ctrl.signal,
      });
      if (!res.ok) {
        await res.body?.cancel().catch(() => {});
        throw new HttpError(res.status);
      }
      return await res.json();
    } finally {
      clearTimeout(timer);
    }
  };
  return async (url: string): Promise<unknown> => {
    try {
      return await once(url);
    } catch (err) {
      // Retry én gang for det som kan gå over av seg selv: 5xx, 429, timeout og nettverksfeil.
      // 404 og andre 4xx er endelige svar.
      const retryable = !(err instanceof HttpError) || err.status >= 500 || err.status === 429;
      if (!retryable) throw err;
      await new Promise((r) => setTimeout(r, opts.retryDelayMs));
      return once(url);
    }
  };
}

// --- Import -------------------------------------------------------------------------------

export interface ImportSummary {
  scanned: number;
  unlawful: number;
  unlinked: number;
  duplicates: number;
  noFile: number;
  failed: number;
  imported: number;
}

export interface ImportOptions {
  pool: Pool;
  archiveUrl?: string;
  /** Stopp innsamlingen når så mange koblede kandidater er funnet (til testing). */
  limit?: number;
  concurrency?: number;
  paceMs?: number;
  timeoutMs?: number;
  retryDelayMs?: number;
  pageSize?: number;
  fetch?: typeof fetch;
  /**
   * Første Ctrl+C: slutt å lete etter nye kandidater, men lagre dem som allerede er koblet.
   * Leses mellom elementene, så et pågående Scrape-kall får fullføre.
   */
  stopCollecting?: { aborted: boolean };
  /** Andre Ctrl+C: avbryt alt, også lagringen. Leses mellom kandidatene. */
  signal?: { aborted: boolean };
  log?: (msg: string) => void;
}

interface Candidate {
  item: ArchiveItem;
  link: Link;
}

export async function importArchive(opts: ImportOptions): Promise<ImportSummary> {
  const { pool } = opts;
  const base = (opts.archiveUrl ?? config.archiveUrl).replace(/\/+$/, '');
  const log = opts.log ?? (() => {});
  const getJson = makeGetJson({
    fetch: opts.fetch,
    timeoutMs: opts.timeoutMs ?? 20_000,
    paceMs: opts.paceMs ?? 150,
    retryDelayMs: opts.retryDelayMs ?? 1000,
  });
  const summary: ImportSummary = {
    scanned: 0,
    unlawful: 0,
    unlinked: 0,
    duplicates: 0,
    noFile: 0,
    failed: 0,
    imported: 0,
  };

  // Alle filmer i minnet er billigere enn ett DB-kall per kandidat (normaliseringen skjer i JS).
  const { rows: movieRows } = await pool.query<{
    id: string;
    primary_title: string;
    original_title: string;
    start_year: number | null;
  }>("SELECT id, primary_title, original_title, start_year FROM titles WHERE title_type = 'movie'");
  const titles = buildTitleIndex(movieRows);

  // Utfall per IMDb-tittel. Tellerne i summary utledes herfra til slutt, slik at en tittel som
  // lagres to ganger (se «IMDb-ID slår tittelkobling» under) bare telles én gang.
  const outcome = new Map<string, 'imported' | 'noFile' | 'failed'>();
  let processed = 0;

  // Henter filliste per koblet kandidat og lagrer. Kjøres per Scrape-side, så en lang skanning
  // (10-30 min mot hele Archive) ikke mister alt ved avbrudd eller feil underveis.
  const store = async (list: Candidate[]) => {
    let next = 0;
    const worker = async () => {
      while (!opts.signal?.aborted) {
        const cand = list[next++];
        if (!cand) return;
        const id = cand.item.identifier;
        const titleId = cand.link.titleId;
        try {
          const meta = (await getJson(`${base}/metadata/${encodeURIComponent(id)}`)) as {
            files?: unknown;
          } | null;
          const chosen = chooseFiles(meta?.files);
          if (!chosen) {
            outcome.set(titleId, 'noFile');
            log(`Hopper over ${id}: ingen spillbar fil.`);
          } else {
            await upsert(pool, cand, chosen);
            outcome.set(titleId, 'imported');
          }
        } catch (err) {
          outcome.set(titleId, 'failed');
          log(`Feilet for ${id}: ${(err as Error).message}`);
        }
        if (++processed % 25 === 0) log(`${processed} kandidater behandlet.`);
      }
    };
    await Promise.all(Array.from({ length: opts.concurrency ?? 4 }, worker));
  };

  // Samle kandidater fra Scrape API (billig: 1000 per kall), koble dem og lagre side for side.
  // Flere Archive-elementer for samme film: IMDb-ID slår tittelkobling, ellers vinner det første,
  // så en ny kjøring gir samme utfall. Kommer IMDb-treffet først på en senere side, upsertes det
  // over tittelkoblingen som allerede er lagret.
  const claimed = new Map<string, Candidate>();
  let cursor: string | undefined;
  let stop = false;
  do {
    if (opts.signal?.aborted || opts.stopCollecting?.aborted) break;
    const url = new URL(`${base}/services/search/v1/scrape`);
    url.searchParams.set('q', CANDIDATE_QUERY);
    url.searchParams.set('fields', SCRAPE_FIELDS);
    url.searchParams.set('count', String(opts.pageSize ?? 1000));
    if (cursor) url.searchParams.set('cursor', cursor);
    const page = (await getJson(url.toString())) as { items?: unknown; cursor?: unknown };
    const items = Array.isArray(page.items) ? (page.items as ArchiveItem[]) : [];

    // Én spørring per side for IMDb-ID-ene, i stedet for ett per element.
    const wanted = [
      ...new Set(items.map((i) => extractImdbId(i['external-identifier'])).filter((x) => x)),
    ] as string[];
    const existing = new Set<string>();
    if (wanted.length > 0) {
      const { rows } = await pool.query<{ id: string }>(
        'SELECT id FROM titles WHERE id = ANY($1::text[])',
        [wanted],
      );
      for (const r of rows) existing.add(r.id);
    }

    // Nye eller erstattede kandidater fra denne siden; lagres når siden er ferdig.
    const fresh = new Map<string, Candidate>();
    for (const item of items) {
      if (opts.signal?.aborted) {
        stop = true;
        break;
      }
      if (opts.stopCollecting?.aborted) {
        stop = true;
        log(
          `Avbrutt: lagrer ${fresh.size} filmer som allerede er funnet. ` +
            'Trykk Ctrl+C igjen for å avbryte helt.',
        );
        break;
      }
      summary.scanned++;
      if (typeof item.identifier !== 'string' || !isSafeArchiveId(item.identifier)) continue;
      if (!isLawful(item)) {
        summary.unlawful++;
        continue;
      }
      const link = linkItem(item, { hasId: (id) => existing.has(id), titles });
      if (!link) {
        summary.unlinked++;
        continue;
      }
      const prev = claimed.get(link.titleId);
      if (!prev || (prev.link.via === 'title' && link.via === 'imdb')) {
        const cand = { item, link };
        claimed.set(link.titleId, cand);
        fresh.set(link.titleId, cand);
      }
      if (prev) summary.duplicates++;
      if (opts.limit !== undefined && claimed.size >= opts.limit) {
        stop = true;
        break;
      }
    }
    await store([...fresh.values()]);
    cursor =
      typeof page.cursor === 'string' && page.cursor && items.length > 0 ? page.cursor : undefined;
    log(`Skannet ${summary.scanned} elementer, ${claimed.size} koblet til IMDb-titler.`);
  } while (cursor && !stop);

  for (const o of outcome.values()) {
    if (o === 'imported') summary.imported++;
    else if (o === 'noFile') summary.noFile++;
    else summary.failed++;
  }
  return summary;
}

async function upsert(pool: Pool, cand: Candidate, chosen: ChosenFile): Promise<void> {
  await pool.query(
    `INSERT INTO title_streams
       (title_id, archive_id, file_name, license, license_url, duration_seconds, subtitles_file)
     VALUES ($1, $2, $3, $4, $5, $6, $7)
     ON CONFLICT (title_id) DO UPDATE SET
       archive_id = EXCLUDED.archive_id, file_name = EXCLUDED.file_name,
       license = EXCLUDED.license, license_url = EXCLUDED.license_url,
       duration_seconds = EXCLUDED.duration_seconds, subtitles_file = EXCLUDED.subtitles_file,
       imported_at = now()`,
    [
      cand.link.titleId,
      cand.item.identifier,
      chosen.fileName,
      licenseLabel(cand.item),
      licenseLink(cand.item),
      chosen.durationSeconds,
      chosen.subtitlesFile,
    ],
  );
}

async function main() {
  const arg = process.argv.indexOf('--limit');
  const limitText = arg >= 0 ? process.argv[arg + 1] : process.env.ARCHIVE_LIMIT;
  const limit = Number.parseInt(limitText ?? '', 10) || undefined;
  const pool = createPool(config.databaseUrl);
  // To trinn: første Ctrl+C stopper skanningen men lagrer det som er funnet, andre avbryter helt.
  const stopCollecting = { aborted: false };
  const signal = { aborted: false };
  process.on('SIGINT', () => {
    if (!stopCollecting.aborted) {
      console.log('\nStopper skanningen etter pågående kall …');
      stopCollecting.aborted = true;
    } else {
      console.log('\nAvbryter etter pågående kall …');
      signal.aborted = true;
    }
  });
  console.log(`Henter fra ${config.archiveUrl}${limit ? ` (maks ${limit} titler)` : ''}`);
  try {
    const s = await importArchive({
      pool,
      ...(limit ? { limit } : {}),
      stopCollecting,
      signal,
      log: console.log,
    });
    console.log(
      `Ferdig: ${s.imported} lagret, ${s.unlawful} uten fri lisens, ${s.unlinked} uten IMDb-kobling, ` +
        `${s.duplicates} duplikater, ${s.noFile} uten spillbar fil, ${s.failed} feilet (av ${s.scanned} skannet).`,
    );
    if (s.failed > 0) process.exitCode = 1;
  } finally {
    await pool.end();
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((err) => {
    console.error(err instanceof Error ? err.message : err);
    process.exit(1);
  });
}
