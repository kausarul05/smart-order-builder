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

import {
  afterAll,
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from 'vitest';
import { http, HttpResponse } from 'msw';
import { setupServer } from 'msw/node';

import { ApiClient, ApiError, setApiBaseUrl, setApiRevive } from './client';

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
  setApiRevive(null);
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
    // Our handlers always put an `error` code in a failure body, so a 500
    // carrying none did not come from them. It is named as unexpected,
    // with its status, rather than dressed up as an API error.
    server.use(http.get('/api/menu', () => HttpResponse.text('boom', { status: 500 })));
    await expect(api.getMenu()).rejects.toThrow(/Unexpected response from \/api\/menu \(HTTP 500\)/);
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

/**
 * The bug this guards against only shows on a deployed build.
 *
 * MSW's service worker holds its active-client list in memory, and the
 * browser kills an idle service worker. On restart that list is empty, so
 * the next request is passed through to the network before the page has
 * finished saying "I am here" again. The dev server answers an unknown
 * path with index.html; a static host answers with a bare 404, which
 * surfaced as "Request failed with 404" and went away as soon as the user
 * pressed Retry - by which time the handshake had completed.
 */
describe('a request that slipped past the mock server', () => {
  const envelope = (data: unknown) =>
    HttpResponse.json({ serverTime: new Date().toISOString(), data });

  it('reads a bare 404 as the worker stepping aside, not as an API error', async () => {
    server.use(http.get('/api/menu', () => HttpResponse.text('Not Found', { status: 404 })));

    await expect(api.getMenu()).rejects.toMatchObject({ code: 'mock_server_missing' });
    await expect(api.getMenu()).rejects.not.toThrow(/Request failed with 404/);
  });

  it('revives the worker and succeeds without the user noticing', async () => {
    let calls = 0;
    let revived = 0;
    server.use(
      http.get('/api/stock', () => {
        calls += 1;
        return calls === 1
          ? HttpResponse.text('Not Found', { status: 404 })
          : envelope({ available: { egg: 10 } });
      }),
    );
    setApiRevive(async () => {
      revived += 1;
    });

    const result = await api.getStock();
    expect(result.available.egg).toBe(10);
    expect(revived).toBe(1);
    expect(calls).toBe(2);
  });

  it('retries once and no more, so a dead worker still reports itself', async () => {
    let calls = 0;
    server.use(
      http.get('/api/stock', () => {
        calls += 1;
        return HttpResponse.text('Not Found', { status: 404 });
      }),
    );
    setApiRevive(async () => undefined);

    await expect(api.getStock()).rejects.toMatchObject({ code: 'mock_server_missing' });
    expect(calls).toBe(2);
  });

  it('still retries when reviving itself throws', async () => {
    let calls = 0;
    server.use(
      http.get('/api/stock', () => {
        calls += 1;
        return calls === 1
          ? HttpResponse.text('Not Found', { status: 404 })
          : envelope({ available: { egg: 4 } });
      }),
    );
    setApiRevive(() => Promise.reject(new Error('registration failed')));

    const result = await api.getStock();
    expect(result.available.egg).toBe(4);
    expect(calls).toBe(2);
  });

  it('never retries a failure the mock server composed itself', async () => {
    // 15% of /price calls fail on purpose. That answer IS ours, so it is
    // reported once - retrying behind the caller would hide the chaos the
    // brief asks for and defeat the Retry button.
    let calls = 0;
    server.use(
      http.post('/api/price', () => {
        calls += 1;
        return HttpResponse.json(
          { error: 'price_unavailable', message: 'Pricing service hiccuped' },
          { status: 503 },
        );
      }),
    );
    setApiRevive(async () => undefined);

    await expect(api.price({ cart: [] })).rejects.toMatchObject({
      code: 'price_unavailable',
      status: 503,
    });
    expect(calls).toBe(1);
  });

  it('never retries a shortage, which is a real answer about real stock', async () => {
    let calls = 0;
    server.use(
      http.post('/api/cart', () => {
        calls += 1;
        return HttpResponse.json(
          { error: 'shortage', message: 'Short: 2 egg', shortages: [] },
          { status: 409 },
        );
      }),
    );
    setApiRevive(async () => undefined);

    await expect(
      api.addToCart({ selection: { toast: 1 }, qty: 1 }, 'intent-1'),
    ).rejects.toMatchObject({ code: 'shortage' });
    expect(calls).toBe(1);
  });
});

/**
 * Recovering after the fact works, but the user still waited for a request
 * that was never going to arrive. The handshake is one `postMessage`, so
 * after a quiet spell - a tab left in the background, where timers are
 * throttled to about a tick a minute and the worker is terminated between
 * pings - it is re-sent before the request rather than after it fails.
 */
describe('the handshake sent before a request, after a quiet spell', () => {
  const envelope = (data: unknown) =>
    HttpResponse.json({ serverTime: new Date().toISOString(), data });

  /** Moves the app's idea of "now" on without touching the mock server. */
  const quietFor = (ms: number) => {
    const real = Date.now();
    vi.spyOn(Date, 'now').mockReturnValue(real + ms);
  };

  afterEach(() => vi.restoreAllMocks());

  it('re-sends it when nothing has been heard for long enough', async () => {
    let revived = 0;
    let calls = 0;
    server.use(
      http.get('/api/stock', () => {
        calls += 1;
        return envelope({ available: { egg: 10 } });
      }),
    );
    setApiRevive(async () => {
      revived += 1;
    });

    quietFor(11_000);
    await api.getStock();

    // Sent up front, and the request itself needed no second attempt.
    expect(revived).toBe(1);
    expect(calls).toBe(1);
  });

  it('does not re-send it on a request that follows a recent one', async () => {
    let revived = 0;
    server.use(http.get('/api/stock', () => envelope({ available: { egg: 10 } })));
    setApiRevive(async () => {
      revived += 1;
    });

    await api.getStock();
    await api.getStock();

    expect(revived).toBe(0);
  });

  it('sends one handshake for a burst of requests, not one each', async () => {
    // The cart refresh fires stock, cart and orders together.
    let revived = 0;
    server.use(
      http.get('/api/stock', () => envelope({ available: {} })),
      http.get('/api/cart', () => envelope({ items: [], cartVersion: 0 })),
      http.get('/api/orders', () => envelope({ orders: [] })),
    );
    setApiRevive(async () => {
      revived += 1;
    });

    quietFor(60_000);
    await Promise.all([api.getStock(), api.getCart(), api.getOrders()]);

    expect(revived).toBe(1);
  });

  it('is never sent in a test that registered no way to revive', async () => {
    // Node has no service worker, so nothing may happen behind a test.
    server.use(http.get('/api/stock', () => envelope({ available: { egg: 1 } })));
    setApiRevive(null);

    quietFor(600_000);
    await expect(api.getStock()).resolves.toMatchObject({ available: { egg: 1 } });
  });

  it('still makes the request when the handshake itself throws', async () => {
    server.use(http.get('/api/stock', () => envelope({ available: { egg: 2 } })));
    setApiRevive(() => Promise.reject(new Error('no registration')));

    quietFor(11_000);
    await expect(api.getStock()).resolves.toMatchObject({ available: { egg: 2 } });
  });
});
