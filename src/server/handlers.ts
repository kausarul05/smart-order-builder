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
import type { PriceBreakdown, Selection } from '@/domain/types';
import { serverNow } from './clock';
import { getState, snapshot, sweepExpired } from './state';

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

  /* ----------------------------------------------- Part D, not built yet */

  http.get('/api/cart', () => notImplemented('GET /api/cart', 'D')),
  http.post('/api/cart', () => notImplemented('POST /api/cart', 'D')),
  http.patch('/api/cart/:id', () => notImplemented('PATCH /api/cart/:id', 'D')),
  http.delete('/api/cart/:id', () => notImplemented('DELETE /api/cart/:id', 'D')),

  /* ----------------------------------------------- Part E, not built yet */

  http.post('/api/checkout', () => notImplemented('POST /api/checkout', 'E')),
  http.get('/api/orders', () => notImplemented('GET /api/orders', 'E')),
];

function notImplemented(route: string, part: string) {
  return HttpResponse.json(
    {
      error: 'not_implemented',
      message: `${route} is Part ${part} and is not built yet`,
    },
    { status: 501 },
  );
}
