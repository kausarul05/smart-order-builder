/**
 * TC-13 .. TC-15 - Part D, the cart and its reservations.
 *
 * These drive the real mock-server code in `src/server/cart.ts` with a
 * hand-driven clock, so the five-minute expiry is tested in milliseconds
 * instead of five real minutes.
 */

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { bdt } from '@/domain/money';
import { availableMap } from '@/domain/stock/ingredients';
import {
  cartView,
  editItem,
  removeItem,
  reserveItem,
  setFault,
} from '@/server/cart';
import {
  RESERVATION_TTL_MS,
  manualClock,
  resetServerClock,
  setServerClock,
} from '@/server/clock';
import { getState, resetState, snapshot } from '@/server/state';
import { DEFAULT_MENU } from '@/fixtures/menu.default';
import { SELECTION_A, SELECTION_B, SELECTION_C } from '../fixtures/configs';

/** A fixed instant deliberately unrelated to the host clock. */
const START = new Date('2026-11-25T09:00:00+06:00');

let clock: ReturnType<typeof manualClock>;

const available = () => availableMap(snapshot(), DEFAULT_MENU.ingredients);

beforeEach(() => {
  resetState();
  clock = manualClock(START);
  setServerClock(clock);
  setFault('none');
});

afterEach(() => {
  setFault('none');
  resetServerClock();
});

describe('TC-13 - Add to Cart clicked three times quickly', () => {
  it('creates exactly one cart item and one reservation', () => {
    const key = 'idem-one-intent';
    const results = [1, 2, 3].map(() =>
      reserveItem({ selection: SELECTION_A, qty: 1, idempotencyKey: key }),
    );

    for (const result of results) expect(result.ok).toBe(true);

    const state = getState();
    expect(state.cart.size).toBe(1);
    expect(state.reservations.size).toBe(1);

    // All three calls describe the SAME item.
    const ids = new Set(results.map((result) => (result.ok ? result.item.id : '')));
    expect(ids.size).toBe(1);
  });

  it('consumes the ingredients once, not three times', () => {
    const key = 'idem-stock';
    for (let click = 0; click < 3; click += 1) {
      reserveItem({ selection: SELECTION_A, qty: 1, idempotencyKey: key });
    }
    // A uses 2 eggs per unit; stock is 10.
    expect(available().egg).toBe(8);
  });

  it('treats a different key as a genuinely different intent', () => {
    reserveItem({ selection: SELECTION_A, qty: 1, idempotencyKey: 'first' });
    reserveItem({ selection: SELECTION_A, qty: 1, idempotencyKey: 'second' });
    expect(getState().cart.size).toBe(2);
    expect(available().egg).toBe(6);
  });

  it('locks the unit price at Add to Cart (D2)', () => {
    const result = reserveItem({
      selection: SELECTION_B,
      qty: 1,
      idempotencyKey: 'price-lock',
    });
    expect(result.ok && result.item.unitPrice).toBe(bdt(679.5));
  });
});

describe('TC-14 - a reserve that fails mid-way holds no stock', () => {
  it('leaves no phantom reservation when the server crashes between writes', () => {
    setFault('mid-reserve');
    expect(() =>
      reserveItem({ selection: SELECTION_A, qty: 1, idempotencyKey: 'crash' }),
    ).toThrow(/simulated server crash/);

    const state = getState();
    expect(state.reservations.size).toBe(0);
    expect(state.cart.size).toBe(0);
    expect(available().egg).toBe(10);
  });

  it('does not burn the idempotency key, so Retry works', () => {
    setFault('mid-reserve');
    expect(() =>
      reserveItem({ selection: SELECTION_A, qty: 1, idempotencyKey: 'retry-me' }),
    ).toThrow();

    setFault('none');
    const retry = reserveItem({
      selection: SELECTION_A,
      qty: 1,
      idempotencyKey: 'retry-me',
    });
    expect(retry.ok).toBe(true);
    expect(getState().cart.size).toBe(1);
    expect(available().egg).toBe(8);
  });

  it('rolls an edit back whole, so the old allocation is still held', () => {
    const added = reserveItem({
      selection: SELECTION_B,
      qty: 1,
      idempotencyKey: 'edit-crash',
    });
    expect(added.ok).toBe(true);
    const before = available().egg;

    setFault('mid-edit');
    expect(() =>
      editItem({
        itemId: added.ok ? added.item.id : '',
        selection: { ...SELECTION_B, omelette: 1, fried: 3 },
        qty: 1,
      }),
    ).toThrow();

    expect(available().egg).toBe(before);
    expect(getState().cart.get(added.ok ? added.item.id : '')?.version).toBe(1);
  });

  it('refuses an unservable reserve without touching anything', () => {
    // Fill the cart so the eggs run out: B x1 + C x2 takes all 10.
    reserveItem({ selection: SELECTION_B, qty: 1, idempotencyKey: 'fill-b' });
    reserveItem({ selection: SELECTION_C, qty: 2, idempotencyKey: 'fill-c' });
    expect(available().egg).toBe(0);

    const sizeBefore = getState().cart.size;
    const blocked = reserveItem({
      selection: SELECTION_A,
      qty: 1,
      idempotencyKey: 'no-eggs',
    });

    expect(blocked.ok).toBe(false);
    expect(!blocked.ok && blocked.code).toBe('shortage');
    expect(!blocked.ok && blocked.message).toBe('Short: 2 egg');
    expect(getState().cart.size).toBe(sizeBefore);
  });
});

describe('TC-15 - reservations expire on the server clock', () => {
  it('counts down from the server clock, not the browser clock', () => {
    reserveItem({ selection: SELECTION_A, qty: 1, idempotencyKey: 'countdown' });
    const [item] = cartView(clock.now());
    // Exactly five minutes, even though the host clock is somewhere else
    // entirely and the real server runs 90 s ahead of the browser.
    expect(item?.expiresInMs).toBe(RESERVATION_TTL_MS);
    expect(item?.editable).toBe(true);
  });

  it('still holds the stock one millisecond before 5:00', () => {
    reserveItem({ selection: SELECTION_A, qty: 1, idempotencyKey: 'just-inside' });
    clock.advance(RESERVATION_TTL_MS - 1);
    const [item] = cartView(clock.now());
    expect(item?.status).toBe('active');
    expect(available().egg).toBe(8);
  });

  it('releases the stock and makes the item read-only once 5:00 passes', () => {
    const added = reserveItem({
      selection: SELECTION_A,
      qty: 1,
      idempotencyKey: 'expire-me',
    });
    expect(available().egg).toBe(8);

    clock.advance(RESERVATION_TTL_MS);

    const [item] = cartView(clock.now());
    expect(item?.status).toBe('expired');
    expect(item?.editable).toBe(false);
    expect(item?.expiresInMs).toBe(0);

    // The ingredients went back to free stock.
    expect(available().egg).toBe(10);
    expect(getState().reservations.size).toBe(0);

    // An expired item cannot be edited...
    const edit = editItem({
      itemId: added.ok ? added.item.id : '',
      selection: SELECTION_A,
      qty: 2,
    });
    expect(edit.ok).toBe(false);
    expect(!edit.ok && edit.code).toBe('expired');

    // ...but it can still be removed.
    const removed = removeItem(added.ok ? added.item.id : '');
    expect(removed.ok).toBe(true);
    expect(getState().cart.size).toBe(0);
  });

  it('does not extend the hold when an item is edited', () => {
    const added = reserveItem({
      selection: SELECTION_B,
      qty: 1,
      idempotencyKey: 'no-extend',
    });
    clock.advance(4 * 60_000); // 4:00 gone, 1:00 left

    const edited = editItem({
      itemId: added.ok ? added.item.id : '',
      selection: { ...SELECTION_B, omelette: 1, fried: 3 },
      qty: 1,
    });
    expect(edited.ok).toBe(true);

    const [item] = cartView(clock.now());
    expect(item?.expiresInMs).toBe(60_000);
  });
});

describe('edits are one atomic net-difference swap', () => {
  it('serves TC-10 from the ingredients the item already holds', () => {
    const b = reserveItem({ selection: SELECTION_B, qty: 1, idempotencyKey: 'b' });
    reserveItem({ selection: SELECTION_C, qty: 2, idempotencyKey: 'c' });
    expect(available().egg).toBe(0);

    const edited = editItem({
      itemId: b.ok ? b.item.id : '',
      selection: { ...SELECTION_B, omelette: 1, fried: 3 },
      qty: 1,
    });

    expect(edited.ok).toBe(true);
    expect(edited.ok && edited.item.unitPrice).toBe(bdt(643.5));
    expect(available().egg).toBe(1);
    expect(edited.ok && edited.item.version).toBe(2);
  });

  it('blocks TC-09 with the exact shortage and changes nothing', () => {
    const b = reserveItem({ selection: SELECTION_B, qty: 1, idempotencyKey: 'b' });
    reserveItem({ selection: SELECTION_C, qty: 2, idempotencyKey: 'c' });

    const blocked = editItem({
      itemId: b.ok ? b.item.id : '',
      selection: { ...SELECTION_B, omelette: 3, fried: 1 },
      qty: 1,
    });

    expect(blocked.ok).toBe(false);
    expect(!blocked.ok && blocked.message).toBe('Short: 1 egg');
    expect(available().egg).toBe(0);
    expect(getState().cart.get(b.ok ? b.item.id : '')?.version).toBe(1);
  });

  it('blocks TC-11 and lists every shortage', () => {
    reserveItem({ selection: SELECTION_B, qty: 1, idempotencyKey: 'b' });
    const c = reserveItem({ selection: SELECTION_C, qty: 2, idempotencyKey: 'c' });

    const blocked = editItem({
      itemId: c.ok ? c.item.id : '',
      selection: SELECTION_C,
      qty: 3,
    });

    expect(blocked.ok).toBe(false);
    expect(!blocked.ok && blocked.message).toBe('Short: 2 egg, 2 cheese');
  });

  it('rejects an invalid configuration server-side', () => {
    const a = reserveItem({ selection: SELECTION_A, qty: 1, idempotencyKey: 'a' });
    const bad = editItem({
      itemId: a.ok ? a.item.id : '',
      selection: { ...SELECTION_A, scrambled: 3 },
      qty: 1,
    });
    expect(bad.ok).toBe(false);
    expect(!bad.ok && bad.code).toBe('invalid');
  });

  it('rejects a quantity outside the menu range', () => {
    const over = reserveItem({
      selection: SELECTION_A,
      qty: 4,
      idempotencyKey: 'too-many',
    });
    expect(over.ok).toBe(false);
    expect(!over.ok && over.message).toMatch(/1 to 3/);
  });

  it('gives a stale tab a conflict instead of overwriting (Part G groundwork)', () => {
    const a = reserveItem({ selection: SELECTION_A, qty: 1, idempotencyKey: 'a' });
    const id = a.ok ? a.item.id : '';

    expect(editItem({ itemId: id, selection: SELECTION_A, qty: 2, expectedVersion: 1 }).ok).toBe(
      true,
    );
    const stale = editItem({
      itemId: id,
      selection: SELECTION_A,
      qty: 3,
      expectedVersion: 1,
    });
    expect(stale.ok).toBe(false);
    expect(!stale.ok && stale.code).toBe('conflict');
  });
});

describe('removing an item hands its ingredients back', () => {
  it('releases exactly what it held', () => {
    const b = reserveItem({ selection: SELECTION_B, qty: 1, idempotencyKey: 'b' });
    expect(available().egg).toBe(4);
    removeItem(b.ok ? b.item.id : '');
    expect(available().egg).toBe(10);
    expect(available().croissant).toBe(2);
  });

  it('is a 404 for an unknown id', () => {
    const missing = removeItem('CI-nope');
    expect(missing.ok).toBe(false);
    expect(!missing.ok && missing.code).toBe('not_found');
  });
});
