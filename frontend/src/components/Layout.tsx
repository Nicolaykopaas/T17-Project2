import { Suspense, useEffect, useRef, type MouseEvent } from 'react';
import { NavLink, Outlet, ScrollRestoration, useLocation } from 'react-router';

export function Layout() {
  const main = useRef<HTMLElement>(null);
  const { pathname } = useLocation();
  const first = useRef(true);

  // Etter navigasjon flyttes fokus til innholdet, ellers blir tastatur- og skjermleserbrukere stående i menyen.
  useEffect(() => {
    if (first.current) {
      first.current = false;
      return;
    }
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
      <header className="site-header">
        <div className="container site-header__inner">
          <span className="brand">Filmsøk</span>
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
        </div>
      </header>
      <main id="innhold" ref={main} tabIndex={-1} className="container">
        <Suspense fallback={<p role="status">Laster …</p>}>
          <Outlet />
        </Suspense>
      </main>
      <footer className="site-footer">
        <div className="container">Data fra IMDb. IT2810 gruppe 17.</div>
      </footer>
      <ScrollRestoration />
    </>
  );
}
