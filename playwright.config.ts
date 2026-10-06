import { defineConfig, devices } from '@playwright/test';
import { e2ePolicy } from './e2e/csp-policy';

// E2E-testene kjører mot en egen database slik at anmeldelser og lister de lager ikke
// blander seg med utviklingsdata. `e2e/global-setup.ts` migrerer og fyller den.
const E2E_DATABASE_URL =
  process.env.E2E_DATABASE_URL ?? 'postgres://postgres@localhost:5432/project2_e2e';

const ARCHIVE_URL = 'http://localhost:3998';

// I miljøer med en forhåndsinstallert Chromium (f.eks. CI-bilder) kan stien overstyres.
const executablePath = process.env.PW_CHROMIUM_PATH || undefined;

export default defineConfig({
  testDir: './e2e',
  globalSetup: './e2e/global-setup.ts',
  fullyParallel: false,
  workers: 1,
  retries: process.env.CI ? 1 : 0,
  // HTML-rapporten lastes opp som CI-artefakt når E2E feiler.
  reporter: [['list'], ['html', { open: 'never' }]],
  use: {
    baseURL: 'http://localhost:4173/project2/',
    trace: 'retain-on-failure',
    launchOptions: { executablePath },
  },
  projects: [
    { name: 'desktop', use: { ...devices['Desktop Chrome'] } },
    { name: 'mobil', use: { ...devices['Pixel 7'] } },
  ],
  webServer: [
    {
      // Falsk TMDB: E2E skal ikke trenge internett eller en ekte API-nøkkel, og plakatene den
      // tegner er deterministiske.
      command: 'npm run tmdb:mock -w backend',
      url: 'http://localhost:3999/t/p/w92/tt0111161.svg',
      env: { DATABASE_URL: E2E_DATABASE_URL, TMDB_MOCK_PORT: '3999' },
      reuseExistingServer: !process.env.CI,
      timeout: 60_000,
    },
    {
      // Falsk Internet Archive: metadata, nedlasting med Range-støtte og undertekster, servert fra
      // e2e/fixtures/test-video.webm. Må stå før globalSetup, som importerer filmene fra den
      // (Playwright starter webServer før globalSetup).
      command: 'npm run archive:mock -w backend',
      url: 'http://localhost:3998/metadata/probe',
      env: { ARCHIVE_MOCK_PORT: '3998' },
      reuseExistingServer: !process.env.CI,
      timeout: 60_000,
    },
    {
      command: 'npm run build -w backend && npm run start -w backend',
      url: 'http://localhost:3001/graphql?query=%7B__typename%7D',
      env: {
        DATABASE_URL: E2E_DATABASE_URL,
        PORT: '3001',
        NODE_ENV: 'test',
        TMDB_API_KEY: 'test',
        TMDB_API_URL: 'http://localhost:3999/3',
        TMDB_IMAGE_URL: 'http://localhost:3999/t/p',
        ARCHIVE_URL: ARCHIVE_URL,
      },
      reuseExistingServer: !process.env.CI,
      timeout: 120_000,
    },
    {
      command:
        'npm run build -w frontend && npm run preview -w frontend -- --port 4173 --strictPort',
      url: 'http://localhost:4173/project2/',
      // Samme CSP som Apache sender i produksjon (lest fra deploy/apache-project2.conf), slik at
      // alle E2E-testene fanger et nytt eksternt opphav som policyen ikke tillater.
      env: { PREVIEW_CSP: e2ePolicy },
      reuseExistingServer: !process.env.CI,
      timeout: 120_000,
    },
  ],
});
