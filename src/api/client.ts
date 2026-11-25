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

  private async request<T>(
    path: string,
    init: RequestInit = {},
  ): Promise<T> {
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
      throw new ApiError(0, 'network', 'Could not reach the server');
    }

    const payload: unknown = await response.json().catch(() => null);

    if (!response.ok) {
      const error =
        payload !== null && typeof payload === 'object'
          ? (payload as { error?: string; message?: string })
          : {};
      throw new ApiError(
        response.status,
        error.error ?? 'unknown',
        error.message ?? `Request failed with ${response.status}`,
        payload,
      );
    }

    const envelope = payload as Envelope<T>;
    const serverTime = Date.parse(envelope.serverTime);
    if (!Number.isNaN(serverTime)) {
      this.offsetMs = serverTime - Date.now();
      this.offsetKnown = true;
    }
    return envelope.data;
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
    body: { paymentMethod: PaymentMethod; couponCode?: string | null },
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

export const api = new ApiClient();

/** A fresh idempotency key per user intent, not per click (TC-13, TC-16). */
export function newIdempotencyKey(): string {
  return crypto.randomUUID();
}
