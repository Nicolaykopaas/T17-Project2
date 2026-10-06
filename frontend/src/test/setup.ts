import '@testing-library/jest-dom/vitest';
import { cleanup } from '@testing-library/react';
import { afterEach, vi } from 'vitest';

// jsdom implementerer ikke scrollTo og skriver «Not implemented» ved hvert rutebytte (ScrollRestoration).
window.scrollTo = vi.fn();

afterEach(() => {
  cleanup();
});
