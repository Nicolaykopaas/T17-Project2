import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { expect, test, type Page } from '@playwright/test';
import { e2ePolicy, productionPolicy as real } from './csp-policy.js';

// Vite preview sender policyen som header (se playwright.config.ts), så hele E2E-suiten kjører
// under samme CSP som Apache setter i produksjon. Denne filen sjekker i tillegg eksplisitt at
// ingenting brytes. Policyen kan ikke legges på via page.route: Chrome behandler et fulfilled
// dokument som «unknown address space» og blokkerer da subressurser fra localhost.

/** Samler CSP-brudd, både fra konsollmeldinger og fra securitypolicyviolation-hendelser. */
async function collectViolations(page: Page) {
  const violations: string[] = [];
  page.on('console', (m) => {
    if (/Content Security Policy/i.test(m.text())) violations.push(m.text());
  });
  await page.addInitScript(() => {
    document.addEventListener('securitypolicyviolation', (e) => {
      console.error(`Content Security Policy: ${e.violatedDirective} ${e.blockedURI}`);
    });
  });
  return violations;
}

test('policyen har de forventede, strenge grunndirektivene', () => {
  expect(real).toContain("default-src 'self'");
  expect(real).toContain("frame-ancestors 'none'");
  expect(real).not.toContain('unsafe-inline');
  expect(real).not.toContain('unsafe-eval');
});

test('forhåndsvisningsserveren sender policyen som header', async ({ request }) => {
  const res = await request.get('./');
  expect(res.headers()['content-security-policy']).toBe(e2ePolicy);
});

test('forside, detalj og spiller laster uten CSP-brudd', async ({ page }) => {
  const violations = await collectViolations(page);
  await page.goto('./');
  // Plakatene kommer fra TMDB-mocken og skal faktisk ha lastet.
  const img = page.locator('section.row article img').first();
  await expect(img).toBeVisible();
  await expect.poll(() => img.evaluate((i: HTMLImageElement) => i.naturalWidth)).toBeGreaterThan(0);

  await page.goto('./?sort=relevans');
  await expect(page.locator('.count[role="status"]')).toHaveText(/\d[\d\s]* treff/);

  await page.goto('./title/tt0111161');
  await expect(page.getByRole('heading', { level: 1 })).toBeVisible();

  await page.goto('./watch/tt0211915');
  const video = page.locator('video');
  await expect(video).toBeVisible();
  await expect
    .poll(() => video.evaluate((v: HTMLVideoElement) => v.readyState), { timeout: 15_000 })
    .toBeGreaterThan(0);
  // readyState 2 = LOADED: .vtt-filen ble faktisk hentet, ikke bare at elementet finnes.
  await expect
    .poll(() => page.locator('track').evaluate((t: HTMLTrackElement) => t.readyState), {
      timeout: 15_000,
    })
    .toBe(2);

  expect(violations).toEqual([]);
});

test.describe('statiske sjekker av dist/index.html', () => {
  // Uavhengige av nettleser og skjermstørrelse, så de kjøres bare i ett prosjekt.
  test.skip(({ isMobile }) => isMobile, 'kjøres bare i desktop-prosjektet');

  const html = () =>
    readFileSync(path.resolve(import.meta.dirname, '..', 'frontend', 'dist', 'index.html'), 'utf8');
  const directive = (name: string) =>
    new RegExp(`(?:^|;\\s*)${name} ([^;]+)`).exec(real)?.[1] ?? '';

  test('alle kjørbare inline-skript står som hash i script-src', () => {
    // Inline-skript blokkeres av `script-src 'self'` med mindre innholdet er hash-godkjent. Hashen
    // avhenger av byte-for-byte-innholdet, så endres skriptet uten at Apache-konfigen oppdateres
    // brekker appen i produksjon. Datablokker (f.eks. application/ld+json) kjøres ikke og er unntatt.
    const scriptSrc = directive('script-src');
    for (const m of html().matchAll(/<script(?![^>]*\ssrc=)([^>]*)>([\s\S]*?)<\/script>/gi)) {
      const type = /\stype=["']?([^"'\s>]+)/i.exec(m[1] ?? '')?.[1]?.toLowerCase();
      if (type && type !== 'module' && type !== 'text/javascript') continue;
      const code = m[2] ?? '';
      const hash = `'sha256-${createHash('sha256').update(code).digest('base64')}'`;
      expect(
        scriptSrc,
        `Inline-skript mangler i script-src i deploy/apache-project2.conf. Legg til ${hash} (erstatt gammel hash). Skript: ${code.slice(0, 80)}`,
      ).toContain(hash);
    }
  });

  test('alle inline-stiler (<style>) står som hash i style-src', () => {
    const styleSrc = directive('style-src');
    for (const m of html().matchAll(/<style[^>]*>([\s\S]*?)<\/style>/gi)) {
      const css = m[1] ?? '';
      const hash = `'sha256-${createHash('sha256').update(css).digest('base64')}'`;
      expect(
        styleSrc,
        `Inline <style> mangler i style-src i deploy/apache-project2.conf. Legg til ${hash}. Stil: ${css.slice(0, 80)}`,
      ).toContain(hash);
    }
  });
});
