import { badInput } from './errors.js';

/**
 * Keyset-paginering (cursor) på en sammensatt sorteringsnøkkel. OFFSET ville blitt tregere jo
 * lenger ned brukeren scroller og gir duplikater/hull når data endres mellom sidene.
 *
 * Alle nøkler sorteres i SAMME retning, slik at vi kan bruke radsammenligning
 * `(a, b, id) < ($1, $2, $3)`. Det lar Postgres bruke en vanlig btree-indeks på (a, b, id)
 * i stedet for en OR-kjede, og siste nøkkel er alltid unik slik at rekkefølgen er total.
 */
export interface KeyDef {
  /** SQL-uttrykk som brukes i ORDER BY og i cursor-sammenligningen. */
  expr: string;
  /** Uttrykk som leses ut til JS (f.eks. numeric -> float8, timestamptz -> text). */
  select?: string;
  /** Postgres-typen cursor-verdien castes til. */
  cast: string;
  kind: 'int' | 'float' | 'text';
  /** Ekstra formatkrav for tekstnøkler som castes til ikke-tekst (tidsstempel, bigint). */
  pattern?: RegExp;
}

export type Direction = 'ASC' | 'DESC';

export function orderBy(keys: KeyDef[], dir: Direction): string {
  return keys.map((k) => `${k.expr} ${dir}`).join(', ');
}

export function projections(keys: KeyDef[]): string {
  return keys.map((k, i) => `${k.select ?? k.expr} AS k${i}`).join(', ');
}

/** Bygger `(expr...) < (cast params...)`. `addParam` registrerer en parameter og gir `$n`. */
export function afterCondition(
  keys: KeyDef[],
  values: unknown[],
  dir: Direction,
  addParam: (v: unknown) => string,
): string {
  const op = dir === 'DESC' ? '<' : '>';
  const left = keys.map((k) => k.expr).join(', ');
  const right = keys.map((k, i) => `${addParam(values[i])}::${k.cast}`).join(', ');
  return `(${left}) ${op} (${right})`;
}

/**
 * Cursoren er base64url av JSON. `s` er en signatur (sortering + retning) slik at en cursor fra
 * én sortering avvises hvis den brukes på en annen i stedet for å gi tilfeldige resultater.
 */
export function encodeCursor(signature: string, values: unknown[]): string {
  return Buffer.from(JSON.stringify({ s: signature, v: values }), 'utf8').toString('base64url');
}

const INT32 = 2_147_483_647;

function validValue(k: KeyDef, v: unknown): boolean {
  if (k.kind === 'text') {
    return (
      typeof v === 'string' &&
      v.length <= 1000 &&
      !v.includes('\0') &&
      (k.pattern ? k.pattern.test(v) : true)
    );
  }
  if (typeof v !== 'number' || !Number.isFinite(v)) return false;
  return k.kind === 'float' || (Number.isInteger(v) && Math.abs(v) <= INT32);
}

/**
 * Dekoder og validerer en cursor. All validering gjøres i JS: en verdi Postgres ikke kan caste
 * ville ellers gitt en databasefeil (og dermed en maskert 500) i stedet for BAD_USER_INPUT.
 */
export function decodeCursor(cursor: string, signature: string, keys: KeyDef[]): unknown[] {
  const fail = () => badInput('Ugyldig cursor.');
  if (cursor.length > 2000) throw fail();
  let parsed: unknown;
  try {
    parsed = JSON.parse(Buffer.from(cursor, 'base64url').toString('utf8'));
  } catch {
    throw fail();
  }
  if (typeof parsed !== 'object' || parsed === null) throw fail();
  const { s, v } = parsed as { s?: unknown; v?: unknown };
  if (s !== signature || !Array.isArray(v) || v.length !== keys.length) throw fail();
  if (!keys.every((k, i) => validValue(k, v[i]))) throw fail();
  return v;
}

export const TIMESTAMP_PATTERN =
  /^\d{4}-\d\d-\d\d[ T]\d\d:\d\d:\d\d(\.\d{1,6})?([+-]\d\d(:?\d\d)?|Z)?$/;
export const BIGINT_PATTERN = /^\d{1,18}$/;
