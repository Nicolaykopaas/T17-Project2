import { expect, test } from '@playwright/test';

// Hele hovedflyten fra docs/prosess/plan.md (M4) i én test, fordi hvert steg bygger på tilstanden fra det forrige:
// søk → filtrer → sorter → scroll → detalj → skriv anmeldelse → se den i lista.
test('søk, filtrer, sorter, scroll, åpne detalj og skriv anmeldelse', async ({ page }) => {
  await page.goto('./');
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('Søk i filmer og serier');
  // Forsiden uten søk er bla-modus: heltebanner og rader, ennå ingen treffliste.
  await expect(page.getByRole('region', { name: 'Mest populære' })).toBeVisible();
  const count = page.locator('.count[role="status"]');
  await expect(count).toHaveCount(0);

  // Søk: debouncet og case-insensitivt. Da går siden over i søkemodus med antall treff.
  await page.getByLabel('Søk etter tittel').fill('THE');
  await expect(page).toHaveURL(/q=THE/);
  await expect(count).toHaveText(/\d[\d\s]* treff/);
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
  // Mens nye treff hentes, står de gamle igjen dempet (is-stale); vent til sorterte treff er på plass.
  await expect(page.locator('main ul.is-stale')).toHaveCount(0);
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
  // Dynamisk etikett uten aria-pressed (se docs/beslutninger.md).
  await expect(page.getByRole('button', { name: 'Fjern fra min liste' })).toBeVisible();

  await page
    .getByRole('navigation', { name: 'Hovedmeny' })
    .getByRole('link', { name: 'Min liste' })
    .click();
  await expect(page.getByRole('link', { name: 'The Dark Knight' })).toBeVisible();
  await page.getByRole('button', { name: /Fjern/ }).first().click();
  await expect(page.getByRole('link', { name: 'The Dark Knight' })).toHaveCount(0);
});

test('anmeldelser: skriv, slett med bekreftelse, og snitt og antall oppdateres', async ({
  page,
}) => {
  await page.goto('./title/tt0111161');
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('The Shawshank Redemption');
  const average = page.locator('.average');
  await expect(average).toContainText('Ingen brukeranmeldelser ennå.');

  const text = `Slettes straks ${Date.now()}`;
  await page.getByLabel('Navn').fill('Slette-tester');
  await page.getByRole('radio', { name: '5 stjerner' }).check();
  await page.getByRole('textbox', { name: /^Anmeldelse/ }).fill(text);
  await page.getByRole('button', { name: 'Send anmeldelse' }).click();
  await expect(page.getByText(text)).toBeVisible();
  await expect(average).toContainText('5,0');
  await expect(average).toContainText('1 anmeldelse');

  // Avbryt sletter ikke.
  const review = page.getByRole('article').filter({ hasText: text });
  await review.getByRole('button', { name: /^Slett/ }).click();
  await review.getByRole('button', { name: 'Avbryt' }).click();
  await expect(page.getByText(text)).toBeVisible();

  // Bekreftet sletting fjerner den, kunngjør det og flytter fokus til overskriften.
  await review.getByRole('button', { name: /^Slett/ }).click();
  await page.getByRole('button', { name: 'Bekreft sletting' }).click();
  await expect(page.getByText(text)).toHaveCount(0);
  await expect(page.getByRole('status').filter({ hasText: 'Anmeldelsen er slettet.' })).toHaveCount(
    1,
  );
  await expect(page.getByRole('heading', { level: 2, name: 'Anmeldelser' })).toBeFocused();
  await expect(average).toContainText('Ingen brukeranmeldelser ennå.');

  // Borte også etter omlasting (slettet i databasen, ikke bare i cachen).
  await page.reload();
  await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
  await expect(page.getByText(text)).toHaveCount(0);
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
  const skip = page.getByRole('link', { name: /Hopp til innhold/ });
  // Første render skjer i en transition (main.tsx), og til da vises bare det statiske skallet uten
  // fokuserbare elementer. Vent til appen er montert før Tab, slik en bruker ser siden før hen tabber.
  await expect(skip).toBeAttached();
  await page.keyboard.press('Tab');
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

test('forsiden: heltebanner, plakatrader og «Se alle» går til søkemodus', async ({ page }) => {
  await page.goto('./');
  const hero = page.locator('section.hero');
  await expect(hero.getByRole('heading', { level: 2 })).toBeVisible();
  await expect(hero.getByRole('link', { name: /Se detaljer/ })).toBeVisible();
  await expect(hero.getByRole('button', { name: /min liste/ })).toBeVisible();

  // Plakatene er ekte bilder (fra falsk TMDB), lastet og med tom alt-tekst siden tittelen står under.
  const firstPoster = page.locator('section.row article img').first();
  await expect(firstPoster).toHaveAttribute('alt', '');
  await expect
    .poll(() => firstPoster.evaluate((img: HTMLImageElement) => img.naturalWidth))
    .toBeGreaterThan(0);

  const topMovies = page.getByRole('region', { name: 'Høyest rangerte filmer' });
  await topMovies.getByRole('link', { name: /Se alle/ }).click();
  await expect(page).toHaveURL(/types=film/);
  await expect(page).toHaveURL(/sort=rating/);
  await expect(page.locator('.count[role="status"]')).toHaveText(/\d[\d\s]* treff/);
  await expect(page.getByRole('list', { name: 'Aktive filtre' })).toContainText('Film');
  await expect(page.getByLabel('Sorter etter')).toHaveValue('RATING');
});

test('forsiden: rader under folden henter data først når de nærmer seg viewport', async ({
  page,
}) => {
  const genreRequests: string[] = [];
  page.on('request', (req) => {
    if (req.method() !== 'POST' || !req.url().includes('graphql')) return;
    const body = req.postData() ?? '';
    if (body.includes('Science fiction') || body.includes('"Sci-Fi"')) genreRequests.push(body);
  });
  await page.goto('./');
  await expect(page.getByRole('region', { name: 'Mest populære' })).toBeVisible();
  expect(genreRequests).toHaveLength(0);

  const scifi = page.getByRole('region', { name: 'Science fiction' });
  await scifi.scrollIntoViewIfNeeded();
  await expect(scifi.getByRole('article').first()).toBeVisible();
  expect(genreRequests.length).toBeGreaterThan(0);
});

test('forsiden: raden kan scrolles med knapper og piltaster', async ({ page, isMobile }) => {
  await page.goto('./');
  const row = page.getByRole('region', { name: 'Mest populære' });
  const firstLink = row.getByRole('article').first().getByRole('link');
  await expect(firstLink).toBeVisible();
  await firstLink.focus();
  await page.keyboard.press('ArrowRight');
  await expect(row.getByRole('article').nth(1).getByRole('link')).toBeFocused();

  // Knappene vises bare på enheter med peker; på berøringsskjerm swiper man.
  if (!isMobile) {
    const list = row.locator('ul.row__list');
    const next = row.getByRole('button', { name: /^Neste/ });
    await expect(next).toBeVisible();
    await expect(row.getByRole('button', { name: /^Forrige/ })).toHaveCount(0);
    await next.click();
    await expect.poll(() => list.evaluate((el) => el.scrollLeft)).toBeGreaterThan(50);
    await expect(row.getByRole('button', { name: /^Forrige/ })).toBeVisible();
  }
});

test('TMDB-attribusjon står i footeren', async ({ page }) => {
  await page.goto('./');
  const footer = page.getByRole('contentinfo');
  await expect(footer).toContainText('Bilder og beskrivelser fra TMDB');
  await expect(footer).toContainText('ikke godkjent eller sertifisert av TMDB');
  await expect(footer.getByRole('link', { name: /TMDB/ })).toHaveAttribute(
    'href',
    'https://www.themoviedb.org/',
  );
});

test('headeren er gjennomsiktig over heltebildet og heldekkende ved scroll', async ({ page }) => {
  await page.goto('./');
  const header = page.getByRole('banner');
  await expect(page.locator('section.hero')).toBeVisible();
  await expect(header).not.toHaveClass(/is-scrolled/);
  await page.evaluate(() => window.scrollTo(0, 600));
  await expect(header).toHaveClass(/is-scrolled/);
});

test('søkefeltet i headeren virker fra detaljsiden', async ({ page }) => {
  await page.goto('./title/tt0468569');
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('The Dark Knight');
  await page.getByLabel('Søk etter tittel').fill('godfather');
  await expect(page).toHaveURL(/project2\/?\?q=godfather/);
  await expect(page.locator('.count[role="status"]')).toHaveText(/\d[\d\s]* treff/);
});
