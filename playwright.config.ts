import { defineConfig, devices } from '@playwright/test';

// E2E-testene kjører mot en egen database slik at anmeldelser og lister de lager ikke
// blander seg med utviklingsdata. `e2e/global-setup.ts` migrerer og fyller den.
const E2E_DATABASE_URL =
  process.env.E2E_DATABASE_URL ?? 'postgres://postgres@localhost:5432/project2_e2e';

// I miljøer med en forhåndsinstallert Chromium (f.eks. CI-bilder) kan stien overstyres.
const executablePath = process.env.PW_CHROMIUM_PATH || undefined;

export default defineConfig({
  testDir: './e2e',
  globalSetup: './e2e/global-setup.ts',
  fullyParallel: false,
  workers: 1,
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? 'list' : [['list'], ['html', { open: 'never' }]],
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
      command: 'npm run build -w backend && npm run start -w backend',
      url: 'http://localhost:3001/graphql?query=%7B__typename%7D',
      env: { DATABASE_URL: E2E_DATABASE_URL, PORT: '3001', NODE_ENV: 'test' },
      reuseExistingServer: !process.env.CI,
      timeout: 120_000,
    },
    {
      command:
        'npm run build -w frontend && npm run preview -w frontend -- --port 4173 --strictPort',
      url: 'http://localhost:4173/project2/',
      reuseExistingServer: !process.env.CI,
      timeout: 120_000,
    },
  ],
});
