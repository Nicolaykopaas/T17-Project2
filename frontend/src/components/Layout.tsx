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

  // Etter navigasjon flyttes fokus til sidens h1, slik at skjermleseren leser opp hvor man er i stedet for
  // å starte på «hovedinnhold». h1 finnes ofte ikke med en gang (lazy-lastet side) eller byttes ut når data
  // er hentet («Laster …» → tittelen), så vi følger med på innholdet en liten stund og flytter fokus til
  // gjeldende h1 så lenge brukeren ikke selv har flyttet det. Uten h1 står fokus på <main>.
  // Unntak: skriver brukeren i søkefeltet mens søket sender henne til forsiden, må fokus bli der.
  useEffect(() => {
    if (first.current) {
      first.current = false;
      return;
    }
    if (document.activeElement?.closest('[role="search"]')) return;
    const el = main.current;
    if (!el) return;

    let focused: HTMLElement = el;
    const focusTarget = () => {
      const h1 = el.querySelector('h1');
      if (h1 && !h1.hasAttribute('tabindex')) h1.tabIndex = -1;
      focused = h1 ?? el;
      focused.focus({ preventScroll: true });
    };
    focusTarget();

    const observer = new MutationObserver(() => {
      const active = document.activeElement;
      // Fokus er «mistet» (elementet ble fjernet) eller står der vi la det; ellers har brukeren flyttet det.
      if (active === document.body || active === el || active === focused) focusTarget();
      else observer.disconnect();
    });
    observer.observe(el, { childList: true, subtree: true });
    // Gi opp etter en stund så innhold som dukker opp lenge etter ikke stjeler fokus.
    const giveUp = window.setTimeout(() => observer.disconnect(), 3000);
    return () => {
      observer.disconnect();
      window.clearTimeout(giveUp);
    };
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
