/** MSW in the browser. Started from `src/main.tsx` before React renders. */

import { setupWorker } from 'msw/browser';
import { handlers } from './handlers';
import { SERVER_STORAGE_KEY, restoreState } from './state';

/** Fired when another tab changed the shared server state (Part G). */
export const SERVER_CHANGED = 'sob:server-changed';

export const worker = setupWorker(...handlers);

export async function startMockServer(): Promise<void> {
  await worker.start({
    // Vite's own assets and /orders.seed.json must pass through, but an
    // /api/ request that reaches the network means a handler is missing -
    // which is worth a console warning rather than a silent index.html.
    onUnhandledRequest(request, print) {
      if (new URL(request.url).pathname.startsWith('/api/')) print.warning();
    },
    serviceWorker: {
      url: '/mockServiceWorker.js',
      // Claim this tab immediately, so a tab left open across a rebuild
      // picks the new worker up instead of serving index.html for /api.
      options: { scope: '/' },
    },
    quiet: true,
  });

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
}
