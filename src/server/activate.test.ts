/**
 * The handshake that keeps the deployed build alive.
 *
 * jsdom has no Service Worker API, so these stand a fake
 * `navigator.serviceWorker` up and assert on the one message that matters:
 * `MOCK_ACTIVATE` reaching the worker, and the reply being waited for
 * rather than assumed.
 */

import { afterEach, describe, expect, it, vi } from 'vitest';

import { activateMockServer } from './activate';

interface Fake {
  readonly container: ServiceWorkerContainer;
  readonly posted: string[];
  /** Replies the way `public/mockServiceWorker.js` does, on the container. */
  emit(data: unknown): void;
}

/**
 * @param reply what the worker answers a `MOCK_ACTIVATE` with, if anything
 */
function fakeServiceWorker(options: {
  controlled?: boolean;
  registered?: boolean;
  reply?: 'ack' | 'other' | 'silence';
}): Fake {
  const listeners = new Set<(event: Event) => void>();
  const posted: string[] = [];

  const emit = (data: unknown): void => {
    for (const listener of [...listeners]) listener({ data } as MessageEvent);
  };

  const active = {
    postMessage(message: string) {
      posted.push(message);
      if (options.reply === 'ack') emit({ type: 'MOCKING_ENABLED', payload: {} });
      if (options.reply === 'other') emit({ type: 'KEEPALIVE_RESPONSE' });
    },
  };

  const container = {
    controller: options.controlled === false ? null : active,
    addEventListener(type: string, listener: (event: Event) => void) {
      if (type === 'message') listeners.add(listener);
    },
    removeEventListener(_type: string, listener: (event: Event) => void) {
      listeners.delete(listener);
    },
    getRegistration: () =>
      Promise.resolve(options.registered === false ? undefined : { active }),
  };

  Object.defineProperty(navigator, 'serviceWorker', {
    value: container,
    configurable: true,
  });

  return { container: container as unknown as ServiceWorkerContainer, posted, emit };
}

afterEach(() => {
  vi.useRealTimers();
  Reflect.deleteProperty(navigator, 'serviceWorker');
});

describe('activateMockServer', () => {
  it('posts MOCK_ACTIVATE and resolves once the worker acknowledges', async () => {
    const fake = fakeServiceWorker({ reply: 'ack' });

    await expect(activateMockServer()).resolves.toBe(true);
    // This exact string is the protocol in public/mockServiceWorker.js.
    expect(fake.posted).toEqual(['MOCK_ACTIVATE']);
  });

  it('leaves no message listener behind', async () => {
    const fake = fakeServiceWorker({ reply: 'ack' });
    await activateMockServer();

    // Nothing should still be listening, or a long session would collect a
    // listener per quiet spell.
    expect(() => fake.emit({ type: 'MOCKING_ENABLED' })).not.toThrow();
    await expect(activateMockServer()).resolves.toBe(true);
    expect(fake.posted).toEqual(['MOCK_ACTIVATE', 'MOCK_ACTIVATE']);
  });

  it('shares one handshake between concurrent callers', async () => {
    // A cart refresh fires three requests at once; one message is enough.
    const fake = fakeServiceWorker({ reply: 'ack' });

    const results = await Promise.all([
      activateMockServer(),
      activateMockServer(),
      activateMockServer(),
    ]);

    expect(results).toEqual([true, true, true]);
    expect(fake.posted).toEqual(['MOCK_ACTIVATE']);
  });

  it('gives up rather than hanging when nothing answers', async () => {
    vi.useFakeTimers();
    const fake = fakeServiceWorker({ reply: 'silence' });

    const settled = activateMockServer();
    await vi.advanceTimersByTimeAsync(2000);

    await expect(settled).resolves.toBe(false);
    expect(fake.posted).toEqual(['MOCK_ACTIVATE']);
  });

  it('ignores a reply that is not the acknowledgement', async () => {
    vi.useFakeTimers();
    fakeServiceWorker({ reply: 'other' });

    const settled = activateMockServer();
    await vi.advanceTimersByTimeAsync(2000);

    await expect(settled).resolves.toBe(false);
  });

  it('reports failure when the page is not controlled, since no message can help', async () => {
    // The worker never sees an uncontrolled page's requests at all, so the
    // caller has to re-register rather than keep asking.
    const fake = fakeServiceWorker({ controlled: false });

    await expect(activateMockServer()).resolves.toBe(false);
    expect(fake.posted).toEqual([]);
  });

  it('falls back to the controller when the registration has gone', async () => {
    const fake = fakeServiceWorker({ registered: false, reply: 'ack' });

    await expect(activateMockServer()).resolves.toBe(true);
    expect(fake.posted).toEqual(['MOCK_ACTIVATE']);
  });

  it('reports failure where there is no Service Worker API at all', async () => {
    Reflect.deleteProperty(navigator, 'serviceWorker');
    await expect(activateMockServer()).resolves.toBe(false);
  });
});
