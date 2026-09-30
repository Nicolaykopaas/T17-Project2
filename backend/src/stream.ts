import { config } from './config.js';
import type { Pool } from './db.js';
import { batchLoader } from './loaders.js';

export interface StreamRow {
  title_id: string;
  archive_id: string;
  file_name: string;
  license: string;
  license_url: string | null;
  duration_seconds: number | null;
  subtitles_file: string | null;
}

export interface Stream {
  url: string;
  archiveUrl: string;
  license: string;
  licenseUrl: string | null;
  durationSeconds: number | null;
  subtitlesUrl: string | null;
}

// Verdiene havner i URL-er klienten laster og spiller. Databasen er vår egen, men importen leser
// fra en tredjepart, så vi validerer også ved bruk: en ødelagt rad skal gi «ingen stream», ikke
// en URL som peker et annet sted enn archive.org/download/<id>/<fil>.
const ARCHIVE_ID = /^[A-Za-z0-9._-]+$/;

export function isSafeArchiveId(id: string): boolean {
  // «.» og «..» består tegnsjekken, men er stisegmenter.
  return ARCHIVE_ID.test(id) && !id.includes('..') && id !== '.';
}

export function isSafeFileName(name: string): boolean {
  if (name.length === 0 || name.length > 255) return false;
  if (name.includes('/') || name.includes('\\') || name.includes('..')) return false;
  for (const ch of name) {
    const c = ch.charCodeAt(0);
    if (c < 32 || c === 127) return false;
  }
  return true;
}

function safeHttpUrl(value: string | null): string | null {
  if (!value) return null;
  try {
    const u = new URL(value);
    return u.protocol === 'http:' || u.protocol === 'https:' ? u.href : null;
  } catch {
    return null;
  }
}

export function buildStream(row: StreamRow, archiveUrl: string = config.archiveUrl): Stream | null {
  if (!isSafeArchiveId(row.archive_id) || !isSafeFileName(row.file_name)) return null;
  const base = archiveUrl.replace(/\/+$/, '');
  const file = (name: string) => `${base}/download/${row.archive_id}/${encodeURIComponent(name)}`;
  return {
    url: file(row.file_name),
    archiveUrl: `${base}/details/${row.archive_id}`,
    license: row.license,
    licenseUrl: safeHttpUrl(row.license_url),
    durationSeconds: row.duration_seconds,
    subtitlesUrl:
      row.subtitles_file && isSafeFileName(row.subtitles_file) ? file(row.subtitles_file) : null,
  };
}

/** Per-request-loader: én spørring for hele resultatsiden (PK-oppslag), ikke én per tittel. */
export function createStreamLoader(pool: Pool, archiveUrl: string) {
  return batchLoader<Stream | null>(async (ids) => {
    const { rows } = await pool.query<StreamRow>(
      `SELECT title_id, archive_id, file_name, license, license_url, duration_seconds, subtitles_file
       FROM title_streams WHERE title_id = ANY($1::text[])`,
      [ids],
    );
    return new Map(rows.map((r) => [r.title_id, buildStream(r, archiveUrl)]));
  }, null);
}

export type StreamLoader = ReturnType<typeof createStreamLoader>;
