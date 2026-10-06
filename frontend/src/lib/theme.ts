export type Theme = 'light' | 'dark';

/** Samme nøkkel som det innebygde skriptet i index.html (som setter temaet før React starter). */
export const THEME_KEY = 'filmsok:theme';

const isTheme = (v: unknown): v is Theme => v === 'light' || v === 'dark';

/** localStorage kan kaste (blokkert av nettleseren) eller inneholde rusk; da følger vi systemet. */
export function loadTheme(): Theme | null {
  try {
    const raw = localStorage.getItem(THEME_KEY);
    return isTheme(raw) ? raw : null;
  } catch {
    return null;
  }
}

export function saveTheme(theme: Theme) {
  try {
    localStorage.setItem(THEME_KEY, theme);
  } catch {
    // Å huske temaet er en bekvemmelighet; valget gjelder uansett resten av økten.
  }
}

export const LIGHT_QUERY = '(prefers-color-scheme: light)';

/** Mørkt er standard i CSS; systemet gir lyst bare når nettleseren eksplisitt ber om det. */
export function systemTheme(): Theme {
  return typeof window.matchMedia === 'function' && window.matchMedia(LIGHT_QUERY).matches
    ? 'light'
    : 'dark';
}
