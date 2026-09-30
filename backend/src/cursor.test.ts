import { describe, expect, it } from 'vitest';
import { decodeCursor, encodeCursor, type KeyDef } from './keyset.js';

const keys: KeyDef[] = [
  { expr: 'a', cast: 'int', kind: 'int' },
  { expr: 'b', cast: 'float8', kind: 'float' },
  { expr: 'id', cast: 'text', kind: 'text' },
];

describe('cursor', () => {
  it('rundtur bevarer verdiene', () => {
    const c = encodeCursor('S', [5, 0.3333333432674408, 'tt1']);
    expect(decodeCursor(c, 'S', keys)).toEqual([5, 0.3333333432674408, 'tt1']);
  });

  it('er base64url uten spesialtegn', () => {
    expect(encodeCursor('S', [1, 2, 'æøå🎬'])).toMatch(/^[A-Za-z0-9_-]+$/);
  });

  it.each([
    ['tom streng', ''],
    ['ikke base64/JSON', '%%%%'],
    ['gyldig base64, ikke JSON', Buffer.from('hei').toString('base64url')],
    ['JSON null', Buffer.from('null').toString('base64url')],
    ['mangler felt', Buffer.from('{}').toString('base64url')],
    ['feil signatur', encodeCursor('ANNEN', [1, 2, 'x'])],
    ['feil antall verdier', encodeCursor('S', [1, 2])],
    ['feil type (streng i stedet for tall)', encodeCursor('S', ['1', 2, 'x'])],
    ['desimaltall i heltallsnøkkel', encodeCursor('S', [1.5, 2, 'x'])],
    ['heltall utenfor int32', encodeCursor('S', [2 ** 40, 2, 'x'])],
    ['tall i tekstnøkkel', encodeCursor('S', [1, 2, 7])],
    ['for lang cursor', 'A'.repeat(5000)],
  ])('avviser %s', (_navn, cursor) => {
    expect(() => decodeCursor(cursor, 'S', keys)).toThrowError(/cursor/i);
  });

  it('avviser tekst som ikke matcher formatkravet', () => {
    const k: KeyDef[] = [{ expr: 't', cast: 'timestamptz', kind: 'text', pattern: /^\d+$/ }];
    expect(() => decodeCursor(encodeCursor('S', ['abc']), 'S', k)).toThrow();
    expect(decodeCursor(encodeCursor('S', ['123']), 'S', k)).toEqual(['123']);
  });
});
