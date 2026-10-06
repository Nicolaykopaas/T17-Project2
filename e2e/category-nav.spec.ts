import { expect, test } from '@playwright/test';

test('hopp til en rad langt nede med tastatur: overskriften får fokus og raden laster titler', async ({
  page,
}) => {
  await page.goto('./');
  await expect(page.getByRole('region', { name: 'Mest populære' })).toBeVisible();
  const nav = page.getByRole('navigation', { name: 'Kategorier' });
  const link = nav.getByRole('link', { name: 'Science fiction' });

  // Fokus og Enter, slik et tastatur- eller skjermleserbrukere gjør det.
  await link.focus();
  await page.keyboard.press('Enter');

  const heading = page.getByRole('heading', { level: 2, name: 'Science fiction' });
  await expect(heading).toBeFocused();
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
