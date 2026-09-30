import { useEffect } from 'react';

/** Unik sidetittel per side hjelper skjermlesere å orientere seg etter navigasjon. */
export function useDocumentTitle(title: string) {
  useEffect(() => {
    document.title = `${title} – Filmsøk`;
  }, [title]);
}
