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
