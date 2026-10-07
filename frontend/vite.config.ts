/// <reference types="vitest/config" />
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  // Appen serveres fra http://it2810-17.idi.ntnu.no/project2/ på VM-en.
  base: '/project2/',
  plugins: [react()],
  build: {
    rolldownOptions: {
      output: {
        // Vendor-kode endres sjelden, så egne chunks lar nettleseren gjenbruke dem fra cache etter en
        // ny deploy (appkoden får nytt hash, vendor beholder sitt) og parse dem parallelt.
        codeSplitting: {
          groups: [
            {
              name: 'react',
              test: /node_modules[\\/](react|react-dom|scheduler)[\\/]/,
              priority: 30,
            },
            { name: 'router', test: /node_modules[\\/]react-router[\\/]/, priority: 20 },
            {
              name: 'apollo',
              test: /node_modules[\\/](@apollo|graphql|rxjs|@wry|optimism|tslib|zen-observable-ts)[\\/]/,
              priority: 10,
            },
          ],
        },
      },
    },
  },
  server: {
    proxy: {
      // Samme URL-struktur i utvikling som i produksjon (Apache proxyer /project2/graphql).
      '/project2/graphql': {
        target: 'http://localhost:3001',
        rewrite: (path) => path.replace(/^\/project2/, ''),
      },
    },
  },
  preview: {
    // Bare satt av E2E (playwright.config.ts) for å kjøre testene under produksjonens CSP.
    headers: process.env.PREVIEW_CSP ? { 'Content-Security-Policy': process.env.PREVIEW_CSP } : {},
  },
  test: {
    environment: 'jsdom',
    setupFiles: ['./src/test/setup.ts'],
    include: ['src/**/*.test.{ts,tsx}'],
    passWithNoTests: true,
  },
});
