/// <reference types="vitest/config" />
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  // Appen serveres fra http://it2810-17.idi.ntnu.no/project2/ på VM-en.
  base: '/project2/',
  plugins: [react()],
  server: {
    proxy: {
      // Samme URL-struktur i utvikling som i produksjon (Apache proxyer /project2/graphql).
      '/project2/graphql': {
        target: 'http://localhost:3001',
        rewrite: (path) => path.replace(/^\/project2/, ''),
      },
    },
  },
  test: {
    environment: 'jsdom',
    setupFiles: ['./src/test/setup.ts'],
    include: ['src/**/*.test.{ts,tsx}'],
    passWithNoTests: true,
  },
});
