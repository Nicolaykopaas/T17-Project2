import { useId, useRef, useState, type FormEvent } from 'react';
import { useDebouncedCallback } from '../hooks/useDebouncedCallback';

const SEARCH_DEBOUNCE_MS = 300;

interface Props {
  /** Verdien som er «i kraft» (fra URL). */
  value: string;
  onCommit: (query: string) => void;
}

export function SearchBox({ value, onCommit }: Props) {
  const inputId = useId();
  const inputRef = useRef<HTMLInputElement>(null);
  const [text, setText] = useState(value);
  // Hva vi selv sist meldte til URL-en, slik at vi ikke overskriver det brukeren skriver akkurat nå.
  const [committed, setCommitted] = useState(value);
  const [prevValue, setPrevValue] = useState(value);

  // Tilbake-knapp, chips o.l. kan endre URL-en utenfra; da følger feltet med.
  if (value !== prevValue) {
    setPrevValue(value);
    if (value !== committed) {
      setCommitted(value);
      setText(value);
    }
  }

  const commit = (raw: string) => {
    // Trim + sammenligning mot forrige gjør at «bare mellomrom» og uendret tekst aldri gir ny request.
    const next = raw.trim();
    if (next === committed) return;
    setCommitted(next);
    onCommit(next);
  };

  const debounced = useDebouncedCallback(commit, SEARCH_DEBOUNCE_MS);
  const { cancel } = debounced;

  const submit = (e: FormEvent) => {
    e.preventDefault();
    cancel();
    commit(text);
  };

  return (
    <form role="search" className="searchbox" onSubmit={submit}>
      <label htmlFor={inputId} className="searchbox__label">
        Søk etter tittel
      </label>
      <div className="searchbox__field">
        <input
          ref={inputRef}
          id={inputId}
          type="search"
          value={text}
          autoComplete="off"
          spellCheck={false}
          placeholder="F.eks. The Godfather"
          onChange={(e) => {
            setText(e.target.value);
            debounced.call(e.target.value);
          }}
        />
        {text !== '' && (
          <button
            type="button"
            className="searchbox__clear"
            onClick={() => {
              cancel();
              setText('');
              commit('');
              inputRef.current?.focus();
            }}
          >
            <span aria-hidden="true">×</span>
            <span className="sr-only">Tøm søkefeltet</span>
          </button>
        )}
      </div>
    </form>
  );
}
