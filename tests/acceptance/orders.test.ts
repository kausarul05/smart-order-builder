/**
 * TC-16 .. TC-17 - Part E, checkout and orders stored as JSON.
 */

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { bdt } from '@/domain/money';
import { priceCart } from '@/domain/pricing/priceCart';
import { availableMap } from '@/domain/stock/ingredients';
import { serialiseOrdersFile } from '@/features/checkout/downloadOrders';
import { reserveItem, setFault } from '@/server/cart';
import {
  RESERVATION_TTL_MS,
  manualClock,
  resetServerClock,
  setServerClock,
} from '@/server/clock';
import {
  checkout,
  initOrders,
  listOrders,
  nextOrderId,
  ordersFile,
} from '@/server/orders';
import {
  getState,
  loadOrdersFromStorage,
  priceSeedOrders,
  resetState,
  snapshot,
} from '@/server/state';
import { DEFAULT_MENU } from '@/fixtures/menu.default';
import type { SeedOrdersFile, StoredOrder } from '@/domain/types';
import seedJson from '../../public/orders.seed.json';
import { SELECTION_A, SELECTION_B, SELECTION_C } from '../fixtures/configs';

const seed = seedJson as unknown as SeedOrdersFile;
const START = new Date('2026-11-25T09:00:00+06:00');

let clock: ReturnType<typeof manualClock>;

const available = () => availableMap(snapshot(), DEFAULT_MENU.ingredients);

beforeEach(() => {
  localStorage.clear();
  resetState();
  clock = manualClock(START);
  setServerClock(clock);
  setFault('none');
});

afterEach(() => {
  setFault('none');
  resetServerClock();
  localStorage.clear();
});

const addA = (key = 'add-a') =>
  reserveItem({ selection: SELECTION_A, qty: 1, idempotencyKey: key });

describe('TC-16 - checkout is atomic and idempotent', () => {
  it('two fast Pay clicks create exactly one order', () => {
    addA();
    const key = 'pay-once';

    const first = checkout({ paymentMethod: 'card', idempotencyKey: key });
    const second = checkout({ paymentMethod: 'card', idempotencyKey: key });

    expect(first.ok && first.replayed).toBe(false);
    expect(second.ok && second.replayed).toBe(true);
    expect(first.ok && second.ok && first.order.id).toBe(second.ok ? second.order.id : '');
    expect(listOrders()).toHaveLength(1);
  });

  it('empties the cart and turns reserved stock into sold stock', () => {
    addA();
    // A uses 2 eggs; 10 - 2 reserved = 8 available.
    expect(available().egg).toBe(8);

    const result = checkout({ paymentMethod: 'bkash', idempotencyKey: 'sell' });
    expect(result.ok).toBe(true);

    const state = getState();
    expect(state.cart.size).toBe(0);
    expect(state.reservations.size).toBe(0);
    expect(state.sold.egg).toBe(2);
    // Still 8: the eggs moved from reserved to sold, they did not come back.
    expect(available().egg).toBe(8);
  });

  it('does not release sold stock when the old hold would have expired', () => {
    addA();
    checkout({ paymentMethod: 'cash', idempotencyKey: 'sold-stays' });

    // Walk well past the 5-minute window. The reservation was consumed, not
    // released, so there is nothing left for the sweep to hand back.
    clock.advance(RESERVATION_TTL_MS * 3);
    expect(available().egg).toBe(8);
    expect(getState().sold.egg).toBe(2);
  });

  it('creates the order id and the timestamp on the server (D4)', () => {
    addA();
    const result = checkout({ paymentMethod: 'card', idempotencyKey: 'ids' });
    expect(result.ok && result.order.id).toBe('ORD-1001');
    // The server clock, not the host clock.
    expect(result.ok && result.order.createdAt).toBe('2026-11-25T09:00:00+06:00');
  });

  it('continues the seed sequence when seed orders are present', () => {
    initOrders(seed);
    expect(nextOrderId(listOrders())).toBe('ORD-1007');
    addA();
    const result = checkout({ paymentMethod: 'card', idempotencyKey: 'after-seed' });
    expect(result.ok && result.order.id).toBe('ORD-1007');
    expect(listOrders()).toHaveLength(7);
  });

  it('charges the unit price locked at Add to Cart, not a later menu price', () => {
    const added = reserveItem({
      selection: SELECTION_B,
      qty: 1,
      idempotencyKey: 'locked',
    });
    expect(added.ok && added.item.unitPrice).toBe(bdt(679.5));

    // The shop doubles the price of Beef Bacon after the item is in the cart.
    const state = getState();
    state.menu = {
      ...state.menu,
      groups: state.menu.groups.map((group) =>
        group.id !== 'protein'
          ? group
          : {
              ...group,
              options: group.options.map((option) =>
                option.id === 'bacon' ? { ...option, price: bdt(180) } : option,
              ),
            },
      ),
    };

    const result = checkout({ paymentMethod: 'card', idempotencyKey: 'locked-pay' });
    expect(result.ok && result.order.lines[0]?.unitPrice).toBe(bdt(679.5));
    expect(result.ok && result.order.totals.lines[0]?.unit.locked).toBe(true);
  });

  it('recomputes the cart discount at checkout, consistent with TC-06/TC-07', () => {
    // Reserve just inside the coupon window, so the 5-minute holds are
    // still alive when Pay is pressed a second later.
    clock.set(new Date('2026-11-25T10:59:58+06:00'));
    reserveItem({ selection: SELECTION_B, qty: 1, idempotencyKey: 'b' });
    reserveItem({ selection: SELECTION_C, qty: 2, idempotencyKey: 'c' });

    clock.set(new Date('2026-11-25T10:59:59+06:00'));
    const early = checkout({
      paymentMethod: 'card',
      couponCode: 'MORNING15',
      idempotencyKey: 'early',
    });
    expect(early.ok && early.order.totals.subtotal).toBe(bdt(1659.5));
    expect(early.ok && early.order.totals.discount?.id).toBe('C2');
    expect(early.ok && early.order.totals.payable).toBe(bdt(1585));
    expect(early.ok && early.order.coupon.applied).toBe('MORNING15');
  });

  it('records a coupon that was entered but rejected (D6)', () => {
    // Holds taken at 10:59:59 are still valid one second later, but the
    // coupon window has closed in between - which is the whole point.
    clock.set(new Date('2026-11-25T10:59:59+06:00'));
    reserveItem({ selection: SELECTION_B, qty: 1, idempotencyKey: 'b' });
    reserveItem({ selection: SELECTION_C, qty: 2, idempotencyKey: 'c' });

    clock.set(new Date('2026-11-25T11:00:00+06:00'));
    const late = checkout({
      paymentMethod: 'card',
      couponCode: 'MORNING15',
      idempotencyKey: 'late',
    });

    expect(late.ok && late.order.coupon.entered).toBe('MORNING15');
    expect(late.ok && late.order.coupon.applied).toBeNull();
    expect(late.ok && late.order.coupon.rejectedReason).toBe(
      'MORNING15 is only valid before 11:00 (Asia/Dhaka)',
    );
    expect(late.ok && late.order.totals.discount?.id).toBe('C1');
    expect(late.ok && late.order.totals.payable).toBe(bdt(1637));
  });

  it('refuses an empty cart and an all-expired cart', () => {
    const empty = checkout({ paymentMethod: 'card', idempotencyKey: 'empty' });
    expect(!empty.ok && empty.code).toBe('empty_cart');

    addA();
    clock.advance(RESERVATION_TTL_MS);
    const stale = checkout({ paymentMethod: 'card', idempotencyKey: 'stale' });
    expect(!stale.ok && stale.code).toBe('expired_items');
    expect(listOrders()).toHaveLength(0);
  });

  it('collects no payment data - the method is only a label', () => {
    addA();
    const result = checkout({ paymentMethod: 'bkash', idempotencyKey: 'label' });
    const order = result.ok ? result.order : null;
    expect(order?.paymentMethod).toBe('bkash');
    expect(JSON.stringify(order)).not.toMatch(/card_?number|cvv|pin|account/i);
  });

  it('rejects a payment method that is not on the list', () => {
    addA();
    const bad = checkout({
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      paymentMethod: 'crypto' as any,
      idempotencyKey: 'bad-method',
    });
    expect(!bad.ok && bad.code).toBe('invalid_payment');
    expect(getState().cart.size).toBe(1);
  });
});

describe('TC-17 - orders survive a refresh and export as one JSON file', () => {
  it('prices the six seed orders with our own engine at their own createdAt', () => {
    const orders = initOrders(seed);
    expect(orders).toHaveLength(6);

    // Spot-check the two that prove the time-sensitive coupon:
    // 10:05 is inside the window, 13:10 is not.
    const inWindow = orders.find((order) => order.id === 'ORD-1003');
    expect(inWindow?.coupon.applied).toBe('MORNING15');
    expect(inWindow?.totals.payable).toBe(bdt(1271));

    const outOfWindow = orders.find((order) => order.id === 'ORD-1006');
    expect(outOfWindow?.coupon.entered).toBe('MORNING15');
    expect(outOfWindow?.coupon.applied).toBeNull();
    expect(outOfWindow?.totals.payable).toBe(bdt(1228));

    // Every seed order came in without a price and left with one.
    for (const order of orders) {
      expect(order.totals.payable % 100).toBe(0);
      expect(order.lines.every((line) => line.unitPrice > 0)).toBe(true);
    }
  });

  it('reloads the store after a refresh instead of re-seeding', () => {
    initOrders(seed);
    addA();
    const paid = checkout({ paymentMethod: 'card', idempotencyKey: 'before-refresh' });
    expect(paid.ok).toBe(true);
    expect(listOrders()).toHaveLength(7);

    // "Refresh": fresh server state, same localStorage.
    resetState();
    expect(listOrders()).toHaveLength(0);
    loadOrdersFromStorage();

    const restored = listOrders();
    expect(restored).toHaveLength(7);
    expect(restored.map((order) => order.id)).toContain('ORD-1007');

    // The seed must NOT be laid on top of the restored store.
    initOrders(seed);
    expect(listOrders()).toHaveLength(7);
  });

  it('exports seed and new orders together as valid JSON', () => {
    initOrders(seed);
    addA();
    checkout({ paymentMethod: 'cash', idempotencyKey: 'export' });

    const file = ordersFile();
    const text = serialiseOrdersFile(file);
    const parsed = JSON.parse(text) as typeof file;

    expect(parsed.schemaVersion).toBe(1);
    expect(parsed.currency).toBe('BDT');
    // The money unit is declared, so no reader has to guess (D6).
    expect(parsed.moneyUnit).toBe('poisha');
    expect(parsed.exportedAt).toBe('2026-11-25T09:00:00+06:00');
    expect(parsed.orders).toHaveLength(7);

    const fresh = parsed.orders.find((order: StoredOrder) => order.id === 'ORD-1007');
    // A x1 at 380.00 with no coupon: VAT 19.00, payable 399 BDT.
    expect(fresh?.totals.payable).toBe(bdt(399));
    expect(fresh?.lines[0]?.options).toEqual(SELECTION_A);
  });

  it('stores the menu version, so an old order can still be explained', () => {
    addA();
    const result = checkout({ paymentMethod: 'card', idempotencyKey: 'version' });
    expect(result.ok && result.order.menuVersion).toBe(DEFAULT_MENU.version);
  });

  it('agrees with the pricing engine run directly over the same lines', () => {
    const orders = priceSeedOrders(seed, DEFAULT_MENU);
    for (const order of orders) {
      const recomputed = priceCart({
        cart: order.lines.map((line) => ({
          selection: line.options,
          qty: line.qty,
        })),
        menu: DEFAULT_MENU,
        couponCode: order.coupon.entered,
        serverTime: new Date(order.createdAt),
      });
      expect(recomputed.payable).toBe(order.totals.payable);
    }
  });
});
