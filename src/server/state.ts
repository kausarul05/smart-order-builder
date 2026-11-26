/**
 * The mock server's state. This module IS the backend: it owns the menu,
 * the stock, the reservations, the cart and the orders, and it is the only
 * source of truth. Components never reach in here - they go through
 * `src/api/client.ts` and MSW.
 *
 * Persistence (Part E): orders are written to localStorage as JSON so they
 * survive a refresh. Stock and reservations are rebuilt from the orders and
 * the surviving reservations on boot (Part G).
 */

import { priceCart } from '@/domain/pricing/priceCart';
import { lineAllocation } from '@/domain/stock/availability';
import { toIsoWithOffset } from '@/domain/time';
import type {
  CartItem,
  IngredientId,
  Menu,
  SeedOrdersFile,
  StockSnapshot,
  StoredOrder,
  Usage,
} from '@/domain/types';
import { DEFAULT_MENU, DEFAULT_STOCK } from '@/fixtures/menu.default';
import { RESERVATION_TTL_MS, SERVER_TIME_ZONE, serverNow } from './clock';

export const ORDERS_STORAGE_KEY = 'sob.orders.v1';
/**
 * Part G. The mock server IS the source of truth, so what survives a
 * refresh is the server's own state - stock, reservations, cart - not a
 * copy the client kept. Writing it to localStorage also makes it shared
 * between tabs, which is what lets D1 and the stale-tab conflict be
 * demonstrated rather than only described.
 */
export const SERVER_STORAGE_KEY = 'sob.server.v1';

export interface Reservation {
  readonly id: string;
  readonly cartItemId: string;
  readonly usage: Usage;
  /** Server-clock expiry. */
  readonly expiresAt: number;
}

export interface ServerState {
  menu: Menu;
  onHand: Record<IngredientId, number>;
  sold: Record<IngredientId, number>;
  reservations: Map<string, Reservation>;
  cart: Map<string, CartItem>;
  orders: StoredOrder[];
  /** Idempotency key -> the id it already produced (TC-13, TC-16). */
  idempotency: Map<string, string>;
  /** Bumped on every cart mutation, for the stale-tab conflict (Part G). */
  cartVersion: number;
  seedLoaded: boolean;
}

export function createState(menu: Menu = DEFAULT_MENU): ServerState {
  return {
    menu,
    onHand: { ...DEFAULT_STOCK },
    sold: {},
    reservations: new Map(),
    cart: new Map(),
    orders: [],
    idempotency: new Map(),
    cartVersion: 0,
    seedLoaded: false,
  };
}

let state = createState();

export function getState(): ServerState {
  return state;
}

/** Tests call this between cases; it also accepts an alternate menu fixture. */
export function resetState(menu?: Menu): ServerState {
  state = createState(menu ?? DEFAULT_MENU);
  return state;
}

/* ------------------------------------------------------------ expiry */

/**
 * Drops every reservation that has passed its TTL on the SERVER clock and
 * marks the matching cart item read-only. Called at the start of every
 * handler so the state a request sees is never stale (TC-15).
 */
export function sweepExpired(now: Date = serverNow()): readonly string[] {
  const expired: string[] = [];
  for (const reservation of state.reservations.values()) {
    if (reservation.expiresAt > now.getTime()) continue;
    state.reservations.delete(reservation.id);
    expired.push(reservation.cartItemId);
    const item = state.cart.get(reservation.cartItemId);
    if (item) {
      state.cart.set(item.id, { ...item, status: 'expired' });
    }
  }
  if (expired.length > 0) {
    state.cartVersion += 1;
    persistState();
  }
  return expired;
}

export function reservationExpiryFrom(now: Date = serverNow()): number {
  return now.getTime() + RESERVATION_TTL_MS;
}

/* ------------------------------------------------------------- stock */

/** Ingredients currently held by live reservations. */
export function reservedUsage(): Usage {
  const out: Record<IngredientId, number> = {};
  for (const reservation of state.reservations.values()) {
    for (const [id, amount] of Object.entries(reservation.usage)) {
      out[id] = (out[id] ?? 0) + amount;
    }
  }
  return out;
}

export function snapshot(): StockSnapshot {
  return { onHand: state.onHand, reserved: reservedUsage(), sold: state.sold };
}

/* ------------------------------------------------- orders persistence */

export function loadOrdersFromStorage(): void {
  try {
    const raw = localStorage.getItem(ORDERS_STORAGE_KEY);
    if (raw === null) return;
    const parsed: unknown = JSON.parse(raw);
    if (parsed !== null && typeof parsed === 'object' && 'orders' in parsed) {
      const { orders } = parsed as { orders: StoredOrder[] };
      state.orders = orders;
      state.seedLoaded = true;
    }
  } catch {
    // A corrupt store must not break boot; the seed is loaded instead.
  }
}

export function saveOrdersToStorage(): void {
  try {
    localStorage.setItem(
      ORDERS_STORAGE_KEY,
      JSON.stringify({ schemaVersion: 1, orders: state.orders }),
    );
  } catch {
    // Private-mode browsers simply lose persistence; Part E still works.
  }
}

/**
 * Loads `/orders.seed.json` on first start and prices every seed order with
 * our OWN engine at that order's `createdAt` (Part E). Seed orders carry no
 * prices on purpose.
 */
export function priceSeedOrders(seed: SeedOrdersFile, menu: Menu): StoredOrder[] {
  return seed.orders.map((order) => {
    const createdAt = new Date(order.createdAt);
    const breakdown = priceCart({
      cart: order.lines.map((line) => ({
        selection: line.options,
        qty: line.qty,
      })),
      menu,
      couponCode: order.couponCode,
      serverTime: createdAt,
    });

    const applied = breakdown.discount?.kind === 'coupon' ? breakdown.discount.code : null;
    const couponCandidate = breakdown.candidates.find(
      (candidate) => candidate.kind === 'coupon',
    );

    return {
      id: order.id,
      createdAt: toIsoWithOffset(createdAt, SERVER_TIME_ZONE),
      paymentMethod: order.paymentMethod,
      coupon: {
        entered: order.couponCode,
        applied,
        rejectedReason:
          order.couponCode !== null && applied === null
            ? (couponCandidate?.reason ?? 'Coupon was not applied')
            : null,
      },
      lines: order.lines.map((line, index) => {
        const priced = breakdown.lines[index];
        return {
          qty: line.qty,
          options: line.options,
          unitPrice: priced?.unit.unitPrice ?? 0,
          lineTotal: priced?.lineTotal ?? 0,
        };
      }),
      totals: breakdown,
      menuVersion: menu.version,
    };
  });
}

/* ------------------------------------------------- server persistence */

interface PersistedState {
  readonly v: 1;
  readonly menuVersion: string;
  readonly onHand: Record<IngredientId, number>;
  readonly sold: Record<IngredientId, number>;
  readonly reservations: readonly Reservation[];
  readonly cart: readonly CartItem[];
  readonly cartVersion: number;
  readonly idempotency: readonly (readonly [string, string])[];
}

/** Called after every successful mutation. Never throws. */
export function persistState(): void {
  try {
    const payload: PersistedState = {
      v: 1,
      menuVersion: state.menu.version,
      onHand: state.onHand,
      sold: state.sold,
      reservations: [...state.reservations.values()],
      cart: [...state.cart.values()],
      cartVersion: state.cartVersion,
      idempotency: [...state.idempotency.entries()],
    };
    localStorage.setItem(SERVER_STORAGE_KEY, JSON.stringify(payload));
  } catch {
    // Private mode loses persistence; the session still works.
  }
}

/**
 * Restores the server's state, dropping every reservation whose five
 * minutes elapsed while the page was away. The stock those held returns
 * to the shelf, and their cart items come back read-only - exactly what
 * the expiry sweep would have done had the tab stayed open.
 *
 * Returns true when something was restored.
 */
export function restoreState(now: Date = serverNow()): boolean {
  let raw: string | null = null;
  try {
    raw = localStorage.getItem(SERVER_STORAGE_KEY);
  } catch {
    return false;
  }
  if (raw === null) return false;

  let parsed: PersistedState;
  try {
    parsed = JSON.parse(raw) as PersistedState;
  } catch {
    return false;
  }
  if (parsed.v !== 1) return false;
  // A store written against a different menu cannot be trusted.
  if (parsed.menuVersion !== state.menu.version) return false;

  state.onHand = { ...parsed.onHand };
  state.sold = { ...parsed.sold };
  state.cartVersion = parsed.cartVersion;
  state.idempotency = new Map(parsed.idempotency);

  const live = parsed.reservations.filter(
    (reservation) => reservation.expiresAt > now.getTime(),
  );
  state.reservations = new Map(live.map((reservation) => [reservation.id, reservation]));

  const held = new Set(live.map((reservation) => reservation.cartItemId));
  state.cart = new Map(
    parsed.cart.map((item) => [
      item.id,
      held.has(item.id) ? item : { ...item, status: 'expired' as const },
    ]),
  );

  return true;
}

/** Ingredients a cart line holds, used when reserving and when swapping. */
export function allocationFor(item: Pick<CartItem, 'selection' | 'qty'>): Usage {
  return lineAllocation(item.selection, state.menu.groups, item.qty);
}
