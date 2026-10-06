export type Theme = 'light' | 'dark';

/** Samme nøkkel som public/theme-init.js, som setter temaet før React starter. */
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

/** Samme verdier som --bg i global.css og i public/theme-init.js (som ikke går gjennom bundleren). */
const THEME_COLORS: Record<Theme, string> = { light: '#f5f4f1', dark: '#0a0a0c' };

/**
 * Setter (eller fjerner, ved null) det eksplisitte temaet på <html> og holder `theme-color` i takt.
 * index.html har én tagg per systemtema; uten dette ville et valgt tema som avviker fra systemet gitt
 * feil farge i adressefeltet på mobil.
 */
export function applyTheme(theme: Theme | null) {
  const root = document.documentElement;
  if (theme) root.dataset.theme = theme;
  else delete root.dataset.theme;
  document.querySelectorAll<HTMLMetaElement>('meta[name="theme-color"]').forEach((meta) => {
    const own: Theme = meta.media.includes('light') ? 'light' : 'dark';
    meta.content = THEME_COLORS[theme ?? own];
  });
}

export const LIGHT_QUERY = '(prefers-color-scheme: light)';

/** Mørkt er standard i CSS; systemet gir lyst bare når nettleseren eksplisitt ber om det. */
export function systemTheme(): Theme {
  return typeof window.matchMedia === 'function' && window.matchMedia(LIGHT_QUERY).matches
    ? 'light'
    : 'dark';
}
