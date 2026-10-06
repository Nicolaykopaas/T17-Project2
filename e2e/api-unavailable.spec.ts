import { AxeBuilder } from '@axe-core/playwright';
import { expect, test } from '@playwright/test';

// Simulerer en student utenfor NTNU-nettet: fetch mot API-et feiler helt (som uten VPN).
const GRAPHQL = '**/project2/graphql';

test('nedetid gir ett banner, og «Prøv igjen» henter data når API-et er tilbake', async ({
  page,
}) => {
  await page.route(GRAPHQL, (route) => route.abort());
  await page.goto('./');

  const banner = page.getByRole('alert');
  await expect(banner).toHaveCount(1);
  await expect(banner).toContainText('Får ikke kontakt med serveren');
  await expect(banner).toContainText('NTNU VPN');
  // Radene gjentar ikke feilen; det er bare banneret som kunngjør den.
  await expect(page.getByText('Kunne ikke hente denne raden.')).toHaveCount(0);
  await expect(page.getByRole('article')).toHaveCount(0);

  await page.unroute(GRAPHQL);
  await page.getByRole('button', { name: 'Prøv igjen' }).click();

  await expect(page.getByRole('alert')).toHaveCount(0);
  await expect(
    page.getByRole('region', { name: 'Mest populære' }).getByRole('article').first(),
  ).toBeVisible();
});

test('banneret blir stående når API-et fortsatt er nede etter «Prøv igjen»', async ({ page }) => {
  await page.route(GRAPHQL, (route) => route.abort());
  await page.goto('./');
  await expect(page.getByRole('alert')).toHaveCount(1);

  await page.getByRole('button', { name: /Prøv igjen|Prøver/ }).click();
  await expect(page.getByRole('button', { name: 'Prøv igjen' })).toBeEnabled();
  await expect(page.getByRole('alert')).toHaveCount(1);
});

for (const scheme of ['light', 'dark'] as const) {
  test(`axe: forside med banner (${scheme})`, async ({ page }) => {
    await page.emulateMedia({ colorScheme: scheme });
    await page.route(GRAPHQL, (route) => route.abort());
    await page.goto('./');
    await expect(page.getByRole('alert')).toContainText('NTNU VPN');
    await expect(page.getByRole('heading', { level: 1 })).toBeVisible();

    const results = await new AxeBuilder({ page })
      .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'])
      .analyze();
    expect(results.violations.map((v) => `${v.id}: ${v.nodes.length} noder`)).toEqual([]);
  });
}
