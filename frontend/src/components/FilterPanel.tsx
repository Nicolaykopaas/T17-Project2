import { useId, useState } from 'react';
import { useQuery } from '@apollo/client/react';
import { FACETS_QUERY, GENRES_QUERY } from '../graphql/operations';
import type { FacetCount, TitleType } from '../graphql/types';
import { decadeLabel, formatNumber, typeLabel } from '../lib/format';
import { activeFilterCount, toFilters, type SearchState } from '../lib/searchState';

interface Props {
  state: SearchState;
  onChange: (patch: Partial<SearchState>) => void;
}

const MIN_RATINGS = [0, 5, 6, 7, 8, 9];
const TYPES: TitleType[] = ['MOVIE', 'SERIES'];

function countMap(facets: FacetCount[] | undefined) {
  return new Map((facets ?? []).map((f) => [f.value, f.count]));
}

function toggle<T>(list: T[], item: T): T[] {
  return list.includes(item) ? list.filter((x) => x !== item) : [...list, item];
}

export function FilterPanel({ state, onChange }: Props) {
  const [open, setOpen] = useState(false);
  const panelId = useId();
  const ratingId = useId();
  const count = activeFilterCount(state);

  // Fasettene telles mot søketeksten og de ANDRE filtrene (serveren står for det).
  const { data, previousData } = useQuery(FACETS_QUERY, {
    variables: { query: state.q || null, filters: toFilters(state) },
  });
  // Forrige fasetter står igjen mens nye hentes, ellers blinker og hopper filterlista.
  const facetData = data ?? previousData;
  const { data: genreData } = useQuery(GENRES_QUERY);

  const genreCounts = countMap(facetData?.facets.genres);
  const decadeCounts = countMap(facetData?.facets.decades);
  const typeCounts = countMap(facetData?.facets.types);

  // Valgte verdier vises alltid, også om fasetten ikke lenger inneholder dem.
  const genres = [
    ...new Set([
      ...(genreData?.genres ?? facetData?.facets.genres.map((g) => g.value) ?? []),
      ...state.genres,
    ]),
  ].sort((a, b) => a.localeCompare(b, 'nb'));
  const decades = [
    ...new Set([
      ...(facetData?.facets.decades.map((d) => Number(d.value)) ?? []),
      ...state.decades,
    ]),
  ].sort((a, b) => b - a);

  const suffix = (n: number | undefined) => (n === undefined ? '' : ` (${formatNumber(n)})`);

  return (
    <aside className="filters" aria-label="Filtre">
      <button
        type="button"
        className="btn filters__toggle"
        aria-expanded={open}
        aria-controls={panelId}
        onClick={() => setOpen((o) => !o)}
      >
        Filtre{count > 0 ? ` (${count})` : ''}
      </button>

      <div id={panelId} className={`filters__body${open ? ' is-open' : ''}`}>
        <label className="check check--available">
          <input
            type="checkbox"
            checked={state.available}
            onChange={() => onChange({ available: !state.available })}
          />
          <span>
            Kun filmer du kan se
            <span className="muted">
              {suffix(facetData?.facets.available ?? (facetData ? 0 : undefined))}
            </span>
          </span>
        </label>

        <fieldset>
          <legend>Type</legend>
          {TYPES.map((t) => (
            <label key={t} className="check">
              <input
                type="checkbox"
                checked={state.types.includes(t)}
                onChange={() => onChange({ types: toggle(state.types, t) })}
              />
              <span>
                {typeLabel(t)}
                <span className="muted">
                  {suffix(typeCounts.get(t) ?? (facetData ? 0 : undefined))}
                </span>
              </span>
            </label>
          ))}
        </fieldset>

        <fieldset>
          <legend>Tiår</legend>
          <div className="check-list">
            {decades.map((d) => (
              <label key={d} className="check">
                <input
                  type="checkbox"
                  checked={state.decades.includes(d)}
                  onChange={() => onChange({ decades: toggle(state.decades, d) })}
                />
                <span>
                  {decadeLabel(d)}
                  <span className="muted">{suffix(decadeCounts.get(String(d)) ?? 0)}</span>
                </span>
              </label>
            ))}
          </div>
        </fieldset>

        <fieldset>
          <legend>Sjanger</legend>
          <div className="check-list">
            {genres.map((g) => (
              <label key={g} className="check">
                <input
                  type="checkbox"
                  checked={state.genres.includes(g)}
                  onChange={() => onChange({ genres: toggle(state.genres, g) })}
                />
                <span>
                  {g}
                  <span className="muted">
                    {suffix(genreCounts.get(g) ?? (facetData ? 0 : undefined))}
                  </span>
                </span>
              </label>
            ))}
          </div>
        </fieldset>

        <div className="field">
          <label htmlFor={ratingId}>Minimum IMDb-rating</label>
          <select
            id={ratingId}
            value={state.minRating ?? 0}
            onChange={(e) => onChange({ minRating: Number(e.target.value) || null })}
          >
            {[...new Set([...MIN_RATINGS, state.minRating ?? 0])]
              .sort((a, b) => a - b)
              .map((r) => (
                <option key={r} value={r}>
                  {r === 0 ? 'Alle' : `${r} eller høyere`}
                </option>
              ))}
          </select>
        </div>
      </div>
    </aside>
  );
}
