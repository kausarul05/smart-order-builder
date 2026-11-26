/**
 * Part D - the cart, as the mock server sees it.
 *
 * Three guarantees live in this file, and each one is a test in Section 9:
 *
 *   TC-13  An `Idempotency-Key` is remembered, so three fast clicks on
 *          Add to Cart produce one item and one reservation.
 *   TC-14  Every mutation runs inside `transact`, which snapshots the
 *          mutable state and restores it if anything throws. A failed
 *          reserve therefore holds no stock - no "phantom" reservation is
 *          possible, not even half of one.
 *   TC-15  Expiry is decided by the SERVER clock (90 s ahead of the
 *          browser), never by `Date.now()`.
 *
 * An edit is a single atomic swap of the old allocation for the new one and
 * only has to find the positive part of the difference in free stock
 * (Part B's net-difference rule).
 */

import { priceUnit } from '@/domain/pricing/priceCart';
import { validate } from '@/domain/rules/validate';
import { checkChange, formatShortages, lineAllocation } from '@/domain/stock/availability';
import { availableMap } from '@/domain/stock/ingredients';
import { toIsoWithOffset } from '@/domain/time';
import type {
  CartItem,
  Selection,
  Shortage,
  Usage,
  Violation,
} from '@/domain/types';
import { SERVER_TIME_ZONE, serverNow } from './clock';
import {
  allocationFor,
  getState,
  persistState,
  reservationExpiryFrom,
  snapshot,
  sweepExpired,
  type Reservation,
} from './state';

export type CartFailure =
  | { readonly code: 'invalid'; readonly violations: readonly Violation[]; readonly message: string }
  | { readonly code: 'shortage'; readonly shortages: readonly Shortage[]; readonly message: string }
  | { readonly code: 'expired'; readonly message: string }
  | { readonly code: 'not_found'; readonly message: string }
  | { readonly code: 'conflict'; readonly message: string };

export type CartResult =
  | { readonly ok: true; readonly item: CartItem; readonly cartVersion: number }
  | { readonly ok: false } & CartFailure;

export interface CartItemView extends CartItem {
  /** Milliseconds left on the server clock; 0 once it has expired. */
  readonly expiresInMs: number;
  readonly editable: boolean;
}

/* ------------------------------------------------------- transactions */

interface Backup {
  readonly reservations: Map<string, Reservation>;
  readonly cart: Map<string, CartItem>;
  readonly sold: Record<string, number>;
  readonly idempotency: Map<string, string>;
  readonly cartVersion: number;
}

/**
 * All-or-nothing. The body must not await: every write happens in one
 * synchronous run, so no other request can interleave, and if the body
 * throws the state is put back exactly as it was.
 */
export function transact<T>(body: () => T): T {
  const state = getState();
  const backup: Backup = {
    reservations: new Map(state.reservations),
    cart: new Map(state.cart),
    sold: { ...state.sold },
    idempotency: new Map(state.idempotency),
    cartVersion: state.cartVersion,
  };
  try {
    const result = body();
    // Whatever was committed is now the server's state, so it is written
    // out here rather than at every call site (Part G).
    persistState();
    return result;
  } catch (cause) {
    state.reservations = backup.reservations;
    state.cart = backup.cart;
    state.sold = backup.sold;
    state.idempotency = backup.idempotency;
    state.cartVersion = backup.cartVersion;
    throw cause;
  }
}

/**
 * Test-only fault injection, to prove TC-14 rather than assert it. The
 * fault fires in the middle of a reserve, after the reservation has been
 * written but before the cart item has, which is exactly the window a
 * phantom reservation would appear in.
 */
export type Fault = 'none' | 'mid-reserve' | 'mid-edit';
let fault: Fault = 'none';

export function setFault(next: Fault): void {
  fault = next;
}

function maybeFault(at: Fault): void {
  if (fault === at) throw new Error(`simulated server crash at ${at}`);
}

/* ------------------------------------------------------------ reading */

export function cartView(now: Date = serverNow()): readonly CartItemView[] {
  sweepExpired(now);
  const state = getState();
  return [...state.cart.values()].map((item) => {
    const expiresAt = Date.parse(item.expiresAt);
    const expiresInMs = Math.max(0, expiresAt - now.getTime());
    return {
      ...item,
      expiresInMs,
      // An expired item can be removed, but not edited.
      editable: item.status === 'active' && expiresInMs > 0,
    };
  });
}

/* ------------------------------------------------------------ writing */

export interface ReserveInput {
  readonly selection: Selection;
  readonly qty: number;
  readonly idempotencyKey: string;
}

export function reserveItem(input: ReserveInput): CartResult {
  const now = serverNow();
  sweepExpired(now);
  const state = getState();

  // TC-13: the same key never reserves twice.
  const existingId = state.idempotency.get(input.idempotencyKey);
  if (existingId !== undefined) {
    const existing = state.cart.get(existingId);
    if (existing !== undefined) {
      return { ok: true, item: existing, cartVersion: state.cartVersion };
    }
  }

  const qtyError = checkQty(input.qty);
  if (qtyError !== null) return qtyError;

  const violations = validate(
    { productId: state.menu.productId, selection: input.selection },
    state.menu.groups,
    state.menu.rules,
  );
  if (violations.length > 0) {
    return {
      ok: false,
      code: 'invalid',
      violations,
      message: violations.map((violation) => violation.message).join('; '),
    };
  }

  const needed = lineAllocation(input.selection, state.menu.groups, input.qty);
  const change = checkChange({
    current: {},
    next: needed,
    available: availableMap(snapshot(), state.menu.ingredients),
    ingredients: state.menu.ingredients,
  });
  if (!change.ok) return shortageFailure(change.shortages);

  const unit = priceUnit(input.selection, state.menu);
  const itemId = `CI-${crypto.randomUUID()}`;
  const reservationId = `RS-${crypto.randomUUID()}`;
  const expiresAt = reservationExpiryFrom(now);

  return transact(() => {
    state.reservations.set(reservationId, {
      id: reservationId,
      cartItemId: itemId,
      usage: needed,
      expiresAt,
    });

    maybeFault('mid-reserve');

    const item: CartItem = {
      id: itemId,
      productId: state.menu.productId,
      selection: input.selection,
      qty: input.qty,
      // D2: the unit price is locked here and does not move again.
      unitPrice: unit.unitPrice,
      pricedAt: toIsoWithOffset(now, SERVER_TIME_ZONE),
      reservationId,
      expiresAt: new Date(expiresAt).toISOString(),
      status: 'active',
      version: 1,
    };
    state.cart.set(itemId, item);
    state.idempotency.set(input.idempotencyKey, itemId);
    state.cartVersion += 1;

    return { ok: true, item, cartVersion: state.cartVersion };
  });
}

export interface EditInput {
  readonly itemId: string;
  readonly selection: Selection;
  readonly qty: number;
  /** Part G: a stale tab sends an old version and gets a conflict. */
  readonly expectedVersion?: number;
}

export function editItem(input: EditInput): CartResult {
  const now = serverNow();
  sweepExpired(now);
  const state = getState();

  const item = state.cart.get(input.itemId);
  if (item === undefined) {
    return { ok: false, code: 'not_found', message: 'That item is no longer in the cart' };
  }

  // TC-15: an expired hold is read-only. It can be removed, not edited.
  if (item.status !== 'active') {
    return {
      ok: false,
      code: 'expired',
      message:
        'This item’s 5-minute hold expired and its ingredients were released. Add it again to try for them.',
    };
  }

  if (input.expectedVersion !== undefined && input.expectedVersion !== item.version) {
    return {
      ok: false,
      code: 'conflict',
      message: 'This item changed in another tab. Reload to see the current cart.',
    };
  }

  const qtyError = checkQty(input.qty);
  if (qtyError !== null) return qtyError;

  const violations = validate(
    { productId: state.menu.productId, selection: input.selection },
    state.menu.groups,
    state.menu.rules,
  );
  if (violations.length > 0) {
    return {
      ok: false,
      code: 'invalid',
      violations,
      message: violations.map((violation) => violation.message).join('; '),
    };
  }

  const reservation = state.reservations.get(item.reservationId);
  const current: Usage = reservation?.usage ?? allocationFor(item);
  const next = lineAllocation(input.selection, state.menu.groups, input.qty);

  // The net-difference rule: the item's own allocation is already excluded
  // from `available`, so only the extra beyond what it holds must be found.
  const change = checkChange({
    current,
    next,
    available: availableMap(snapshot(), state.menu.ingredients),
    ingredients: state.menu.ingredients,
  });
  if (!change.ok) return shortageFailure(change.shortages);

  const unit = priceUnit(input.selection, state.menu);

  return transact(() => {
    // One swap, not a release followed by a reserve - nothing can take the
    // ingredients in between, and nothing is ever double-counted.
    state.reservations.set(item.reservationId, {
      id: item.reservationId,
      cartItemId: item.id,
      usage: next,
      // An edit does NOT extend the hold: the 5 minutes belong to the
      // reservation, so editing cannot park stock indefinitely.
      expiresAt: reservation?.expiresAt ?? reservationExpiryFrom(now),
    });

    maybeFault('mid-edit');

    const updated: CartItem = {
      ...item,
      selection: input.selection,
      qty: input.qty,
      unitPrice: unit.unitPrice,
      pricedAt: toIsoWithOffset(now, SERVER_TIME_ZONE),
      version: item.version + 1,
    };
    state.cart.set(item.id, updated);
    state.cartVersion += 1;

    return { ok: true, item: updated, cartVersion: state.cartVersion };
  });
}

export function removeItem(itemId: string): CartResult {
  sweepExpired();
  const state = getState();
  const item = state.cart.get(itemId);
  if (item === undefined) {
    return { ok: false, code: 'not_found', message: 'That item is no longer in the cart' };
  }

  return transact(() => {
    state.reservations.delete(item.reservationId);
    state.cart.delete(itemId);
    state.cartVersion += 1;
    return { ok: true, item, cartVersion: state.cartVersion };
  });
}

/* ------------------------------------------------------------ helpers */

function checkQty(qty: number): (CartResult & { ok: false }) | null {
  const { itemQty } = getState().menu;
  if (!Number.isInteger(qty) || qty < itemQty.min || qty > itemQty.max) {
    return {
      ok: false,
      code: 'invalid',
      violations: [],
      message: `Quantity must be a whole number from ${itemQty.min} to ${itemQty.max}`,
    };
  }
  return null;
}

function shortageFailure(shortages: readonly Shortage[]): CartResult & { ok: false } {
  return {
    ok: false,
    code: 'shortage',
    shortages,
    message: formatShortages(shortages),
  };
}
