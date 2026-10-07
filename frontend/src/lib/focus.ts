/**
 * Fast punkt å lande på når kontrollen som hadde fokus forsvinner (fjernet filter, nullstilling):
 * resultatoverskriften, og sidens h1 om den ikke finnes (f.eks. mens søket feiler).
 * Begge har tabindex=-1, så de kan få fokus uten å bli tabb-stopp.
 */
export function focusResults() {
  const target =
    document.getElementById('results-heading') ?? document.querySelector<HTMLElement>('main h1');
  if (!target) return;
  if (!target.hasAttribute('tabindex')) target.tabIndex = -1;
  target.focus({ preventScroll: true });
}
