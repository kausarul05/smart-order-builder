/** MSW in the browser. Started from `src/main.tsx` before React renders. */

import { setupWorker } from 'msw/browser';
import { setApiRevive } from '@/api/client';
import { activateMockServer } from './activate';
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
 * Puts the mock server back in charge of this page.
 *
 * Two tiers, because there are two ways to lose it and only one of them is
 * common. See `activate.ts` for why the usual one happens and why
 * `worker.start()` cannot fix it.
 *
 * Concurrent callers share one attempt, and an attempt that hangs is
 * abandoned after four seconds so a stuck registration cannot stall the
 * request waiting on it. It never rejects: a failure here must not become
 * an unhandled rejection on an event listener, and the request waiting on
 * it gets its second attempt either way.
 */
let reviving: Promise<void> | null = null;

async function revive(): Promise<void> {
  reviving ??= (async () => {
    try {
      await Promise.race([
        repair(),
        new Promise<void>((resolve) => setTimeout(resolve, 4000)),
      ]);
    } finally {
      reviving = null;
    }
  })();
  await reviving;
}

async function repair(): Promise<void> {
  // Tier 1, and nearly always the answer: the worker is still registered
  // and still controls this page, it has simply forgotten the page after
  // being terminated. One message puts it back.
  if (await activateMockServer()) return;

  /*
    Nothing acknowledged, so there may be no registration left to talk to -
    devtools "Unregister", the worker unregistering itself as the last tab
    closed, or a page the worker never took control of. Only a fresh
    registration helps, and `worker.start()` on its own is a no-op while
    MSW believes mocking is enabled, so mocking has to be stopped first.
  */
  try {
    worker.stop();
  } catch {
    // Already stopped; the start below is the part that matters.
  }
  await worker.start(WORKER_OPTIONS).then(
    () => undefined,
    () => undefined,
  );
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

  /*
    ...and a worker that takes control after this page loaded - a rebuild,
    or the re-registration above - has never been told about this page.
  */
  if ('serviceWorker' in navigator) {
    navigator.serviceWorker.addEventListener('controllerchange', () => void revive());
  }
}
