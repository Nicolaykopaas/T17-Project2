import { useId, useRef, useState, type FormEvent } from 'react';
import { useMutation } from '@apollo/client/react';
import { ADD_REVIEW_MUTATION } from '../graphql/operations';
import {
  MAX_AUTHOR,
  MAX_TEXT,
  validateReview,
  type ReviewDraft,
  type ReviewErrors,
} from '../lib/validateReview';

interface Props {
  titleId: string;
  /** Kalles etter vellykket innsending, f.eks. for å hente lista på nytt. */
  onSubmitted?: () => Promise<unknown> | void;
}

const STAR_LABELS = ['1 stjerne', '2 stjerner', '3 stjerner', '4 stjerner', '5 stjerner'];

export function ReviewForm({ titleId, onSubmitted }: Props) {
  const uid = useId();
  const ids = {
    author: `${uid}-author`,
    authorError: `${uid}-author-error`,
    rating: `${uid}-rating-error`,
    text: `${uid}-text`,
    textError: `${uid}-text-error`,
    counter: `${uid}-counter`,
  };

  const [draft, setDraft] = useState<ReviewDraft>({ author: '', rating: null, text: '' });
  const [errors, setErrors] = useState<ReviewErrors>({});
  const [submitted, setSubmitted] = useState(false);
  const [success, setSuccess] = useState('');
  const [serverError, setServerError] = useState('');
  const authorRef = useRef<HTMLInputElement>(null);
  const firstStarRef = useRef<HTMLInputElement>(null);
  const textRef = useRef<HTMLTextAreaElement>(null);

  const [addReview, { loading }] = useMutation(ADD_REVIEW_MUTATION);

  const change = (patch: Partial<ReviewDraft>) => {
    const next = { ...draft, ...patch };
    setDraft(next);
    setSuccess('');
    // Etter første forsøk oppdateres feilene mens brukeren retter dem.
    if (submitted) setErrors(validateReview(next));
  };

  const onSubmit = async (e: FormEvent) => {
    e.preventDefault();
    if (loading) return;
    setSuccess('');
    setServerError('');
    setSubmitted(true);

    const found = validateReview(draft);
    setErrors(found);
    if (found.author) return authorRef.current?.focus();
    if (found.rating) return firstStarRef.current?.focus();
    if (found.text) return textRef.current?.focus();

    try {
      await addReview({
        variables: {
          input: {
            titleId,
            author: draft.author.trim(),
            rating: draft.rating!,
            text: draft.text.trim(),
          },
        },
      });
    } catch {
      setServerError('Kunne ikke sende anmeldelsen. Sjekk nettverket og prøv igjen.');
      return;
    }
    setDraft({ author: draft.author, rating: null, text: '' });
    setErrors({});
    setSubmitted(false);
    setSuccess('Takk! Anmeldelsen din er lagt til.');
    try {
      await onSubmitted?.();
    } catch {
      // Anmeldelsen er lagret; en mislykket oppdatering av lista er ikke kritisk.
    }
  };

  const textLength = draft.text.length;

  return (
    <form className="review-form" onSubmit={(e) => void onSubmit(e)} noValidate>
      <h3>Skriv en anmeldelse</h3>

      <div className="field">
        <label htmlFor={ids.author}>Navn</label>
        <input
          ref={authorRef}
          id={ids.author}
          type="text"
          autoComplete="nickname"
          value={draft.author}
          aria-invalid={errors.author ? true : undefined}
          aria-describedby={errors.author ? ids.authorError : undefined}
          aria-required="true"
          onChange={(e) => change({ author: e.target.value })}
        />
        {errors.author && (
          <p id={ids.authorError} className="error-text">
            {errors.author}
          </p>
        )}
        <p className="hint">Maks {MAX_AUTHOR} tegn.</p>
      </div>

      <fieldset
        aria-describedby={errors.rating ? ids.rating : undefined}
        aria-invalid={errors.rating ? true : undefined}
      >
        <legend>Vurdering</legend>
        <div className="star-input">
          {STAR_LABELS.map((label, i) => {
            const value = i + 1;
            return (
              <label key={value} className="star-input__option">
                <input
                  ref={value === 1 ? firstStarRef : undefined}
                  type="radio"
                  name={`${uid}-rating`}
                  value={value}
                  checked={draft.rating === value}
                  onChange={() => change({ rating: value })}
                />
                <span aria-hidden="true">{'★'.repeat(value)}</span>
                <span className="sr-only">{label}</span>
              </label>
            );
          })}
        </div>
        {errors.rating && (
          <p id={ids.rating} className="error-text">
            {errors.rating}
          </p>
        )}
      </fieldset>

      <div className="field">
        <label htmlFor={ids.text}>Anmeldelse (valgfritt)</label>
        <textarea
          ref={textRef}
          id={ids.text}
          rows={5}
          value={draft.text}
          aria-invalid={errors.text ? true : undefined}
          aria-describedby={`${ids.counter}${errors.text ? ` ${ids.textError}` : ''}`}
          onChange={(e) => change({ text: e.target.value })}
        />
        <p id={ids.counter} className={`hint${textLength > MAX_TEXT ? ' error-text' : ''}`}>
          {textLength} / {MAX_TEXT} tegn
        </p>
        {errors.text && (
          <p id={ids.textError} className="error-text">
            {errors.text}
          </p>
        )}
      </div>

      {serverError && (
        <p className="error-text" role="alert">
          {serverError}
        </p>
      )}

      <button type="submit" className="btn btn--primary" disabled={loading}>
        {loading ? 'Sender …' : 'Send anmeldelse'}
      </button>

      {/* Regionen finnes hele tiden, ellers leses ikke meldingen opp. */}
      <p className="success-text" role="status" aria-live="polite">
        {success}
      </p>
    </form>
  );
}
