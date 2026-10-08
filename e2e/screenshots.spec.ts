import path from 'node:path';
import { expect, test, type Page } from '@playwright/test';

// Skjermbildene til README. Kjøres bare med `npm run screenshots` (SCREENSHOTS=1), slik at vanlig
// E2E og CI ikke skriver filer i repoet. Samme stack som E2E: falsk TMDB tegner plakatene, så
// bildene er deterministiske og trenger hverken internett eller API-nøkkel.
test.skip(!process.env.SCREENSHOTS, 'Kjøres bare via `npm run screenshots`');

const OUT_DIR = path.resolve(import.meta.dirname, '..', 'docs', 'img');
const SHAWSHANK = 'tt0111161';
// Søket gir mange treff med både håndlagde titler og syntetiske, alle med plakat fra mocken.
const SEARCH = './?q=the&types=film&genres=Drama&minRating=8&sort=rating';

test.use({
  viewport: { width: 1280, height: 800 },
  deviceScaleFactor: 1,
  // Ingen bevegelse midt i et bilde (overganger, skeleton-puls).
  reducedMotion: 'reduce',
});

/** Venter til alt synlig innhold er ferdig lastet, slik at bildet ikke viser skjeletter. */
async function settle(page: Page) {
  await expect(page.locator('main ul.is-stale')).toHaveCount(0);
  await expect(page.locator('[aria-busy="true"]')).toHaveCount(0);
  // Bare bilder i visningsflaten: lazy-bilder utenfor (også sidelengs i radene) lastes aldri og ville blitt
  // stående for alltid som «ikke ferdige».
  await page.waitForFunction(() =>
    [...document.images]
      .filter((img) => {
        const r = img.getBoundingClientRect();
        return (
          r.bottom > 0 &&
          r.top < window.innerHeight &&
          r.right > 0 &&
          r.left < window.innerWidth &&
          r.width > 0
        );
      })
      .every((img) => img.complete && img.naturalWidth > 0),
  );
  await page.evaluate(() => document.fonts.ready);
}

/**
 * Forsiden åpner med et høyt heltebanner som lar første rad stikke så vidt opp. Scroller ned så
 * banneroverskriften, kategoriknappene og en hel rad med plakater er med i bildet.
 */
async function scrollToRows(page: Page) {
  await page.evaluate(() => window.scrollTo(0, 250));
  // Headeren går fra gjennomsiktig til heldekkende når man scroller (klassen is-scrolled).
  await expect(page.locator('.site-header.is-scrolled')).toBeVisible();
}

async function shot(page: Page, name: string, options: { fullPage?: boolean } = {}) {
  // Ingen hover-tilstand fra en gjenværende musepeker. (Stil kan ikke injiseres: CSP-en er den
  // samme som i produksjon. Tekstmarkøren skjules av `caret: 'hide'` under.)
  await page.mouse.move(0, 0);
  await page.screenshot({
    path: path.join(OUT_DIR, name),
    type: 'jpeg',
    quality: 75,
    animations: 'disabled',
    caret: 'hide',
    ...options,
  });
}

async function writeReview(page: Page, name: string, stars: number, text: string) {
  await page.getByLabel('Navn').fill(name);
  await page.getByRole('radio', { name: `${stars} stjerner` }).check();
  await page.getByRole('textbox', { name: /^Anmeldelse/ }).fill(text);
  await page.getByRole('button', { name: 'Send anmeldelse' }).click();
  await expect(page.getByText(text)).toBeVisible();
}

test.describe('mørkt tema', () => {
  test.use({ colorScheme: 'dark' });

  test('forside-mork.jpg', async ({ page }) => {
    await page.goto('./');
    await expect(page.getByRole('region', { name: 'Mest populære' })).toBeVisible();
    await scrollToRows(page);
    await settle(page);
    await shot(page, 'forside-mork.jpg');
  });

  test('sok.jpg', async ({ page }) => {
    await page.goto(SEARCH);
    await expect(page.locator('.count[role="status"]')).toHaveText(/\d[\d\s]* treff/);
    await expect(page.getByRole('list', { name: 'Aktive filtre' })).toBeVisible();
    await expect(page.locator('main article').first()).toBeVisible();
    await settle(page);
    await shot(page, 'sok.jpg');
  });

  test('detalj.jpg', async ({ page }) => {
    await page.goto(`./title/${SHAWSHANK}`);
    await expect(page.getByRole('heading', { level: 1 })).toHaveText('The Shawshank Redemption');
    await writeReview(
      page,
      'Ingrid',
      5,
      'Rolig, varm og full av håp. Den holder seg like godt hver gang.',
    );
    await writeReview(
      page,
      'Magnus',
      4,
      'Sterke skuespillere og en slutt som sitter. Litt lang, men verdt det.',
    );
    await page.evaluate(() => window.scrollTo(0, 0));
    await settle(page);
    await shot(page, 'detalj.jpg', { fullPage: true });
  });

  test('spiller.jpg', async ({ page }) => {
    await page.goto(`./watch/${SHAWSHANK}`);
    const video = page.locator('video');
    await expect(video).toBeVisible();
    await expect
      .poll(() => video.evaluate((v: HTMLVideoElement) => v.readyState))
      .toBeGreaterThan(1);
    // Et bilde midt i videoen (ikke svart startbilde), satt på pause slik at kontrollene står igjen.
    await video.evaluate(
      (v: HTMLVideoElement) =>
        new Promise<void>((resolve) => {
          v.pause();
          v.addEventListener('seeked', () => resolve(), { once: true });
          v.currentTime = 3;
        }),
    );
    await expect(page.getByText('Laster …')).toHaveCount(0);
    await expect(page.getByRole('button', { name: 'Spill av' })).toBeVisible();
    await settle(page);
    await shot(page, 'spiller.jpg');
  });
});

test.describe('lyst tema', () => {
  test.use({ colorScheme: 'light' });

  test('forside-lys.jpg', async ({ page }) => {
    await page.goto('./');
    await expect(page.getByRole('region', { name: 'Mest populære' })).toBeVisible();
    await scrollToRows(page);
    await settle(page);
    await shot(page, 'forside-lys.jpg');
  });
});

test.describe('mobil', () => {
  test.use({
    colorScheme: 'dark',
    viewport: { width: 390, height: 844 },
    isMobile: true,
    hasTouch: true,
  });

  test('mobil.jpg', async ({ page }) => {
    await page.goto(SEARCH);
    await expect(page.locator('.count[role="status"]')).toHaveText(/\d[\d\s]* treff/);
    await expect(page.locator('main article').first()).toBeVisible();
    await settle(page);
    await shot(page, 'mobil.jpg');
  });
});
