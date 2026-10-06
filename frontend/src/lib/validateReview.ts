export const MAX_AUTHOR = 50;
export const MAX_TEXT = 2000;

/**
 * Antall Unicode-tegn (kodepunkter), som API-et teller. `.length` teller UTF-16-enheter, så en
 * emoji ville telt som 2 her og 1 på serveren, og gyldige tekster kunne avvises.
 */
export function charLength(s: string): number {
  let n = 0;
  for (const _ of s) n++;
  return n;
}

export interface ReviewDraft {
  author: string;
  rating: number | null;
  text: string;
}

export type ReviewErrors = Partial<Record<keyof ReviewDraft, string>>;

/** Samme regler som API-et (docs/api.md), slik at brukeren får feilen før nettverksrunden. */
export function validateReview({ author, rating, text }: ReviewDraft): ReviewErrors {
  const errors: ReviewErrors = {};
  const name = author.trim();
  if (name.length === 0) errors.author = 'Skriv inn navnet ditt.';
  else if (charLength(name) > MAX_AUTHOR) errors.author = `Navnet kan ha maks ${MAX_AUTHOR} tegn.`;

  if (rating === null || !Number.isInteger(rating) || rating < 1 || rating > 5) {
    errors.rating = 'Velg et antall stjerner fra 1 til 5.';
  }

  // Trimmet, fordi ReviewForm sender trimmet tekst og API-et teller det som lagres.
  const textLength = charLength(text.trim());
  if (textLength > MAX_TEXT) {
    errors.text = `Teksten kan ha maks ${MAX_TEXT} tegn. Fjern ${textLength - MAX_TEXT} tegn.`;
  }
  return errors;
}
