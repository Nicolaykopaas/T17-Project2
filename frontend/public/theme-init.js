/* global localStorage, document */
// Setter lagret tema på <html> før første maling, ellers blinker siden i feil tema.
// Egen fil (ikke inline) så CSP kan være `script-src 'self'` uten hash. Må bruke samme nøkkel som
// THEME_KEY i src/lib/theme.ts (en test sjekker det). Kjører ikke gjennom bundleren.
try {
  var t = localStorage.getItem('filmsok:theme');
  if (t === 'light' || t === 'dark') document.documentElement.dataset.theme = t;
} catch {
  // localStorage kan være blokkert; da følger siden systemet.
}
