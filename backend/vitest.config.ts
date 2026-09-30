import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'node',
    include: ['src/**/*.test.ts', 'test/**/*.test.ts', 'scripts/**/*.test.ts'],
    globalSetup: ['test/global-setup.ts'],
    // Testene deler én testdatabase; parallelle filer ville tråkket på hverandre.
    fileParallelism: false,
    passWithNoTests: true,
  },
});
