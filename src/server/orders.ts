/**
 * Part E - checkout, and orders stored as JSON.
 *
 *   TC-16  Checkout is atomic and idempotent: the reserved stock becomes
 *          SOLD stock, the cart empties, and two fast Pay clicks produce
 *          exactly one order. Because the reservations are consumed rather
 *          than released, sold stock is never handed back later.
 *   TC-17  Orders survive a refresh (localStorage), the six seed orders are
 *          priced with our own engine at their own `createdAt`, and the
 *          whole store exports as one JSON file.
 *
 * D4: the SERVER creates the order id and the timestamp. The browser never
 * invents either, and the `Idempotency-Key` is what actually stops a double
 * click - the disabled button is only a courtesy.
 */

import { couponOutcome, priceCart } from '@/domain/pricing/priceCart';
import { toIsoWithOffset } from '@/domain/time';
import type {
  OrderLine,
  OrdersFile,
  PaymentMethod,
  PriceBreakdown,
  SeedOrdersFile,
  StoredOrder,
} from '@/domain/types';
import { transact } from './cart';
import { SERVER_TIME_ZONE, serverNow } from './clock';
import {
  getState,
  priceSeedOrders,
  saveOrdersToStorage,
  sweepExpired,
} from './state';

export const PAYMENT_METHODS: readonly PaymentMethod[] = ['card', 'bkash', 'cash'];

export type CheckoutFailure =
  | { readonly code: 'empty_cart'; readonly message: string }
  | { readonly code: 'expired_items'; readonly message: string }
  | { readonly code: 'invalid_payment'; readonly message: string };

export type CheckoutResult =
  | { readonly ok: true; readonly order: StoredOrder; readonly replayed: boolean }
  | ({ readonly ok: false } & CheckoutFailure);

export interface CheckoutInput {
  readonly paymentMethod: PaymentMethod;
  readonly couponCode?: string | null;
  readonly idempotencyKey: string;
}

/**
 * Server-side order ids continue the seed sequence, so a reviewer reading
 * the exported file sees ORD-1007 following ORD-1006 rather than a UUID.
 */
export function nextOrderId(orders: readonly StoredOrder[]): string {
  let highest = 1000;
  for (const order of orders) {
    const match = /^ORD-(\d+)$/.exec(order.id);
    if (match === null) continue;
    highest = Math.max(highest, Number(match[1]));
  }
  return `ORD-${highest + 1}`;
}

export function checkout(input: CheckoutInput): CheckoutResult {
  const now = serverNow();
  sweepExpired(now);
  const state = getState();

  // TC-16: the same key never creates a second order.
  const existingId = state.idempotency.get(input.idempotencyKey);
  if (existingId !== undefined) {
    const existing = state.orders.find((order) => order.id === existingId);
    if (existing !== undefined) {
      return { ok: true, order: existing, replayed: true };
    }
  }

  if (!PAYMENT_METHODS.includes(input.paymentMethod)) {
    return {
      ok: false,
      code: 'invalid_payment',
      message: `Payment method must be one of ${PAYMENT_METHODS.join(', ')}`,
    };
  }

  // "turns all ACTIVE cart items into one order" - an expired item is not
  // holding stock any more, so it cannot be sold.
  const items = [...state.cart.values()];
  const active = items.filter((item) => item.status === 'active');

  if (active.length === 0) {
    return {
      ok: false,
      code: items.length === 0 ? 'empty_cart' : 'expired_items',
      message:
        items.length === 0
          ? 'The cart is empty'
          : 'Every item in the cart has expired. Add them again before paying.',
    };
  }

  const entered = input.couponCode ?? null;

  // Unit prices are the ones locked at Add to Cart (D2); only the cart
  // discount and the VAT are decided now, at checkout.
  const breakdown: PriceBreakdown = priceCart({
    cart: active.map((item) => ({
      selection: item.selection,
      qty: item.qty,
      lockedUnitPrice: item.unitPrice,
    })),
    menu: state.menu,
    couponCode: entered,
    serverTime: now,
  });

  const lines: OrderLine[] = active.map((item, index) => {
    const priced = breakdown.lines[index];
    return {
      qty: item.qty,
      options: item.selection,
      unitPrice: item.unitPrice,
      lineTotal: priced?.lineTotal ?? item.unitPrice * item.qty,
    };
  });

  const order: StoredOrder = {
    id: nextOrderId(state.orders),
    createdAt: toIsoWithOffset(now, SERVER_TIME_ZONE),
    paymentMethod: input.paymentMethod,
    coupon: couponOutcome(breakdown, entered),
    lines,
    totals: breakdown,
    menuVersion: state.menu.version,
  };

  return transact(() => {
    // Reserved -> sold, in one go. The reservation is CONSUMED, not
    // released, which is why the expiry sweep can never give sold stock
    // back afterwards (TC-16).
    for (const item of active) {
      const reservation = state.reservations.get(item.reservationId);
      if (reservation !== undefined) {
        for (const [ingredientId, amount] of Object.entries(reservation.usage)) {
          state.sold[ingredientId] = (state.sold[ingredientId] ?? 0) + amount;
        }
        state.reservations.delete(item.reservationId);
      }
      state.cart.delete(item.id);
    }

    state.orders = [...state.orders, order];
    state.idempotency.set(input.idempotencyKey, order.id);
    state.cartVersion += 1;
    saveOrdersToStorage();

    return { ok: true, order, replayed: false };
  });
}

/* --------------------------------------------------------------- store */

/**
 * First start: price the seed orders with our own engine and put them in
 * the store. A store restored from localStorage wins, so a refresh does not
 * re-seed on top of real orders (TC-17).
 */
export function initOrders(seed: SeedOrdersFile): readonly StoredOrder[] {
  const state = getState();
  if (state.seedLoaded) return state.orders;
  state.orders = priceSeedOrders(seed, state.menu);
  state.seedLoaded = true;
  saveOrdersToStorage();
  return state.orders;
}

export function listOrders(): readonly StoredOrder[] {
  return getState().orders;
}

/** The exact payload behind the "Download orders.json" button. */
export function ordersFile(): OrdersFile {
  const state = getState();
  return {
    schemaVersion: 1,
    currency: 'BDT',
    moneyUnit: 'poisha',
    exportedAt: toIsoWithOffset(serverNow(), SERVER_TIME_ZONE),
    orders: state.orders,
  };
}
