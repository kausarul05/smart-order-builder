/**
 * The only way the app talks to the mock server.
 *
 * It keeps one job for itself: every response carries `serverTime`, and the
 * client turns that into an offset against the browser clock. `serverNow()`
 * is then the single clock the whole UI reads, which is what makes the
 * 90-second skew in `src/server/clock.ts` harmless (TC-15).
 */

import type {
  IngredientId,
  Menu,
  PriceBreakdown,
  Selection,
  StoredOrder,
} from '@/domain/types';

export class ApiError extends Error {
  readonly status: number;
  readonly code: string;

  constructor(status: number, code: string, message: string) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
    this.code = code;
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
      response = await fetch(path, {
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

  getOrders(): Promise<{ orders: readonly StoredOrder[] }> {
    return this.request('/api/orders');
  }

  // TODO(Part D): addToCart / editCartItem / removeCartItem, each sending
  // an Idempotency-Key header so TC-13 holds.
  // TODO(Part E): checkout(paymentMethod, couponCode, idempotencyKey).
}

export const api = new ApiClient();

/** A fresh idempotency key per user intent, not per click (TC-13, TC-16). */
export function newIdempotencyKey(): string {
  return crypto.randomUUID();
}
