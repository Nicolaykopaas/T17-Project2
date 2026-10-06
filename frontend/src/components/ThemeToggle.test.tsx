import { act, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { THEME_KEY } from '../lib/theme';
import { ThemeToggle } from './ThemeToggle';

/** jsdom har ingen matchMedia; stubben lar testen bestemme systemets tema og skifte det. */
function stubSystem(initial: 'light' | 'dark') {
  let matches = initial === 'light';
  const listeners = new Set<() => void>();
  vi.stubGlobal('matchMedia', () => ({
    get matches() {
      return matches;
    },
    addEventListener: (_: string, cb: () => void) => listeners.add(cb),
    removeEventListener: (_: string, cb: () => void) => listeners.delete(cb),
  }));
  return (next: 'light' | 'dark') => {
    matches = next === 'light';
    act(() => listeners.forEach((cb) => cb()));
  };
}

const button = () => screen.getByRole('button', { name: 'Mørkt tema' });

function addThemeColorMetas() {
  const defaults = { light: '#f5f4f1', dark: '#0a0a0c' };
  for (const scheme of ['light', 'dark'] as const) {
    const meta = document.createElement('meta');
    meta.name = 'theme-color';
    meta.media = `(prefers-color-scheme: ${scheme})`;
    meta.content = defaults[scheme];
    document.head.append(meta);
  }
}
const themeColors = () =>
  [...document.querySelectorAll<HTMLMetaElement>('meta[name="theme-color"]')].map((m) => m.content);

beforeEach(() => {
  localStorage.clear();
  delete document.documentElement.dataset.theme;
});
afterEach(() => {
  document.querySelectorAll('meta[name="theme-color"]').forEach((m) => m.remove());
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('ThemeToggle', () => {
  it('har fast navn og aria-pressed som speiler systemets tema når intet er valgt', () => {
    stubSystem('dark');
    render(<ThemeToggle />);
    expect(button()).toHaveAttribute('aria-pressed', 'true');
    // Uten eksplisitt valg lar vi CSS (prefers-color-scheme) bestemme.
    expect(document.documentElement).not.toHaveAttribute('data-theme');
  });

  it('er av for et lyst system', () => {
    stubSystem('light');
    render(<ThemeToggle />);
    expect(button()).toHaveAttribute('aria-pressed', 'false');
  });

  it('bytter tema, setter data-theme på html og husker valget', async () => {
    stubSystem('dark');
    const user = userEvent.setup();
    render(<ThemeToggle />);

    await user.click(button());
    expect(document.documentElement).toHaveAttribute('data-theme', 'light');
    expect(button()).toHaveAttribute('aria-pressed', 'false');
    expect(localStorage.getItem(THEME_KEY)).toBe('light');

    await user.click(button());
    expect(document.documentElement).toHaveAttribute('data-theme', 'dark');
    expect(button()).toHaveAttribute('aria-pressed', 'true');
    expect(localStorage.getItem(THEME_KEY)).toBe('dark');
  });

  it('oppdaterer begge theme-color-taggene ved valgt tema', async () => {
    stubSystem('dark');
    addThemeColorMetas();
    const user = userEvent.setup();
    render(<ThemeToggle />);
    expect(themeColors()).toEqual(['#f5f4f1', '#0a0a0c']);
    await user.click(button());
    expect(themeColors()).toEqual(['#f5f4f1', '#f5f4f1']);
    await user.click(button());
    expect(themeColors()).toEqual(['#0a0a0c', '#0a0a0c']);
  });

  it('kan betjenes med tastatur', async () => {
    stubSystem('dark');
    const user = userEvent.setup();
    render(<ThemeToggle />);
    await user.tab();
    expect(button()).toHaveFocus();
    await user.keyboard('{Enter}');
    expect(document.documentElement).toHaveAttribute('data-theme', 'light');
    await user.keyboard(' ');
    expect(document.documentElement).toHaveAttribute('data-theme', 'dark');
  });

  it('bruker lagret valg framfor systemet', () => {
    stubSystem('dark');
    localStorage.setItem(THEME_KEY, 'light');
    render(<ThemeToggle />);
    expect(button()).toHaveAttribute('aria-pressed', 'false');
  });

  it('ignorerer ugyldig lagret verdi', () => {
    stubSystem('light');
    localStorage.setItem(THEME_KEY, 'neon');
    render(<ThemeToggle />);
    expect(button()).toHaveAttribute('aria-pressed', 'false');
  });

  it('følger systemet når det skifter, så lenge brukeren ikke har valgt', () => {
    const setSystem = stubSystem('dark');
    render(<ThemeToggle />);
    setSystem('light');
    expect(button()).toHaveAttribute('aria-pressed', 'false');
  });

  it('virker selv om localStorage kaster', async () => {
    stubSystem('dark');
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
      throw new Error('blokkert');
    });
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new Error('blokkert');
    });
    const user = userEvent.setup();
    render(<ThemeToggle />);
    await user.click(button());
    expect(document.documentElement).toHaveAttribute('data-theme', 'light');
    expect(button()).toHaveAttribute('aria-pressed', 'false');
  });

  it('synkroniseres når valget endres i en annen fane (storage-event)', () => {
    stubSystem('dark');
    render(<ThemeToggle />);
    expect(button()).toHaveAttribute('aria-pressed', 'true');
    localStorage.setItem(THEME_KEY, 'light');
    act(() => {
      window.dispatchEvent(new StorageEvent('storage', { key: THEME_KEY, newValue: 'light' }));
    });
    expect(button()).toHaveAttribute('aria-pressed', 'false');
    expect(document.documentElement).toHaveAttribute('data-theme', 'light');
  });

  it('ignorerer storage-events for andre nøkler', () => {
    stubSystem('dark');
    render(<ThemeToggle />);
    localStorage.setItem(THEME_KEY, 'light');
    act(() => {
      window.dispatchEvent(new StorageEvent('storage', { key: 'noe-annet' }));
    });
    expect(button()).toHaveAttribute('aria-pressed', 'true');
  });

  it('har ikke title som dupliserer navnet', () => {
    stubSystem('dark');
    render(<ThemeToggle />);
    expect(button()).not.toHaveAttribute('title');
  });
});
