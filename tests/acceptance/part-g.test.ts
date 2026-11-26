/**
 * Part G - the bonus, now that A to F are correct and tested.
 *
 *   Refresh keeps only still-valid reservations, with the server as the
 *   source of truth.
 *
 *   Two tabs: cart changes carry a version number; a stale tab gets a
 *   conflict and reloads, never silently overwrites.
 *
 *   An unfinished configuration survives a refresh. (That one lives in
 *   the Configurator and is covered by part-g-draft.test.tsx.)
 *
 * A "refresh" here is `resetState()` followed by `restoreState()`: fresh
 * in-memory server, same localStorage - exactly what the browser does.
 */

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { availableMap } from '@/domain/stock/ingredients';
import { cartView, editItem, reserveItem, removeItem } from '@/server/cart';
import {
  RESERVATION_TTL_MS,
  manualClock,
  resetServerClock,
  setServerClock,
} from '@/server/clock';
import { checkout, initOrders, listOrders } from '@/server/orders';
import {
  SERVER_STORAGE_KEY,
  getState,
  resetState,
  restoreState,
  snapshot,
} from '@/server/state';
import { DEFAULT_MENU } from '@/fixtures/menu.default';
import type { SeedOrdersFile } from '@/domain/types';
import seedJson from '../../public/orders.seed.json';
import { SELECTION_A, SELECTION_B } from '../fixtures/configs';

const seed = seedJson as unknown as SeedOrdersFile;
const START = new Date('2026-11-25T09:00:00+06:00');

let clock: ReturnType<typeof manualClock>;

const available = () => availableMap(snapshot(), DEFAULT_MENU.ingredients);

/** What the browser does on F5: new server memory, same storage. */
const refresh = (): boolean => {
  resetState();
  return restoreState(clock.now());
};

beforeEach(() => {
  localStorage.clear();
  resetState();
  clock = manualClock(START);
  setServerClock(clock);
});

afterEach(() => {
  resetServerClock();
  localStorage.clear();
});

describe('G1 - a refresh keeps only still-valid reservations', () => {
  it('keeps a hold that has time left, and the stock it holds', () => {
    reserveItem({ selection: SELECTION_A, qty: 1, idempotencyKey: 'a' });
    expect(available().egg).toBe(8);

    clock.advance(60_000); // one minute of five
    expect(refresh()).toBe(true);

    const [item] = cartView(clock.now());
    expect(item?.status).toBe('active');
    expect(item?.expiresInMs).toBe(RESERVATION_TTL_MS - 60_000);
    // The server is the source of truth, so the stock is still held.
    expect(available().egg).toBe(8);
  });

  it('drops a hold that ran out while the tab was away, and frees its stock', () => {
    reserveItem({ selection: SELECTION_A, qty: 1, idempotencyKey: 'a' });
    expect(available().egg).toBe(8);

    clock.advance(RESERVATION_TTL_MS + 1_000);
    refresh();

    const [item] = cartView(clock.now());
    // The item is still listed, read-only, exactly as the sweep leaves it.
    expect(item?.status).toBe('expired');
    expect(item?.editable).toBe(false);
    expect(getState().reservations.size).toBe(0);
    expect(available().egg).toBe(10);
  });

  it('keeps the live holds and drops the dead ones in the same cart', () => {
    reserveItem({ selection: SELECTION_A, qty: 1, idempotencyKey: 'early' });
    clock.advance(4 * 60_000);
    reserveItem({ selection: SELECTION_B, qty: 1, idempotencyKey: 'late' });

    // Two more minutes: the first hold is gone, the second has three left.
    clock.advance(2 * 60_000);
    refresh();

    const items = cartView(clock.now());
    expect(items.filter((item) => item.status === 'active')).toHaveLength(1);
    expect(items.filter((item) => item.status === 'expired')).toHaveLength(1);
    // A's two eggs came back; B's six are still held.
    expect(available().egg).toBe(4);
  });

  it('keeps sold stock sold across a refresh', () => {
    reserveItem({ selection: SELECTION_A, qty: 1, idempotencyKey: 'a' });
    checkout({ paymentMethod: 'card', idempotencyKey: 'pay' });
    expect(available().egg).toBe(8);

    clock.advance(RESERVATION_TTL_MS * 2);
    refresh();

    // Sold is not a reservation, so no sweep can hand it back.
    expect(getState().sold.egg).toBe(2);
    expect(available().egg).toBe(8);
  });

  it('keeps the idempotency keys, so a replayed add stays one item', () => {
    reserveItem({ selection: SELECTION_A, qty: 1, idempotencyKey: 'same-intent' });
    refresh();

    reserveItem({ selection: SELECTION_A, qty: 1, idempotencyKey: 'same-intent' });
    expect(getState().cart.size).toBe(1);
    expect(available().egg).toBe(8);
  });

  it('starts clean when there is nothing stored', () => {
    expect(refresh()).toBe(false);
    expect(getState().cart.size).toBe(0);
  });

  it('refuses a store written against a different menu', () => {
    reserveItem({ selection: SELECTION_A, qty: 1, idempotencyKey: 'a' });

    const raw = JSON.parse(localStorage.getItem(SERVER_STORAGE_KEY) ?? '{}') as {
      menuVersion: string;
    };
    localStorage.setItem(
      SERVER_STORAGE_KEY,
      JSON.stringify({ ...raw, menuVersion: 'some-other-fixture' }),
    );

    expect(refresh()).toBe(false);
    expect(getState().cart.size).toBe(0);
  });

  it('survives a corrupt store rather than failing to boot', () => {
    localStorage.setItem(SERVER_STORAGE_KEY, 'not json at all');
    expect(refresh()).toBe(false);
    expect(getState().cart.size).toBe(0);
  });
});

describe('G2 - a stale tab gets a conflict, never a silent overwrite', () => {
  it('refuses an edit against a version another tab has moved past', () => {
    const added = reserveItem({ selection: SELECTION_A, qty: 1, idempotencyKey: 'a' });
    const id = added.ok ? added.item.id : '';

    // Tab B edits first and wins; the item is now at version 2.
    expect(editItem({ itemId: id, selection: SELECTION_A, qty: 2, expectedVersion: 1 }).ok).toBe(
      true,
    );

    // Tab A still believes it is version 1.
    const stale = editItem({
      itemId: id,
      selection: SELECTION_A,
      qty: 3,
      expectedVersion: 1,
    });
    expect(stale.ok).toBe(false);
    expect(!stale.ok && stale.code).toBe('conflict');
    // The winning edit stands; nothing was overwritten.
    expect(getState().cart.get(id)?.qty).toBe(2);
  });

  it('refuses a checkout against a stale cart version', () => {
    reserveItem({ selection: SELECTION_A, qty: 1, idempotencyKey: 'a' });
    const seen = getState().cartVersion;

    // Another tab adds something after this one last looked.
    reserveItem({ selection: SELECTION_B, qty: 1, idempotencyKey: 'b' });

    const stale = checkout({
      paymentMethod: 'card',
      idempotencyKey: 'pay',
      expectedCartVersion: seen,
    });
    expect(stale.ok).toBe(false);
    expect(!stale.ok && stale.code).toBe('conflict');
    expect(!stale.ok && stale.message).toMatch(/changed in another tab/);
    // Nothing was charged for the cart the customer could not see.
    expect(listOrders()).toHaveLength(0);
    expect(getState().cart.size).toBe(2);
  });

  it('lets the same checkout through once the tab has caught up', () => {
    reserveItem({ selection: SELECTION_A, qty: 1, idempotencyKey: 'a' });
    reserveItem({ selection: SELECTION_B, qty: 1, idempotencyKey: 'b' });

    const paid = checkout({
      paymentMethod: 'card',
      idempotencyKey: 'pay',
      expectedCartVersion: getState().cartVersion,
    });
    expect(paid.ok).toBe(true);
    expect(listOrders()).toHaveLength(1);
  });

  it('still pays when no version is claimed, so a single tab is unaffected', () => {
    reserveItem({ selection: SELECTION_A, qty: 1, idempotencyKey: 'a' });
    expect(checkout({ paymentMethod: 'cash', idempotencyKey: 'pay' }).ok).toBe(true);
  });

  it('publishes every cart change, so the other tab can follow it', () => {
    const added = reserveItem({ selection: SELECTION_A, qty: 1, idempotencyKey: 'a' });
    const first = localStorage.getItem(SERVER_STORAGE_KEY);
    expect(first).not.toBeNull();

    removeItem(added.ok ? added.item.id : '');
    const second = localStorage.getItem(SERVER_STORAGE_KEY);
    expect(second).not.toBe(first);

    // A second tab reading that store sees the removal.
    resetState();
    restoreState(clock.now());
    expect(getState().cart.size).toBe(0);
    expect(available().egg).toBe(10);
  });
});

describe('the order store and the server store stay independent', () => {
  it('keeps seed orders out of sold stock', () => {
    initOrders(seed);
    // The seed orders are history; today's shelves are untouched by them.
    expect(available().egg).toBe(10);
    expect(getState().sold).toEqual({});
  });
});
