/**
 * The acceptance tests that still need their feature built. Each one is
 * declared here so the suite is a running checklist of Section 9 rather
 * than a list that only exists in the brief.
 *
 * As each feature lands, move its block into the matching file:
 *   TC-12            -> tests/acceptance/price-preview.test.ts
 *   TC-16 .. TC-17   -> tests/acceptance/orders.test.ts
 *   TC-18 .. TC-20   -> tests/acceptance/assistant.test.ts
 */

import { describe, it } from 'vitest';

describe('TC-12 - async price preview (Part C)', () => {
  it.todo('debounces configuration changes by 300 ms');
  it.todo('never lets an older /price response overwrite a newer one');
  it.todo('keeps the configuration and offers Retry when /price fails');
});

// TC-13, TC-14 and TC-15 now live in tests/acceptance/cart.test.ts.

describe('TC-16 - checkout is atomic and idempotent (Part E)', () => {
  it.todo('two fast Pay clicks create exactly one order');
  it.todo('empties the cart and turns reserved stock into sold stock');
  it.todo('does not release sold stock when the old reservation expires');
});

describe('TC-17 - orders survive a refresh and export (Part E)', () => {
  it.todo('reloads stored orders after a refresh');
  it.todo('prices the six seed orders at their own createdAt');
  it.todo('exports seed and new orders as one valid JSON file');
});

describe('TC-18 .. TC-20 - the sales assistant (Part F)', () => {
  it.todo('TC-18: the order count rises by exactly one after a checkout');
  it.todo('TC-19: the best-selling option matches the stats function');
  it.todo('TC-20: it refuses to invent a best customer');
  it.todo('reports a missing key, an invalid key, a 429 and a network error');
});

describe('Part G - bonus, only after A to F are correct', () => {
  it.todo('a refresh keeps only still-valid reservations');
  it.todo('a stale tab gets a version conflict instead of overwriting');
  it.todo('an unfinished configuration survives a refresh');
});
