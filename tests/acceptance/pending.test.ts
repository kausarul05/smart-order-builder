/**
 * The acceptance tests that still need their feature built. Each one is
 * declared here so the suite is a running checklist of Section 9 rather
 * than a list that only exists in the brief.
 *
 * As each feature lands, move its block into the matching file:
 *   TC-12            -> tests/acceptance/price-preview.test.ts
 */

import { describe, it } from 'vitest';

describe('TC-12 - async price preview (Part C)', () => {
  it.todo('debounces configuration changes by 300 ms');
  it.todo('never lets an older /price response overwrite a newer one');
  it.todo('keeps the configuration and offers Retry when /price fails');
});

// TC-13, TC-14 and TC-15 now live in tests/acceptance/cart.test.ts.

// TC-16 and TC-17 now live in tests/acceptance/orders.test.ts.

// TC-18, TC-19 and TC-20 now live in tests/acceptance/assistant.test.ts.

describe('Part G - bonus, only after A to F are correct', () => {
  it.todo('a refresh keeps only still-valid reservations');
  it.todo('a stale tab gets a version conflict instead of overwriting');
  it.todo('an unfinished configuration survives a refresh');
});
