import { expect, test, type Locator, type Page } from '@playwright/test';

// Filmene kommer fra den falske Internet Archive (backend/scripts/archive-mock.ts), som serverer
// e2e/fixtures/test-video.webm (ca. 9 s). Ingen ekte video hentes fra internett.
const SHAWSHANK = 'tt0111161';
const AMELIE = 'tt0211915'; // har også WebVTT-undertekster i mocken

const player = (page: Page) => page.getByRole('group', { name: /^Videospiller/ });
const videoState = (page: Page) =>
  page.evaluate(() => {
    const v = document.querySelector('video');
    if (!v) return { time: 0, duration: 0, paused: true, volume: 1, muted: false, ready: 0 };
    return {
      time: v.currentTime,
      duration: v.duration,
      paused: v.paused,
      volume: v.volume,
      muted: v.muted,
      ready: v.readyState,
    };
  });

async function openFilters(page: Page) {
  const filters = page.getByRole('complementary', { name: 'Filtre' });
  const toggle = filters.getByRole('button', { name: /^Filtre/ });
  // På mobil er panelet kollapset bak en knapp.
  if ((await toggle.isVisible()) && (await toggle.getAttribute('aria-expanded')) === 'false') {
    await toggle.click();
  }
  return filters;
}

async function waitForMetadata(page: Page) {
  await expect
    .poll(async () => (await videoState(page)).ready, { timeout: 15_000 })
    .toBeGreaterThan(0);
  await expect(page.getByText('Laster …')).toHaveCount(0);
}

test('filtrer på filmer du kan se, åpne en film og spill den av med tastatur', async ({ page }) => {
  await page.goto('./?sort=relevans');
  const count = page.locator('.count[role="status"]');
  await expect(count).toHaveText(/\d[\d\s]* treff/);
  const allCount = await count.textContent();

  const filters = await openFilters(page);
  const only = filters.getByRole('checkbox', { name: /^Kun filmer du kan se/ });
  // Antallet står i etiketten og kommer fra fasettene (SQL), ikke fra klienten.
  await expect(only).toHaveAccessibleName(/\(\d+\)/);
  await only.check();
  await expect(page).toHaveURL(/available=1/);
  await expect(page.getByRole('list', { name: 'Aktive filtre' })).toContainText(
    'Kun filmer du kan se',
  );
  await expect(count).not.toHaveText(allCount ?? '');
  await expect(page.locator('main ul.is-stale')).toHaveCount(0);

  // Hvert treff har «Se nå»-merke, og det finnes bare en håndfull i mocken.
  const cards = page.locator('main article');
  const n = await cards.count();
  expect(n).toBeGreaterThan(0);
  expect(n).toBeLessThan(10);
  await expect(page.locator('.poster__badge')).toHaveCount(n);
  await expect(page.locator('.poster__badge').first()).toHaveText(/Se nå/);

  // Detalj → «Se filmen».
  await cards.filter({ hasText: 'The Shawshank Redemption' }).getByRole('link').first().click();
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('The Shawshank Redemption');
  await expect(page.getByText('Kilde:')).toBeVisible();
  await expect(page.getByRole('link', { name: /Internet Archive/ })).toBeVisible();
  await page.getByRole('link', { name: /Se filmen/ }).click();
  await expect(page).toHaveURL(new RegExp(`/watch/${SHAWSHANK}$`));
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('The Shawshank Redemption');

  // Spilleren laster metadata; tidslinjen kjenner varigheten.
  await waitForMetadata(page);
  const timeline = page.getByRole('slider', { name: 'Tidslinje' });
  await expect(timeline).toHaveAttribute('aria-valuetext', /^0:00 av 0:0\d$/);

  // Play med museknapp: tiden går.
  await page.getByRole('button', { name: 'Spill av' }).click();
  await expect(page.getByRole('button', { name: 'Pause' })).toBeVisible();
  await expect(page.getByRole('status').filter({ hasText: /./ })).toHaveText('Spiller');
  await expect
    .poll(async () => (await videoState(page)).time, { timeout: 10_000 })
    .toBeGreaterThan(0.5);

  // Pause og spol med tastatur: piltastene hopper ±10 s, som her betyr slutt og start.
  await page.keyboard.press('k');
  await expect(page.getByRole('button', { name: 'Spill av' })).toBeVisible();
  expect((await videoState(page)).paused).toBe(true);
  await page.keyboard.press('ArrowRight');
  await expect.poll(async () => (await videoState(page)).time).toBeGreaterThan(8);
  await page.keyboard.press('ArrowLeft');
  await expect.poll(async () => (await videoState(page)).time).toBe(0);

  // Volum: pil ned gir 90 %, og valget huskes når siden lastes på nytt.
  await page.keyboard.press('ArrowDown');
  await expect.poll(async () => (await videoState(page)).volume).toBeCloseTo(0.9, 2);
  // På smale skjermer er glidebryteren skjult med vilje (telefonens volumknapper brukes).
  const slider = page.getByRole('slider', { name: 'Volum' });
  if (await slider.isVisible()) await expect(slider).toHaveAttribute('aria-valuetext', '90 %');
  await page.keyboard.press('m');
  await expect(page.getByRole('button', { name: 'Slå på lyd' })).toBeVisible();
  expect((await videoState(page)).muted).toBe(true);
  await page.keyboard.press('m');

  // Spol med tidslinjen (piltast på slideren flytter ett sekund og skal ikke hoppe 10).
  await timeline.focus();
  await page.keyboard.press('ArrowRight');
  await expect.poll(async () => (await videoState(page)).time).toBeCloseTo(1, 0);

  // Spill, så pause igjen med knappen.
  await page.getByRole('button', { name: 'Spill av' }).click();
  await expect.poll(async () => (await videoState(page)).time).toBeGreaterThan(1.3);
  await page.getByRole('button', { name: 'Pause' }).click();
  await expect.poll(async () => (await videoState(page)).paused).toBe(true);

  await page.reload();
  await waitForMetadata(page);
  expect((await videoState(page)).volume).toBeCloseTo(0.9, 2);
  await page.evaluate(() => localStorage.removeItem('filmsok:player'));
});

test('undertekster: CC-knappen skrur sporet av og på', async ({ page }) => {
  await page.goto(`./watch/${AMELIE}`);
  await waitForMetadata(page);
  const cc = page.getByRole('button', { name: 'Undertekster' });
  await expect(cc).toHaveAttribute('aria-pressed', 'true');
  const mode = () =>
    page.evaluate(() => document.querySelector('video')!.textTracks[0]?.mode ?? 'ingen');
  await expect.poll(mode).toBe('showing');
  await cc.click();
  await expect(cc).toHaveAttribute('aria-pressed', 'false');
  await expect.poll(mode).toBe('hidden');
  await page.keyboard.press('c');
  await expect(cc).toHaveAttribute('aria-pressed', 'true');
  await expect.poll(mode).toBe('showing');
});

test('kontrollene skjules mens filmen spiller og vises igjen ved bevegelse', async ({
  page,
  isMobile,
}) => {
  test.skip(isMobile, 'På mobil ligger kontrollene under bildet og skjules ikke.');
  await page.goto(`./watch/${SHAWSHANK}`);
  await waitForMetadata(page);
  await page.getByRole('button', { name: 'Spill av' }).click();
  const group = player(page);
  const controls: Locator = group.locator('.player__controls');
  await expect(group).toHaveClass(/is-idle/, { timeout: 6000 });
  await expect(controls).toHaveCSS('opacity', '0');
  await page.mouse.move(200, 300);
  await page.mouse.move(260, 320);
  await expect(controls).toHaveCSS('opacity', '1');
  await page.getByRole('button', { name: 'Pause' }).click();
});

test('ukjent film og film uten stream gir forståelige tilstander', async ({ page }) => {
  await page.goto('./watch/tt9999999');
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('Fant ikke tittelen');

  // The Dark Knight finnes ikke i mocken.
  await page.goto('./watch/tt0468569');
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('The Dark Knight');
  await expect(page.getByText(/ingen gratisversjon/)).toBeVisible();
  await expect(page.locator('video')).toHaveCount(0);
});

test('feil ved avspilling gir melding og lenke til archive.org', async ({ page }) => {
  // Simulerer at Internet Archive ikke svarer på selve videofilen.
  await page.route('**/download/**', (route) => route.abort());
  await page.goto(`./watch/${SHAWSHANK}`);
  const alert = page.getByRole('alert');
  await expect(alert).toContainText('Kunne ikke spille av videoen');
  await expect(alert.getByRole('link', { name: /archive\.org/ })).toHaveAttribute(
    'href',
    /\/details\/mock-shawshank$/,
  );
  await page.unroute('**/download/**');
  await alert.getByRole('button', { name: 'Prøv igjen' }).click();
  await waitForMetadata(page);
  await expect(page.getByRole('alert')).toHaveCount(0);
});
