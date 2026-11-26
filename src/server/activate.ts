/**
 * MSW's activation handshake, re-sent by hand.
 *
 * `public/mockServiceWorker.js` keeps the ids of the pages it is mocking for
 * in a plain `Set`, in the worker's own memory:
 *
 *     const activeClientIds = new Set()
 *     ...
 *     if (activeClientIds.size === 0) return    // let it hit the network
 *
 * The browser terminates an idle service worker, and on restart that Set is
 * empty. Three things then conspire to make the damage permanent:
 *
 *   - MSW adds to the Set exactly once, during `worker.start()`, by posting
 *     `MOCK_ACTIVATE`.
 *   - Its keep-alive ping every five seconds wakes the worker but never
 *     re-adds the page, and a backgrounded tab's timers are throttled to
 *     about one tick a minute, which is long enough for the worker to be
 *     terminated between pings.
 *   - Calling `worker.start()` again does nothing at all: MSW logs "Found a
 *     redundant worker.start() call" and returns, because as far as it is
 *     concerned mocking is still enabled.
 *
 * So once that Set is lost, every `/api/` request is passed through to the
 * network until the page is reloaded - index.html from the dev server, a
 * bare 404 from a static host. Reloading was the only cure.
 *
 * Posting `MOCK_ACTIVATE` ourselves is the whole repair: the worker puts
 * this page back in the Set and replies `MOCKING_ENABLED`. MSW's own
 * listener for that reply is a `once` consumed at startup, so a later one
 * is ignored rather than confusing it.
 */

/** How long to wait for `MOCKING_ENABLED` before giving up on the worker. */
const ACK_TIMEOUT_MS = 2000;

/**
 * Concurrent callers share one handshake. A cart refresh fires three
 * requests at once and they must not each post their own message.
 */
let pending: Promise<boolean> | null = null;

/**
 * Tells the service worker to start mocking for this page again.
 *
 * Resolves `true` when the worker acknowledged, `false` when there was
 * nothing to talk to - no service worker support, a page the worker does
 * not control, no registration left, or no reply in time. It never
 * rejects, so it is safe to call from an event listener.
 */
export function activateMockServer(): Promise<boolean> {
  pending ??= handshake()
    .catch(() => false)
    .finally(() => {
      pending = null;
    });
  return pending;
}

async function handshake(): Promise<boolean> {
  const container = 'serviceWorker' in navigator ? navigator.serviceWorker : undefined;
  if (container === undefined) return false;

  /*
    An uncontrolled page is a different failure: the worker never sees this
    page's requests at all, so no message can repair it. Say so by
    returning false - the caller re-registers instead.
  */
  if (container.controller === null) return false;

  const registration = await container.getRegistration('/').catch(() => undefined);
  const target = registration?.active ?? container.controller;
  if (target === null || target === undefined) return false;

  const acknowledged = waitForAck(container);
  target.postMessage('MOCK_ACTIVATE');
  return acknowledged;
}

/** Resolves true on `MOCKING_ENABLED`, false once the wait runs out. */
function waitForAck(container: ServiceWorkerContainer): Promise<boolean> {
  return new Promise<boolean>((resolve) => {
    const onMessage = (event: Event): void => {
      const { data } = event as MessageEvent<unknown>;
      if (typeof data !== 'object' || data === null) return;
      if ((data as { type?: unknown }).type === 'MOCKING_ENABLED') settle(true);
    };

    container.addEventListener('message', onMessage);
    const timer = setTimeout(() => settle(false), ACK_TIMEOUT_MS);

    // Hoisted, so the two callbacks above can both reach it, and leaving
    // neither the listener nor the timer behind: a long session would
    // otherwise collect one of each per quiet spell.
    function settle(acknowledged: boolean): void {
      clearTimeout(timer);
      container.removeEventListener('message', onMessage);
      resolve(acknowledged);
    }
  });
}
