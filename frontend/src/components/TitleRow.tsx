import {
  useCallback,
  useDeferredValue,
  useEffect,
  useId,
  useRef,
  useState,
  type KeyboardEvent,
} from 'react';
import { Link } from 'react-router';
import { useApiUnavailable } from '../apollo/apiStatus';
import type { TitleSummary } from '../graphql/types';
import { ErrorMessage } from './ErrorMessage';
import { PosterCard } from './PosterCard';
import { PosterSkeleton } from './PosterSkeleton';

interface Props {
  heading: string;
  /** Hvor «Se alle» går (søkemodus med tilsvarende filtre/sortering). */
  seeAllTo: string;
  titles: TitleSummary[] | undefined;
  loading: boolean;
  error?: boolean;
  onRetry?: () => void;
}

const prefersReducedMotion = () =>
  typeof window.matchMedia === 'function' &&
  window.matchMedia('(prefers-reduced-motion: reduce)').matches;

/** Horisontal rad med plakater: scroll-snap, pil-knapper og piltaster mellom kortene. */
export function TitleRow({ heading, seeAllTo, titles: latest, loading, error, onRetry }: Props) {
  // Kortene tegnes i en avbrytbar, tidsdelt rendering (ikke i den samme lange oppgaven som mottar dataene),
  // så radene ikke blokkerer input like etter første maling. Skjelettet står til kortene er klare.
  const titles = useDeferredValue(latest);
  const headingId = useId();
  const apiDown = useApiUnavailable();
  const list = useRef<HTMLUListElement>(null);
  const [canPrev, setCanPrev] = useState(false);
  const [canNext, setCanNext] = useState(false);

  const measure = useCallback(() => {
    const el = list.current;
    if (!el) return;
    // 1 px slingringsmonn: subpiksel-scroll gjør at scrollLeft sjelden treffer kanten nøyaktig.
    setCanPrev(el.scrollLeft > 1);
    setCanNext(el.scrollLeft + el.clientWidth < el.scrollWidth - 1);
  }, []);

  useEffect(() => {
    const el = list.current;
    if (!el) return;
    measure();
    el.addEventListener('scroll', measure, { passive: true });
    const observer = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(measure);
    observer?.observe(el);
    return () => {
      el.removeEventListener('scroll', measure);
      observer?.disconnect();
    };
  }, [measure, titles]);

  const scrollByPage = (direction: 1 | -1) => {
    const el = list.current;
    if (!el) return;
    el.scrollBy({
      left: direction * el.clientWidth * 0.85,
      behavior: prefersReducedMotion() ? 'auto' : 'smooth',
    });
  };

  // Piltaster flytter fokus mellom kortenes lenker; nettleseren scroller det fokuserte kortet inn i bildet.
  const onKeyDown = (e: KeyboardEvent<HTMLUListElement>) => {
    if (e.key !== 'ArrowRight' && e.key !== 'ArrowLeft') return;
    const links = [...e.currentTarget.querySelectorAll<HTMLAnchorElement>('.poster__title a')];
    const index = links.indexOf(document.activeElement as HTMLAnchorElement);
    if (index === -1) return;
    const next = links[index + (e.key === 'ArrowRight' ? 1 : -1)];
    if (next) {
      e.preventDefault();
      next.focus();
    }
  };

  if (!loading && !error && titles?.length === 0) return null;

  return (
    <section className="row" aria-labelledby={headingId} aria-busy={loading}>
      <div className="row__head container">
        <h2 id={headingId}>{heading}</h2>
        <Link to={seeAllTo} className="row__all">
          Se alle <span className="sr-only">i {heading}</span>
        </Link>
      </div>

      {/* Ved nedetid kunngjør det globale banneret feilen; hver rad skal ikke gjenta den. */}
      {error && !titles && !apiDown && (
        <div className="container">
          <ErrorMessage message="Kunne ikke hente denne raden." onRetry={onRetry} />
        </div>
      )}
      {!titles && (!error || apiDown) && <PosterSkeleton />}

      {titles && (
        <div className="row__viewport">
          {canPrev && (
            <button
              type="button"
              className="row__nav row__nav--prev"
              aria-label={`Forrige i ${heading}`}
              onClick={() => scrollByPage(-1)}
            >
              <span aria-hidden="true">‹</span>
            </button>
          )}
          {/* Piltastene er en forbedring; lenkene i kortene er de interaktive elementene og kan tabbes til. */}
          {/* eslint-disable-next-line jsx-a11y/no-noninteractive-element-interactions */}
          <ul className="row__list" ref={list} onKeyDown={onKeyDown}>
            {titles.map((title) => (
              <PosterCard key={title.id} title={title} />
            ))}
          </ul>
          {canNext && (
            <button
              type="button"
              className="row__nav row__nav--next"
              aria-label={`Neste i ${heading}`}
              onClick={() => scrollByPage(1)}
            >
              <span aria-hidden="true">›</span>
            </button>
          )}
        </div>
      )}
    </section>
  );
}
