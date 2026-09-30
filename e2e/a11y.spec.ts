import { AxeBuilder } from '@axe-core/playwright';
import { expect, test } from '@playwright/test';

// WCAG 2.1 AA er kravet i CLAUDE.md; axe sjekker det som kan sjekkes automatisk.
const pages = [
  { name: 'forside (bla-modus)', path: './', ready: 'Søk i filmer og serier', scrollAll: true },
  { name: 'søk med kun filmer du kan se', path: './?available=1', ready: 'Søk i filmer og serier' },
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
  }
});
