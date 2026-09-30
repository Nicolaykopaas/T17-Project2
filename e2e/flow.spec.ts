import { expect, test } from '@playwright/test';

// Hele hovedflyten fra PLAN.md (M4) i én test, fordi hvert steg bygger på tilstanden fra det forrige:
// søk → filtrer → sorter → scroll → detalj → skriv anmeldelse → se den i lista.
test('søk, filtrer, sorter, scroll, åpne detalj og skriv anmeldelse', async ({ page }) => {
  await page.goto('./');
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('Søk i filmer og serier');
  const count = page.locator('.count[role="status"]');
  await expect(count).toHaveText(/\d[\d\s]* treff/);

  // Søk: debouncet og case-insensitivt.
  await page.getByLabel('Søk etter tittel').fill('THE');
  await expect(page).toHaveURL(/q=THE/);
  const countAfterSearch = await count.textContent();

  // Filtrer: type Film. Antallet skal endre seg og filteret vises som chip.
  const filters = page.getByRole('complementary', { name: 'Filtre' });
  const toggle = filters.getByRole('button', { name: /^Filtre/ });
  if (await toggle.isVisible()) {
    if ((await toggle.getAttribute('aria-expanded')) === 'false') await toggle.click();
  }
  await filters.getByRole('checkbox', { name: /^Film/ }).check();
  await expect(page).toHaveURL(/types=film/);
  await expect(count).not.toHaveText(countAfterSearch ?? '');
  await expect(page.getByRole('list', { name: 'Aktive filtre' })).toContainText('Film');

  // Sorter på rating synkende: første kort skal ha minst like høy rating som det andre.
  await page.getByLabel('Sorter etter').selectOption({ label: 'Rating' });
  await expect(page).toHaveURL(/sort=rating/);
  const cards = page.locator('main article');
  await expect(cards.first()).toBeVisible();
  const ratings = await cards.evaluateAll((els) =>
    els
      .slice(0, 5)
      .map((el) => Number((el.textContent ?? '').match(/★\s*([\d,]+)/)?.[1]?.replace(',', '.'))),
  );
  for (let i = 1; i < ratings.length; i++)
    expect(ratings[i - 1]!).toBeGreaterThanOrEqual(ratings[i]!);

  // Scroll: flere resultater lastes inn (uendelig scroll eller «Last flere»).
  const before = await cards.count();
  const loadMore = page.getByRole('button', { name: 'Last flere' });
  await page.mouse.wheel(0, 20000);
  await expect
    .poll(async () => {
      if ((await cards.count()) > before) return true;
      if (await loadMore.isVisible()) await loadMore.click();
      return (await cards.count()) > before;
    })
    .toBe(true);

  // Detalj.
  const firstLink = cards.first().getByRole('link');
  const title = (await firstLink.textContent())?.trim() ?? '';
  await firstLink.click();
  await expect(page).toHaveURL(/\/title\/tt\d+/);
  await expect(page.getByRole('heading', { level: 1 })).toHaveText(title);

  // Skriv anmeldelse med spesialtegn og se den øverst i lista.
  const text = `Fantastisk – «${Date.now()}» <b>ikke html</b> 🎬`;
  await page.getByLabel('Navn').fill('E2E-tester');
  await page.getByRole('radio', { name: '4 stjerner' }).check();
  await page.getByRole('textbox', { name: /^Anmeldelse/ }).fill(text);
  await page.getByRole('button', { name: 'Send anmeldelse' }).click();
  await expect(page.getByRole('status').filter({ hasText: /takk|lagt til|sendt/i })).toBeVisible();
  await expect(page.getByText(text)).toBeVisible();

  // Tilbake: søket i URL-en og resultatene er bevart.
  await page.goBack();
  await expect(page).toHaveURL(/q=THE.*types=film|types=film.*q=THE/);
  await expect(page.getByLabel('Søk etter tittel')).toHaveValue('THE');
});

test('min liste: legg til fra detaljsiden og fjern igjen', async ({ page }) => {
  await page.goto('./title/tt0468569');
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('The Dark Knight');
  await page.getByRole('button', { name: 'Legg i min liste' }).click();
  await expect(page.getByRole('button', { name: 'Fjern fra min liste' })).toHaveAttribute(
    'aria-pressed',
    'true',
  );

  await page
    .getByRole('navigation', { name: 'Hovedmeny' })
    .getByRole('link', { name: 'Min liste' })
    .click();
  await expect(page.getByRole('link', { name: 'The Dark Knight' })).toBeVisible();
  await page.getByRole('button', { name: /Fjern/ }).first().click();
  await expect(page.getByRole('link', { name: 'The Dark Knight' })).toHaveCount(0);
});

test('ingen treff og direkte lenke til ukjent side', async ({ page }) => {
  await page.goto('./?q=' + encodeURIComponent('zzqx%_\'"finnesikke'));
  await expect(page.locator('.count[role="status"]')).toHaveText(/^0 treff|Ingen treff/);

  await page.goto('./title/tt0000000');
  await expect(page.getByRole('heading', { level: 1 })).toContainText(
    /fant ikke|finnes ikke|ikke funnet/i,
  );
});

test('tastatur: skip-link flytter fokus til hovedinnholdet', async ({ page }) => {
  await page.goto('./');
  await page.keyboard.press('Tab');
  const skip = page.getByRole('link', { name: /Hopp til innhold/ });
  await expect(skip).toBeFocused();
  await page.keyboard.press('Enter');
  await expect(page.locator('main')).toBeFocused();
});

test('tilbake fra detaljsiden bevarer scroll-posisjonen', async ({ page }) => {
  await page.goto('./?q=dark');
  const cards = page.locator('main article');
  await expect(cards.nth(10)).toBeVisible();
  await cards.nth(10).scrollIntoViewIfNeeded();
  const before = await page.evaluate(() => window.scrollY);
  expect(before).toBeGreaterThan(200);

  await cards.nth(10).getByRole('link').click();
  await expect(page).toHaveURL(/\/title\//);
  await page.goBack();
  await expect(page).toHaveURL(/q=dark/);
  await expect.poll(() => page.evaluate(() => window.scrollY)).toBeGreaterThan(before - 50);
});
