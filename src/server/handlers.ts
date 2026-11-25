/**
 * The mock API surface. MSW is the server for this task - there is no
 * Django or Node service anywhere in the repo.
 *
 * Every response is wrapped in an envelope carrying `serverTime`, which is
 * how the client learns the 90-second offset (TC-15).
 *
 *   GET  /api/menu              Appendix A: groups, options, rules,
 *                               ingredients, stock levels, promotions
 *   GET  /api/stock             current availability per ingredient
 *   POST /api/price             priced preview: debounced, slow, flaky
 *   GET  /api/cart              cart plus live reservation deadlines
 *   POST /api/cart              reserve atomically  (Idempotency-Key)
 *   PATCH /api/cart/:id         atomic allocation swap (net difference)
 *   DELETE /api/cart/:id        release
 *   POST /api/checkout          one order, atomically  (Idempotency-Key)
 *   GET  /api/orders            every stored order, seed included
 */

import { http, HttpResponse, delay } from 'msw';

import { priceCart } from '@/domain/pricing/priceCart';
import { availableMap } from '@/domain/stock/ingredients';
import type { PaymentMethod, PriceBreakdown, Selection } from '@/domain/types';
import { cartView, editItem, removeItem, reserveItem, type CartResult } from './cart';
import { serverNow } from './clock';
import {
  checkout,
  initOrders,
  listOrders,
  ordersFile,
  type CheckoutResult,
} from './orders';
import { getState, loadOrdersFromStorage, snapshot, sweepExpired } from './state';

/** Latency band and failure rate the brief prescribes for /price. */
export const PRICE_LATENCY_MS = { min: 200, max: 1500 } as const;
export const PRICE_FAILURE_RATE = 0.15;

/** Tests turn the dice off so a flaky endpoint cannot make them flaky. */
let chaosEnabled = true;
export function setChaos(enabled: boolean): void {
  chaosEnabled = enabled;
}

function envelope<T>(data: T): { serverTime: string; data: T } {
  return { serverTime: serverNow().toISOString(), data };
}

interface PriceRequestBody {
  readonly cart: readonly { readonly selection: Selection; readonly qty: number }[];
  readonly couponCode?: string | null;
  /** Echoed back so the client can discard a stale answer (TC-12). */
  readonly requestId?: string;
}

export const handlers = [
  http.get('/api/menu', () => {
    sweepExpired();
    const state = getState();
    return HttpResponse.json(
      envelope({ menu: state.menu, stock: state.onHand }),
    );
  }),

  http.get('/api/stock', () => {
    sweepExpired();
    const state = getState();
    return HttpResponse.json(
      envelope({ available: availableMap(snapshot(), state.menu.ingredients) }),
    );
  }),

  http.post('/api/price', async ({ request }) => {
    sweepExpired();
    const body = (await request.json()) as PriceRequestBody;

    if (chaosEnabled) {
      const span = PRICE_LATENCY_MS.max - PRICE_LATENCY_MS.min;
      await delay(PRICE_LATENCY_MS.min + Math.random() * span);
      if (Math.random() < PRICE_FAILURE_RATE) {
        return HttpResponse.json(
          { error: 'price_unavailable', message: 'Pricing service hiccuped' },
          { status: 503 },
        );
      }
    }

    const breakdown: PriceBreakdown = priceCart({
      cart: body.cart,
      menu: getState().menu,
      couponCode: body.couponCode ?? null,
      serverTime: serverNow(),
    });

    return HttpResponse.json(
      envelope({ requestId: body.requestId ?? null, breakdown }),
    );
  }),

  /* ------------------------------------------------------------- Part D */

  http.get('/api/cart', () => {
    const state = getState();
    return HttpResponse.json(
      envelope({ items: cartView(), cartVersion: state.cartVersion }),
    );
  }),

  http.post('/api/cart', async ({ request }) => {
    const idempotencyKey = request.headers.get('Idempotency-Key');
    if (idempotencyKey === null) {
      return HttpResponse.json(
        { error: 'missing_idempotency_key', message: 'Idempotency-Key header is required' },
        { status: 400 },
      );
    }
    const body = (await request.json()) as { selection: Selection; qty: number };
    return cartResponse(
      reserveItem({ selection: body.selection, qty: body.qty, idempotencyKey }),
    );
  }),

  http.patch('/api/cart/:id', async ({ request, params }) => {
    const body = (await request.json()) as {
      selection: Selection;
      qty: number;
      expectedVersion?: number;
    };
    return cartResponse(
      editItem({
        itemId: String(params.id),
        selection: body.selection,
        qty: body.qty,
        ...(body.expectedVersion === undefined
          ? {}
          : { expectedVersion: body.expectedVersion }),
      }),
    );
  }),

  http.delete('/api/cart/:id', ({ params }) =>
    cartResponse(removeItem(String(params.id))),
  ),

  /* ------------------------------------------------------------- Part E */

  http.post('/api/checkout', async ({ request }) => {
    const idempotencyKey = request.headers.get('Idempotency-Key');
    if (idempotencyKey === null) {
      return HttpResponse.json(
        {
          error: 'missing_idempotency_key',
          message: 'Idempotency-Key header is required',
        },
        { status: 400 },
      );
    }
    await ensureOrdersLoaded();
    const body = (await request.json()) as {
      paymentMethod: PaymentMethod;
      couponCode?: string | null;
    };
    return checkoutResponse(
      checkout({
        paymentMethod: body.paymentMethod,
        couponCode: body.couponCode ?? null,
        idempotencyKey,
      }),
    );
  }),

  http.get('/api/orders', async () => {
    await ensureOrdersLoaded();
    return HttpResponse.json(envelope({ orders: listOrders() }));
  }),

  /** The exact bytes behind the "Download orders.json" button. */
  http.get('/api/orders/export', async () => {
    await ensureOrdersLoaded();
    return HttpResponse.json(envelope({ file: ordersFile() }));
  }),
];

/**
 * Lazily brings the order store up: a store persisted in localStorage wins,
 * otherwise the six seed orders are loaded and priced with our own engine
 * at each order's own `createdAt`. Runs at most once (TC-17).
 */
let seeding: Promise<void> | null = null;

export async function ensureOrdersLoaded(): Promise<void> {
  if (getState().seedLoaded) return;
  seeding ??= (async () => {
    loadOrdersFromStorage();
    if (getState().seedLoaded) return;
    const response = await fetch('/orders.seed.json');
    initOrders(await response.json());
  })();
  await seeding;
}

/** Tests reset the lazy loader along with the state. */
export function resetSeedLoader(): void {
  seeding = null;
}

function checkoutResponse(result: CheckoutResult) {
  if (result.ok) {
    return HttpResponse.json(envelope({ order: result.order, replayed: result.replayed }));
  }
  return HttpResponse.json(
    { error: result.code, message: result.message },
    { status: result.code === 'invalid_payment' ? 422 : 409 },
  );
}

/**
 * Maps a cart result onto HTTP. A shortage is a 409, because the request
 * was well formed and the server simply cannot serve it right now - which
 * is what lets the client keep the configuration and offer Retry (TC-14).
 */
function cartResponse(result: CartResult) {
  if (result.ok) {
    return HttpResponse.json(
      envelope({ item: result.item, cartVersion: result.cartVersion }),
    );
  }

  const status =
    result.code === 'not_found'
      ? 404
      : result.code === 'invalid'
        ? 422
        : 409; // shortage, expired, conflict

  return HttpResponse.json(
    {
      error: result.code,
      message: result.message,
      ...(result.code === 'shortage' ? { shortages: result.shortages } : {}),
      ...(result.code === 'invalid' ? { violations: result.violations } : {}),
    },
    { status },
  );
}

