import { expect, test } from '@playwright/test';

test('hopp til en rad langt nede med tastatur: raden får fokus og laster titler', async ({
  page,
}) => {
  await page.goto('./');
  await expect(page.getByRole('region', { name: 'Mest populære' })).toBeVisible();
  const nav = page.getByRole('navigation', { name: 'Kategorier' });
  const link = nav.getByRole('link', { name: 'Science fiction' });

  // Fokus og Enter, slik en tastatur- eller skjermleserbruker gjør det.
  await link.focus();
  await page.keyboard.press('Enter');

  const heading = page.getByRole('heading', { level: 2, name: 'Science fiction' });
  await expect(page.getByRole('group', { name: 'Science fiction' })).toBeFocused();
  // Raden var en tom plassholder før hoppet; scrollingen må ha utløst lastingen.
  await expect(
    page.getByRole('region', { name: 'Science fiction' }).getByRole('article').first(),
  ).toBeVisible();
  // Overskriften skal ikke ligge skjult bak den faste headeren.
  const headerBottom = await page
    .locator('.site-header')
    .evaluate((el) => el.getBoundingClientRect().bottom);
  await expect
    .poll(async () => heading.evaluate((el) => el.getBoundingClientRect().top))
    .toBeGreaterThanOrEqual(headerBottom - 1);
  // Siden skal aldri få horisontal scroll, heller ikke på 320 px (chipsene scroller inni nav-en).
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= document.documentElement.clientWidth,
    ),
  ).toBe(true);
});

test('320 px: ingen sidescroll, og siste kategori kan nås med Tab og er synlig', async ({
  page,
}) => {
  await page.setViewportSize({ width: 320, height: 640 });
  await page.goto('./');
  const nav = page.getByRole('navigation', { name: 'Kategorier' });
  const links = nav.getByRole('link');
  const last = links.last();
  await expect(last).toHaveText('Science fiction');

  // Tab fra første kategori og helt til siste.
  await links.first().focus();
  const n = await links.count();
  for (let i = 1; i < n; i++) await page.keyboard.press('Tab');
  await expect(last).toBeFocused();

  // Fokus skal ha scrollet chipsen inn i nav-en, ikke ut av skjermen.
  // Nettleseren scroller chipsen inn i nav-en (kan ta et øyeblikk), så vi poller.
  const right = async () => (await last.boundingBox())!.x + (await last.boundingBox())!.width;
  await expect.poll(right).toBeLessThanOrEqual(320);
  await expect.poll(async () => (await last.boundingBox())!.x).toBeGreaterThanOrEqual(0);
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= document.documentElement.clientWidth,
    ),
  ).toBe(true);
});
