import { AxeBuilder } from '@axe-core/playwright';
import { expect, test } from '@playwright/test';

// WCAG 2.1 AA er kravet i CLAUDE.md; axe sjekker det som kan sjekkes automatisk.
const pages = [
  { name: 'forside (bla-modus)', path: './', ready: 'Søk i filmer og serier', scrollAll: true },
  {
    name: 'søk med kun filmer som kan strømmes gratis',
    path: './?available=1',
    ready: 'Søk i filmer og serier',
  },
  { name: 'søk uten tekst', path: './?sort=relevans', ready: 'Søk i filmer og serier' },
  {
    name: 'søk med treff og filter',
    path: './?q=dark&types=film&sort=rating',
    ready: 'Søk i filmer og serier',
  },
  { name: 'detalj', path: './title/tt0468569', ready: 'The Dark Knight' },
  { name: 'detalj med gratisfilm', path: './title/tt0111161', ready: 'The Shawshank Redemption' },
  { name: 'spiller', path: './watch/tt0111161', ready: 'The Shawshank Redemption' },
  { name: 'min liste', path: './my-list', ready: 'Min liste' },
  { name: 'ukjent side', path: './finnes/ikke', ready: null },
];

for (const { name, path, ready, scrollAll } of pages) {
  for (const scheme of ['light', 'dark'] as const) {
    test(`axe: ${name} (${scheme})`, async ({ page }) => {
      await page.emulateMedia({ colorScheme: scheme });
      await page.goto(path);
      const h1 = page.getByRole('heading', { level: 1 });
      if (ready) await expect(h1).toHaveText(ready);
      else await expect(h1).toBeVisible();
      if (scrollAll) {
        // Rader under folden lastes først når de nærmer seg viewport; scroll ned så axe ser alle.
        await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
        await expect(
          page.getByRole('region', { name: 'Science fiction' }).getByRole('article').first(),
        ).toBeVisible();
        await page.evaluate(() => window.scrollTo(0, 0));
      }
      // Vent til skjelett-lasting er ferdig så axe ser det endelige innholdet.
      await expect(page.locator('[aria-busy="true"]')).toHaveCount(0);

      const results = await new AxeBuilder({ page })
        .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'])
        .analyze();
      expect(results.violations.map((v) => `${v.id}: ${v.nodes.length} noder`)).toEqual([]);
    });
  }
}

test('ingen horisontal scroll ved 320 px', async ({ page }) => {
  await page.setViewportSize({ width: 320, height: 640 });
  for (const path of ['./', './?q=dark', './title/tt0468569', './watch/tt0111161', './my-list']) {
    await page.goto(path);
    await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
    const overflow = await page.evaluate(
      () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
    );
    expect(overflow, path).toBeLessThanOrEqual(0);
    // Headeren brytes over flere rader her; den skal vokse med innholdet, ikke la søkefeltet flyte ut under seg.
    const [header, search] = await Promise.all([
      page.locator('.site-header').boundingBox(),
      page.getByRole('search').boundingBox(),
    ]);
    expect(search!.y + search!.height, path).toBeLessThanOrEqual(header!.y + header!.height + 1);
  }
});

test('lav viewport (400 % zoom, landskap): headeren er ikke klebrig og dekker ikke innholdet', async ({
  page,
}) => {
  await page.setViewportSize({ width: 320, height: 200 });
  await page.goto('./');
  await expect(page.getByRole('heading', { level: 1 })).toBeAttached();
  await expect(page.locator('.site-header')).toHaveCSS('position', 'static');
});

// Brukervalgt tema skal overstyre systemets og være tilgjengelig i begge tilstander.
for (const system of ['light', 'dark'] as const) {
  test(`tema: bryteren overstyrer systemet (${system}), huskes og består axe`, async ({ page }) => {
    await page.emulateMedia({ colorScheme: system });
    await page.goto('./title/tt0468569');
    await expect(page.getByRole('heading', { level: 1 })).toHaveText('The Dark Knight');
    const toggle = page.getByRole('button', { name: 'Mørkt tema' });
    await expect(toggle).toHaveAttribute('aria-pressed', system === 'dark' ? 'true' : 'false');
    await expect(page.locator('html')).not.toHaveAttribute('data-theme');

    const other = system === 'dark' ? 'light' : 'dark';
    for (const theme of [other, system]) {
      await toggle.click();
      await expect(page.locator('html')).toHaveAttribute('data-theme', theme);
      await expect(toggle).toHaveAttribute('aria-pressed', theme === 'dark' ? 'true' : 'false');
      // Bakgrunnen følger valget, ikke systemet.
      const bg = await page.evaluate(() => getComputedStyle(document.body).backgroundColor);
      expect(bg).toBe(theme === 'dark' ? 'rgb(10, 10, 12)' : 'rgb(245, 244, 241)');
      const results = await new AxeBuilder({ page })
        .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'])
        .analyze();
      expect(results.violations.map((v) => `${v.id}: ${v.nodes.length} noder`)).toEqual([]);
    }

    // Valget overlever en omlasting og er på plass før React starter (ingen blink).
    await toggle.click();
    await page.reload();
    await expect(page.locator('html')).toHaveAttribute('data-theme', other);
  });
}

test('tema: bryteren er nåbar med tastatur og har synlig fokus', async ({ page }) => {
  await page.goto('./');
  const toggle = page.getByRole('button', { name: 'Mørkt tema' });
  await toggle.focus();
  await expect(toggle).toBeFocused();
  const outline = await toggle.evaluate((el) => getComputedStyle(el).outlineStyle);
  expect(outline).not.toBe('none');
  await page.keyboard.press('Enter');
  await expect(page.locator('html')).toHaveAttribute('data-theme', /light|dark/);
});
