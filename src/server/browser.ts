/** MSW in the browser. Started from `src/main.tsx` before React renders. */

import { setupWorker } from 'msw/browser';
import { setApiRevive } from '@/api/client';
import { handlers } from './handlers';
import { SERVER_STORAGE_KEY, restoreState } from './state';

/** Fired when another tab changed the shared server state (Part G). */
export const SERVER_CHANGED = 'sob:server-changed';

export const worker = setupWorker(...handlers);

const WORKER_OPTIONS = {
  // Vite's own assets and /orders.seed.json must pass through, but an
  // /api/ request that reaches the network means a handler is missing -
  // which is worth a console warning rather than a silent index.html.
  onUnhandledRequest(request: Request, print: { warning(): void }) {
    if (new URL(request.url).pathname.startsWith('/api/')) print.warning();
  },
  serviceWorker: {
    url: '/mockServiceWorker.js',
    // Claim this tab immediately, so a tab left open across a rebuild
    // picks the new worker up instead of serving index.html for /api.
    options: { scope: '/' },
  },
  quiet: true,
} as const;

/**
 * Re-runs MSW's activation handshake.
 *
 * The service worker keeps its list of active clients in memory, and the
 * browser terminates an idle service worker after about half a minute. On
 * restart that list is empty, and until this page says "I am here" again
 * the worker passes requests through to the network: index.html on the dev
 * server, a bare 404 on a static host. `worker.start()` is how that
 * handshake is sent, so calling it again is the repair.
 *
 * Concurrent callers share one attempt - a cart refresh fires three
 * requests at once, and they must not each re-register the worker. A
 * revive that hangs is abandoned after three seconds so a stuck
 * registration cannot stall the request waiting on it.
 */
let reviving: Promise<void> | null = null;

async function revive(): Promise<void> {
  reviving ??= (async () => {
    // Never rejects: a failed re-registration must not become an unhandled
    // rejection on the visibility listener, and the request waiting on
    // this gets its second attempt either way.
    const started = worker.start(WORKER_OPTIONS).then(
      () => undefined,
      () => undefined,
    );
    try {
      await Promise.race([
        started,
        new Promise<void>((resolve) => setTimeout(resolve, 3000)),
      ]);
    } finally {
      reviving = null;
    }
  })();
  await reviving;
}

export async function startMockServer(): Promise<void> {
  await worker.start(WORKER_OPTIONS);

  // The client calls this when a response did not come from us, instead of
  // showing the user a 404 it can do nothing about.
  setApiRevive(revive);

  // Part G: the server's own state survives a refresh, minus any
  // reservation whose five minutes ran out while the tab was away.
  restoreState();

  // ...and because that state lives in localStorage, a second tab writing
  // to it is a real event here. The app refetches rather than carrying on
  // with a view that is already stale.
  window.addEventListener('storage', (event) => {
    if (event.key !== SERVER_STORAGE_KEY) return;
    restoreState();
    window.dispatchEvent(new CustomEvent(SERVER_CHANGED));
  });

  /*
    A tab that sat in the background is the likeliest place for the worker
    to have been terminated, and the next thing that happens there is a
    click. Re-handshaking the moment the tab is looked at again means the
    worker is ready before that click, rather than one request later.
  */
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') void revive();
  });
}
