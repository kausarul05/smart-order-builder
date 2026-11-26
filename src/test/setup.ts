import { beforeEach } from 'vitest';
import '@testing-library/jest-dom/vitest';

/**
 * The app persists three things across a reload: the order store and the
 * mock server's state in localStorage, and the unfinished draft in
 * sessionStorage. All of it has to be gone between tests, or one test's
 * half-built plate turns up in the next one.
 */
beforeEach(() => {
  try {
    localStorage.clear();
    sessionStorage.clear();
  } catch {
    // Nothing to clear if storage is unavailable.
  }
});
