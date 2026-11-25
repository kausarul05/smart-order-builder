/**
 * The envelope contract.
 *
 * A 200 whose body is not one of our envelopes used to crash with
 * "Cannot read properties of null (reading 'serverTime')". That happens in
 * the browser when the MSW service worker is missing or stale: the request
 * falls through to the dev server, which answers any unknown path with
 * index.html. The client now names that, which is the difference between a
 * dead screen and a reload button.
 */

import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { http, HttpResponse } from 'msw';
import { setupServer } from 'msw/node';

import { ApiClient, ApiError, setApiBaseUrl } from './client';

const server = setupServer();
const ORIGIN = 'http://localhost:5173';

let api: ApiClient;

beforeAll(() => {
  setApiBaseUrl(ORIGIN);
  server.listen({ onUnhandledRequest: 'bypass' });
});

afterAll(() => {
  server.close();
  setApiBaseUrl('');
});

beforeEach(() => {
  api = new ApiClient();
});

afterEach(() => server.resetHandlers());

const INDEX_HTML = '<!doctype html>\n<html><body><div id="root"></div></body></html>';

describe('a well-formed envelope', () => {
  it('returns the data and learns the server-time offset', async () => {
    const serverTime = new Date(Date.now() + 90_000).toISOString();
    server.use(
      http.get('/api/stock', () =>
        HttpResponse.json({ serverTime, data: { available: { egg: 10 } } }),
      ),
    );

    expect(api.hasServerTime).toBe(false);
    const result = await api.getStock();
    expect(result.available.egg).toBe(10);

    expect(api.hasServerTime).toBe(true);
    // The server runs 90 s ahead, so serverNow() should too, give or take
    // the time the request itself took.
    const skew = api.serverNow().getTime() - Date.now();
    expect(skew).toBeGreaterThan(80_000);
    expect(skew).toBeLessThan(100_000);
  });
});

describe('a 200 that is not an envelope', () => {
  it('names the missing mock server instead of throwing on null', async () => {
    server.use(
      http.get('/api/menu', () =>
        HttpResponse.text(INDEX_HTML, { headers: { 'Content-Type': 'text/html' } }),
      ),
    );

    await expect(api.getMenu()).rejects.toThrow(ApiError);
    await expect(api.getMenu()).rejects.toThrow(
      /The mock server did not answer \/api\/menu\. Reload the page/,
    );
    await expect(api.getMenu()).rejects.not.toThrow(/serverTime/);
  });

  it('carries a code the shell can act on', async () => {
    server.use(http.get('/api/menu', () => HttpResponse.text(INDEX_HTML)));
    await expect(api.getMenu()).rejects.toMatchObject({
      code: 'mock_server_missing',
    });
  });

  it('handles an empty body', async () => {
    server.use(http.get('/api/cart', () => new HttpResponse(null, { status: 200 })));
    await expect(api.getCart()).rejects.toThrow(/Unexpected response from \/api\/cart/);
  });

  it('handles JSON that is not an envelope', async () => {
    server.use(http.get('/api/orders', () => HttpResponse.json({ orders: [] })));
    await expect(api.getOrders()).rejects.toThrow(/Unexpected response/);
  });

  it('handles a JSON null body', async () => {
    server.use(http.get('/api/orders', () => HttpResponse.json(null)));
    await expect(api.getOrders()).rejects.toThrow(ApiError);
  });
});

describe('error responses', () => {
  it('keeps the shortage list from a 409', async () => {
    server.use(
      http.post('/api/cart', () =>
        HttpResponse.json(
          {
            error: 'shortage',
            message: 'Short: 2 egg, 2 cheese',
            shortages: [
              { ingredientId: 'egg', name: 'egg', missing: 2 },
              { ingredientId: 'cheese', name: 'cheese', missing: 2 },
            ],
          },
          { status: 409 },
        ),
      ),
    );

    try {
      await api.addToCart({ selection: { toast: 1 }, qty: 1 }, 'key');
      expect.unreachable('should have thrown');
    } catch (cause) {
      expect(cause).toBeInstanceOf(ApiError);
      const error = cause as ApiError;
      expect(error.status).toBe(409);
      expect(error.code).toBe('shortage');
      expect(error.shortages).toHaveLength(2);
      expect(error.shortages[0]?.name).toBe('egg');
    }
  });

  it('keeps the violations from a 422', async () => {
    server.use(
      http.post('/api/cart', () =>
        HttpResponse.json(
          {
            error: 'invalid',
            message: 'Eggs total must be 2-6 in steps of 2 (you have 3)',
            violations: [{ scope: { kind: 'group', groupId: 'eggs' }, code: 'step' }],
          },
          { status: 422 },
        ),
      ),
    );

    try {
      await api.addToCart({ selection: { scrambled: 3 }, qty: 1 }, 'key');
      expect.unreachable('should have thrown');
    } catch (cause) {
      expect((cause as ApiError).violations).toHaveLength(1);
    }
  });

  it('reports a non-JSON error body without crashing', async () => {
    server.use(http.get('/api/menu', () => HttpResponse.text('boom', { status: 500 })));
    await expect(api.getMenu()).rejects.toThrow(/Request failed with 500/);
  });

  it('reports an unreachable server', async () => {
    server.use(http.get('/api/menu', () => HttpResponse.error()));
    await expect(api.getMenu()).rejects.toThrow(/Could not reach the server/);
  });

  it('sends the Idempotency-Key header on a cart add', async () => {
    let seen: string | null = null;
    server.use(
      http.post('/api/cart', ({ request }) => {
        seen = request.headers.get('Idempotency-Key');
        return HttpResponse.json({
          serverTime: new Date().toISOString(),
          data: { item: {}, cartVersion: 1 },
        });
      }),
    );

    await api.addToCart({ selection: { toast: 1 }, qty: 1 }, 'intent-123');
    expect(seen).toBe('intent-123');
  });
});
