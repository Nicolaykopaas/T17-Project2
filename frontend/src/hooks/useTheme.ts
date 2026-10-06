import { useCallback, useEffect, useState } from 'react';
import { LIGHT_QUERY, loadTheme, saveTheme, systemTheme, type Theme } from '../lib/theme';

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

  const theme = chosen ?? system;

  const toggle = useCallback(() => {
    const next: Theme = theme === 'dark' ? 'light' : 'dark';
    document.documentElement.dataset.theme = next;
    saveTheme(next);
    setChosen(next);
  }, [theme]);

  return { theme, toggle };
}
