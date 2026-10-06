import { Suspense, useEffect, useRef, type MouseEvent } from 'react';
import { Link, NavLink, Outlet, ScrollRestoration, useLocation } from 'react-router';
import { useScrolled } from '../hooks/useScrolled';
import { ApiUnavailableBanner } from './ApiUnavailableBanner';
import { HeaderSearch } from './HeaderSearch';

export function Layout() {
  const main = useRef<HTMLElement>(null);
  const { pathname } = useLocation();
  const first = useRef(true);
  const scrolled = useScrolled();

  // Etter navigasjon flyttes fokus til innholdet, ellers blir tastatur- og skjermleserbrukere stående i menyen.
  // Unntak: skriver brukeren i søkefeltet mens søket sender henne til forsiden, må fokus bli der.
  useEffect(() => {
    if (first.current) {
      first.current = false;
      return;
    }
    if (document.activeElement?.closest('[role="search"]')) return;
    main.current?.focus({ preventScroll: true });
  }, [pathname]);

  const skip = (e: MouseEvent) => {
    e.preventDefault();
    main.current?.focus();
  };

  return (
    <>
      <a href="#innhold" className="skip-link" onClick={skip}>
        Hopp til innhold
      </a>
      <header className={`site-header${scrolled ? ' is-scrolled' : ''}`}>
        <div className="container site-header__inner">
          <Link to="/" className="brand">
            Film<span>søk</span>
          </Link>
          <nav aria-label="Hovedmeny">
            <ul>
              <li>
                <NavLink to="/" end>
                  Søk
                </NavLink>
              </li>
              <li>
                <NavLink to="/my-list">Min liste</NavLink>
              </li>
            </ul>
          </nav>
          <HeaderSearch />
        </div>
      </header>
      <ApiUnavailableBanner />
      <main id="innhold" ref={main} tabIndex={-1}>
        <Suspense fallback={<p role="status">Laster …</p>}>
          <Outlet />
        </Suspense>
      </main>
      <footer className="site-footer">
        <div className="container">
          <p>Data fra IMDb. IT2810 gruppe 17.</p>
          <p>
            Bilder og beskrivelser fra{' '}
            <a href="https://www.themoviedb.org/" target="_blank" rel="noopener noreferrer">
              TMDB<span className="sr-only"> (åpnes i ny fane)</span>
            </a>
            . Dette produktet bruker TMDB-API-et, men er ikke godkjent eller sertifisert av TMDB.
          </p>
        </div>
      </footer>
      <ScrollRestoration />
    </>
  );
}
