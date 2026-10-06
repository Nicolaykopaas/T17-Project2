import { useCallback, useEffect, useState } from 'react';
import {
  LIGHT_QUERY,
  THEME_KEY,
  loadTheme,
  saveTheme,
  systemTheme,
  type Theme,
} from '../lib/theme';

/**
 * Brukerens temavalg, ellers systemets. `data-theme` på <html> settes bare etter et eksplisitt valg;
 * uten det avgjør `prefers-color-scheme` i CSS, og et skifte i systemet følges også mens siden er åpen.
 */
export function useTheme() {
  const [chosen, setChosen] = useState<Theme | null>(loadTheme);
  const [system, setSystem] = useState<Theme>(systemTheme);

  useEffect(() => {
    if (typeof window.matchMedia !== 'function') return;
    const query = window.matchMedia(LIGHT_QUERY);
    const onChange = () => setSystem(query.matches ? 'light' : 'dark');
    query.addEventListener('change', onChange);
    return () => query.removeEventListener('change', onChange);
  }, []);

  // Valg i en annen fane: `storage` utløses bare i de andre fanene, så vi holder alle i synk.
  useEffect(() => {
    const onStorage = (e: StorageEvent) => {
      if (e.key !== null && e.key !== THEME_KEY) return;
      const next = loadTheme();
      if (next) document.documentElement.dataset.theme = next;
      else delete document.documentElement.dataset.theme;
      setChosen(next);
    };
    window.addEventListener('storage', onStorage);
    return () => window.removeEventListener('storage', onStorage);
  }, []);

  const theme = chosen ?? system;

  const toggle = useCallback(() => {
    const next: Theme = theme === 'dark' ? 'light' : 'dark';
    document.documentElement.dataset.theme = next;
    saveTheme(next);
    setChosen(next);
  }, [theme]);

  return { theme, toggle };
}
