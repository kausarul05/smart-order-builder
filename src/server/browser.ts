/** MSW in the browser. Started from `src/main.tsx` before React renders. */

import { setupWorker } from 'msw/browser';
import { handlers } from './handlers';

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
}
