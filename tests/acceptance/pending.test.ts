/**
 * What is left. Every acceptance test from Section 9 (TC-01 .. TC-20) now
 * lives in a real test:
 *
 *   TC-01 .. TC-04   rules.test.ts
 *   TC-05 .. TC-07   pricing.test.ts
 *   TC-08 .. TC-11   stock.test.ts
 *   TC-12            price-preview.test.tsx  (+ src/lib/latestOnly.test.ts)
 *   TC-13 .. TC-15   cart.test.ts
 *   TC-16 .. TC-17   orders.test.ts
 *   TC-18 .. TC-20   assistant.test.ts
 *
 * Only the Part G bonus is outstanding, and the brief is explicit that it
 * must not be started before A to F are correct and tested.
 */

import { describe, it } from 'vitest';

describe('Part G - bonus, only after A to F are correct', () => {
  it.todo('a refresh keeps only still-valid reservations');
  it.todo('a stale tab gets a version conflict instead of overwriting');
  it.todo('an unfinished configuration survives a refresh');
});
