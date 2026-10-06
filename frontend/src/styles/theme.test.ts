import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { THEME_KEY } from '../lib/theme';

const root = resolve(__dirname, '../..');
const css = readFileSync(resolve(root, 'src/styles/global.css'), 'utf8');

/** Egendefinerte egenskaper (--navn: verdi) i første blokk med gitt selektor. */
function tokens(selector: string): Record<string, string> {
  const start = css.indexOf(`${selector} {`);
  expect(start, `fant ikke «${selector}»`).toBeGreaterThanOrEqual(0);
  const body = css.slice(start, css.indexOf('}', start));
  return Object.fromEntries([...body.matchAll(/(--[\w-]+):\s*([^;]+);/g)].map((m) => [m[1], m[2]]));
}

describe('tema-CSS', () => {
  it('har like lyse verdier for systemvalg og eksplisitt valg', () => {
    const system = tokens(":root:not([data-theme='dark'])");
    const explicit = tokens(":root[data-theme='light']");
    expect(Object.keys(system).length).toBeGreaterThan(5);
    expect(explicit).toEqual(system);
  });

  it('overstyrer bare tokens som finnes i mørk standard', () => {
    const base = Object.keys(tokens(':root'));
    for (const key of Object.keys(tokens(":root[data-theme='light']"))) {
      expect(base).toContain(key);
    }
  });
});

describe('theme-color', () => {
  const init = readFileSync(resolve(root, 'public/theme-init.js'), 'utf8');
  const themeTs = readFileSync(resolve(root, 'src/lib/theme.ts'), 'utf8');
  const bg = (selector: string) => tokens(selector)['--bg'];
  const dark = bg(':root');
  const light = bg(":root[data-theme='light']");

  it('har samme farger som --bg i CSS, i theme-init.js og THEME_COLORS', () => {
    for (const source of [init, themeTs]) {
      expect(source).toContain(`'${dark}'`);
      expect(source).toContain(`'${light}'`);
    }
  });

  it('har meta-tagger for begge systemtema med riktig farge i index.html', () => {
    const html = readFileSync(resolve(root, 'index.html'), 'utf8');
    expect(html).toMatch(
      new RegExp(`content="${light}" media="\\(prefers-color-scheme: light\\)"`),
    );
    expect(html).toMatch(new RegExp(`content="${dark}" media="\\(prefers-color-scheme: dark\\)"`));
  });
});

describe('theme-init.js', () => {
  const html = readFileSync(resolve(root, 'index.html'), 'utf8');
  const init = readFileSync(resolve(root, 'public/theme-init.js'), 'utf8');

  it('bruker samme localStorage-nøkkel som appen', () => {
    expect(init).toContain(`'${THEME_KEY}'`);
  });

  it('lastes synkront fra <head> og uten inline-skript (CSP: script-src self)', () => {
    expect(html).toMatch(/<script src="%BASE_URL%theme-init\.js"><\/script>/);
    const inline = [...html.matchAll(/<script(?![^>]*\bsrc=)[^>]*>/g)];
    expect(inline).toHaveLength(0);
    expect(html.indexOf('theme-init.js')).toBeLessThan(html.indexOf('</head>'));
  });
});
