/**
 * The only way the app talks to the mock server.
 *
 * It keeps one job for itself: every response carries `serverTime`, and the
 * client turns that into an offset against the browser clock. `serverNow()`
 * is then the single clock the whole UI reads, which is what makes the
 * 90-second skew in `src/server/clock.ts` harmless (TC-15).
 */

import type {
  CartItem,
  IngredientId,
  Menu,
  OrdersFile,
  PaymentMethod,
  PriceBreakdown,
  Selection,
  Shortage,
  StoredOrder,
  Violation,
} from '@/domain/types';

/**
 * Requests use relative paths in the browser. Node's fetch cannot resolve a
 * relative URL, so the component tests point this at the jsdom origin.
 */
let baseUrl = '';

export function setApiBaseUrl(url: string): void {
  baseUrl = url.replace(/\/$/, '');
}

/**
 * How to bring the mock server back when a request slipped past it. The
 * browser entry point registers MSW's activation handshake here; Node
 * tests leave it unset, so nothing is ever retried behind a test's back.
 */
let revive: (() => Promise<void>) | null = null;

export function setApiRevive(fn: (() => Promise<void>) | null): void {
  revive = fn;
}

export class ApiError extends Error {
  readonly status: number;
  readonly code: string;
  /**
   * The whole error body, so a caller can read the extras the server sent -
   * `shortages` for a 409 and `violations` for a 422.
   */
  readonly body: unknown;

  constructor(status: number, code: string, message: string, body?: unknown) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
    this.code = code;
    this.body = body;
  }

  /** The exact per-ingredient shortages behind "Short: 2 egg, 2 cheese". */
  get shortages(): readonly Shortage[] {
    if (typeof this.body !== 'object' || this.body === null) return [];
    const { shortages } = this.body as { shortages?: unknown };
    return Array.isArray(shortages) ? (shortages as Shortage[]) : [];
  }

  get violations(): readonly Violation[] {
    if (typeof this.body !== 'object' || this.body === null) return [];
    const { violations } = this.body as { violations?: unknown };
    return Array.isArray(violations) ? (violations as Violation[]) : [];
  }
}

interface Envelope<T> {
  readonly serverTime: string;
  readonly data: T;
}

export interface PriceRequest {
  readonly cart: readonly { readonly selection: Selection; readonly qty: number }[];
  readonly couponCode?: string | null;
  readonly requestId?: string;
}

export interface PriceResponse {
  readonly requestId: string | null;
  readonly breakdown: PriceBreakdown;
}

export class ApiClient {
  private offsetMs = 0;
  private offsetKnown = false;

  /** Server time, derived from the last response. Never `Date.now()`. */
  serverNow(): Date {
    return new Date(Date.now() + this.offsetMs);
  }

  get hasServerTime(): boolean {
    return this.offsetKnown;
  }

  /**
   * One request, with a single automatic recovery.
   *
   * MSW's service worker keeps the list of active clients in memory, and a
   * service worker is terminated once the tab has been idle for a while.
   * When it restarts, that list is empty until the page completes the
   * activation handshake again, and any request made in that window is
   * passed through to the network. On the dev server that returns
   * index.html; on a static host it returns 404, which is where
   * "Request failed with 404" came from - and why pressing Retry fixed it,
   * because by then the handshake had finished.
   *
   * So a response that did not come from our mock server at all is not
   * reported as an API error. The worker is revived and the request is
   * made once more, which is what that Retry click was doing by hand.
   * Retrying is safe precisely because the first attempt never reached the
   * server: nothing was reserved, charged or stored. The writes carry an
   * `Idempotency-Key` on top of that.
   */
  private async request<T>(path: string, init: RequestInit = {}): Promise<T> {
    const first = await this.attempt<T>(path, init);
    if (first.ok) return first.data;

    if (first.bypassed && revive !== null) {
      try {
        await revive();
      } catch {
        // Reviving failed; the second attempt still gets its chance, and
        // if that fails too the caller gets the clear message below.
      }
      const second = await this.attempt<T>(path, init);
      if (second.ok) return second.data;
      throw second.error;
    }

    throw first.error;
  }

  private async attempt<T>(
    path: string,
    init: RequestInit,
  ): Promise<
    | { readonly ok: true; readonly data: T }
    | { readonly ok: false; readonly bypassed: boolean; readonly error: ApiError }
  > {
    let response: Response;
    try {
      response = await fetch(`${baseUrl}${path}`, {
        ...init,
        headers: {
          'Content-Type': 'application/json',
          ...(init.headers ?? {}),
        },
      });
    } catch (cause) {
      if (cause instanceof DOMException && cause.name === 'AbortError') throw cause;
      // A genuine network failure, not a worker that stepped aside.
      return {
        ok: false,
        bypassed: false,
        error: new ApiError(0, 'network', 'Could not reach the server'),
      };
    }

    const raw = await response.text().catch(() => '');
    let payload: unknown = null;
    try {
      payload = raw === '' ? null : JSON.parse(raw);
    } catch {
      payload = null;
    }

    /*
      Every failure our handlers return carries an `error` code in its body.
      A failure without one did not come from them - it is whatever the
      dev server or the static host answers for an unhandled path, which is
      index.html with a 200 locally and a bare 404 in production.
    */
    if (!response.ok) {
      if (isApiFailure(payload)) {
        return {
          ok: false,
          bypassed: false,
          error: new ApiError(
            response.status,
            payload.error,
            payload.message ?? `Request failed with ${response.status}`,
            payload,
          ),
        };
      }
      /*
        No error code, so nothing of ours composed this. A 404, an HTML
        body or an empty body is the signature of a request that reached
        the network instead of the worker; anything else is reported with
        its status rather than retried behind the caller's back.
      */
      const looksBypassed =
        response.status === 404 || looksLikeHtml(raw) || raw.trim() === '';
      return {
        ok: false,
        bypassed: looksBypassed,
        error: missing(path, raw, response.status),
      };
    }

    // A 200 that is not one of our envelopes is the same story with a
    // friendlier status code: the dev server serving index.html.
    if (!isEnvelope<T>(payload)) {
      return { ok: false, bypassed: true, error: missing(path, raw, response.status) };
    }

    const serverTime = Date.parse(payload.serverTime);
    if (!Number.isNaN(serverTime)) {
      this.offsetMs = serverTime - Date.now();
      this.offsetKnown = true;
    }
    return { ok: true, data: payload.data };
  }

  getMenu(): Promise<{ menu: Menu; stock: Readonly<Record<IngredientId, number>> }> {
    return this.request('/api/menu');
  }

  getStock(): Promise<{ available: Readonly<Record<IngredientId, number>> }> {
    return this.request('/api/stock');
  }

  /**
   * One `/price` call. Staleness is handled a level up by `LatestOnly`, and
   * `signal` lets a superseded request be aborted outright.
   */
  price(body: PriceRequest, signal?: AbortSignal): Promise<PriceResponse> {
    return this.request('/api/price', {
      method: 'POST',
      body: JSON.stringify(body),
      ...(signal === undefined ? {} : { signal }),
    });
  }

  /* ---------------------------------------------------------- Part D */

  getCart(): Promise<{ items: readonly CartItemView[]; cartVersion: number }> {
    return this.request('/api/cart');
  }

  /**
   * `idempotencyKey` belongs to the user's INTENT, not to the click: the
   * caller creates it once and reuses it until the add succeeds, which is
   * what makes three fast clicks one item (TC-13).
   */
  addToCart(
    body: { selection: Selection; qty: number },
    idempotencyKey: string,
  ): Promise<{ item: CartItem; cartVersion: number }> {
    return this.request('/api/cart', {
      method: 'POST',
      body: JSON.stringify(body),
      headers: { 'Idempotency-Key': idempotencyKey },
    });
  }

  editCartItem(
    id: string,
    body: { selection: Selection; qty: number; expectedVersion?: number },
  ): Promise<{ item: CartItem; cartVersion: number }> {
    return this.request(`/api/cart/${id}`, {
      method: 'PATCH',
      body: JSON.stringify(body),
    });
  }

  removeCartItem(id: string): Promise<{ item: CartItem; cartVersion: number }> {
    return this.request(`/api/cart/${id}`, { method: 'DELETE' });
  }

  /* ---------------------------------------------------------- Part E */

  checkout(
    body: {
      paymentMethod: PaymentMethod;
      couponCode?: string | null;
      expectedCartVersion?: number;
    },
    idempotencyKey: string,
  ): Promise<{ order: StoredOrder; replayed: boolean }> {
    return this.request('/api/checkout', {
      method: 'POST',
      body: JSON.stringify(body),
      headers: { 'Idempotency-Key': idempotencyKey },
    });
  }

  getOrders(): Promise<{ orders: readonly StoredOrder[] }> {
    return this.request('/api/orders');
  }

  exportOrders(): Promise<{ file: OrdersFile }> {
    return this.request('/api/orders/export');
  }
}

/** Shape `GET /api/cart` returns for each item. */
export interface CartItemView extends CartItem {
  readonly expiresInMs: number;
  readonly editable: boolean;
}

/** The shape every failure OUR handlers return. Anything else is not ours. */
function isApiFailure(
  payload: unknown,
): payload is { readonly error: string; readonly message?: string } {
  return (
    typeof payload === 'object' &&
    payload !== null &&
    'error' in payload &&
    typeof (payload as { error: unknown }).error === 'string'
  );
}

/** The one message for "that answer did not come from the mock server". */
function missing(path: string, raw: string, status: number): ApiError {
  return new ApiError(
    status,
    'mock_server_missing',
    looksLikeHtml(raw) || status === 404
      ? `The mock server did not answer ${path}. Reload the page to reinstall it.`
      : `Unexpected response from ${path} (HTTP ${status}).`,
    null,
  );
}

function isEnvelope<T>(payload: unknown): payload is Envelope<T> {
  return (
    typeof payload === 'object' &&
    payload !== null &&
    'serverTime' in payload &&
    'data' in payload
  );
}

function looksLikeHtml(raw: string): boolean {
  return /^\s*<(!doctype|html)/i.test(raw);
}

export const api = new ApiClient();

/** A fresh idempotency key per user intent, not per click (TC-13, TC-16). */
export function newIdempotencyKey(): string {
  return crypto.randomUUID();
}
