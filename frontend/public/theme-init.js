/* global localStorage, document, location, URL */
// Setter lagret tema på <html> før første maling, ellers blinker siden i feil tema.
// Egen fil (ikke inline) så CSP kan være `script-src 'self'` uten hash. Må bruke samme nøkkel som
// THEME_KEY i src/lib/theme.ts (en test sjekker det). Kjører ikke gjennom bundleren, så
// fargene under er en kopi av THEME_COLORS i samme fil.
try {
  var t = localStorage.getItem('filmsok:theme');
  if (t === 'light' || t === 'dark') {
    document.documentElement.dataset.theme = t;
    // Begge theme-color-taggene settes, ellers vinner systemets media-query over det valgte temaet.
    var colors = { light: '#f5f4f1', dark: '#0a0a0c' };
    var metas = document.querySelectorAll('meta[name="theme-color"]');
    for (var i = 0; i < metas.length; i++) metas[i].setAttribute('content', colors[t]);
  }
} catch {
  // localStorage kan være blokkert; da følger siden systemet.
}

// Heltebanneret finnes bare på forsiden uten søk. Samme markering som useHeaderOverlay setter, men
// her allerede før React er lastet, så app-skallet i index.html får riktig header og plassholder.
// Basen leses fra skriptets egen adresse, slik at den ikke er hardkodet her.
try {
  var base = new URL('.', document.currentScript.src).pathname;
  if (location.pathname === base && !location.search) document.documentElement.dataset.hero = '';
} catch {
  // Uten markeringen vises bare header-skallet.
}
