import { describe, expect, it } from 'vitest';
import { formatClock, hueFromId, truncate } from './format';

describe('hueFromId', () => {
  it('er deterministisk og innenfor 0–359', () => {
    expect(hueFromId('tt0111161')).toBe(hueFromId('tt0111161'));
    for (const id of ['', 'a', 'tt0000001', 'x'.repeat(5000)]) {
      const h = hueFromId(id);
      expect(h).toBeGreaterThanOrEqual(0);
      expect(h).toBeLessThan(360);
    }
  });
});

describe('truncate', () => {
  it('lar korte tekster være', () => {
    expect(truncate('Kort tekst', 50)).toBe('Kort tekst');
  });
  it('kutter ved ordgrense og legger på ellipse', () => {
    const text = 'ord '.repeat(100).trim();
    const out = truncate(text, 100);
    expect(out.endsWith('ord…')).toBe(true);
    expect(out.length).toBeLessThanOrEqual(101);
  });
  it('tåler én lang streng uten mellomrom', () => {
    expect(truncate('x'.repeat(500), 100)).toBe('x'.repeat(100) + '…');
  });
});

describe('formatClock', () => {
  it('bruker m:ss under en time og h:mm:ss over', () => {
    expect(formatClock(0)).toBe('0:00');
    expect(formatClock(9.9)).toBe('0:09');
    expect(formatClock(723)).toBe('12:03');
    expect(formatClock(5530)).toBe('1:32:10');
    expect(formatClock(3600)).toBe('1:00:00');
  });
  it('tåler NaN, Infinity og negative tall (ukjent varighet)', () => {
    for (const bad of [NaN, Infinity, -Infinity, -5]) expect(formatClock(bad)).toBe('0:00');
  });
});
