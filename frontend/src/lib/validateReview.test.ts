import { describe, expect, it } from 'vitest';
import { MAX_AUTHOR, MAX_TEXT, charLength, validateReview } from './validateReview';

const draft = (patch: Partial<Parameters<typeof validateReview>[0]> = {}) => ({
  author: 'Kari',
  rating: 4,
  text: '',
  ...patch,
});

describe('charLength', () => {
  it('teller kodepunkter, ikke UTF-16-enheter', () => {
    expect(charLength('abc')).toBe(3);
    expect('😀'.length).toBe(2);
    expect(charLength('😀')).toBe(1);
    expect(charLength('')).toBe(0);
  });
});

describe('validateReview', () => {
  it('godtar nøyaktig 2000 emoji (4000 UTF-16-enheter), slik som API-et', () => {
    expect(validateReview(draft({ text: '😀'.repeat(MAX_TEXT) }))).toEqual({});
  });

  it('avviser 2001 emoji og oppgir riktig antall å fjerne', () => {
    expect(validateReview(draft({ text: '😀'.repeat(MAX_TEXT + 1) })).text).toContain(
      'Fjern 1 tegn',
    );
  });

  it('teller trimmet tekst, siden det er den som sendes', () => {
    expect(validateReview(draft({ text: `  ${'x'.repeat(MAX_TEXT)}  ` }))).toEqual({});
  });

  it('godtar et navn på 50 emoji, men avviser 51', () => {
    expect(validateReview(draft({ author: '😀'.repeat(MAX_AUTHOR) }))).toEqual({});
    expect(validateReview(draft({ author: '😀'.repeat(MAX_AUTHOR + 1) })).author).toMatch(/maks/);
  });
});
