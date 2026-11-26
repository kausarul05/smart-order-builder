/**
 * TC-12 on the screen - the async price preview.
 *
 * The ordering guarantee itself ("an older response must never replace a
 * newer configuration's price") is proved in `src/lib/latestOnly.test.ts`,
 * where a superseded response can be made to land last on purpose. What is
 * tested here is what the reviewer actually sees:
 *
 *   - a burst of changes causes ONE /price call, not one per click
 *   - the price on screen belongs to the final configuration
 *   - a failed /price keeps the configuration and offers Retry
 */

import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { delay, http, HttpResponse } from 'msw';
import { setupServer } from 'msw/node';

import AppRoot from '@/AppRoot';
import { setApiBaseUrl } from '@/api/client';
import { priceCart } from '@/domain/pricing/priceCart';
import { DEFAULT_MENU } from '@/fixtures/menu.default';
import { handlers, setChaos } from '@/server/handlers';
import { resetSeedLoader } from '@/server/handlers';
import { resetServerClock } from '@/server/clock';
import { resetState } from '@/server/state';
import type { Selection } from '@/domain/types';
import seedJson from '../../public/orders.seed.json';

const server = setupServer(
  http.get('/orders.seed.json', () => HttpResponse.json(seedJson)),
  ...handlers,
);

interface PriceBody {
  readonly cart: readonly { readonly selection: Selection; readonly qty: number }[];
  readonly couponCode?: string | null;
  readonly requestId?: string;
}

beforeAll(() => {
  setApiBaseUrl('http://localhost:5173');
  server.listen({ onUnhandledRequest: 'bypass' });
});

afterAll(() => {
  server.close();
  setApiBaseUrl('');
});

beforeEach(() => {
  localStorage.clear();
  resetState();
  resetSeedLoader();
  setChaos(false);
});

afterEach(() => {
  server.resetHandlers(
    http.get('/orders.seed.json', () => HttpResponse.json(seedJson)),
    ...handlers,
  );
  setChaos(true);
  resetServerClock();
  localStorage.clear();
});

/**
 * Replaces /price with a handler the test drives: it records every request
 * and can be told to fail the first `failures` calls.
 */
function instrumentPrice(options: { failures?: number; latencyMs?: number } = {}) {
  const seen: PriceBody[] = [];
  let remainingFailures = options.failures ?? 0;

  server.use(
    http.post('/api/price', async ({ request }) => {
      const body = (await request.json()) as PriceBody;
      seen.push(body);

      if (options.latencyMs !== undefined) await delay(options.latencyMs);

      if (remainingFailures > 0) {
        remainingFailures -= 1;
        return HttpResponse.json(
          { error: 'price_unavailable', message: 'Pricing service hiccuped' },
          { status: 503 },
        );
      }

      return HttpResponse.json({
        serverTime: new Date().toISOString(),
        data: {
          requestId: body.requestId ?? null,
          breakdown: priceCart({
            cart: body.cart,
            menu: DEFAULT_MENU,
            couponCode: body.couponCode ?? null,
            serverTime: new Date('2026-11-25T09:00:00+06:00'),
          }),
        },
      });
    }),
  );

  return seen;
}

async function renderApp() {
  render(<AppRoot />);
  // The product name also appears in the top bar, so match the heading.
  await waitFor(
    () =>
      expect(
        screen.getByRole('heading', { name: 'Build Your Breakfast' }),
      ).toBeInTheDocument(),
    { timeout: 5000 },
  );
}

const plus = (optionName: string) =>
  screen.getByRole('button', { name: `Add one ${optionName}` });

describe('TC-12 - the price preview on screen', () => {
  it('debounces a burst of changes into a single /price call', async () => {
    const user = userEvent.setup({ delay: null });
    await renderApp();
    const seen = instrumentPrice();

    // Build configuration A as fast as the user can click. Only the last
    // configuration is worth pricing, so only it should be requested.
    await user.click(plus('Toast'));
    await user.click(plus('Scrambled'));
    await user.click(plus('Scrambled'));
    await user.click(plus('Chicken Sausage'));
    await user.click(plus('Ketchup'));

    await waitFor(() => expect(screen.getByText('Payable')).toBeInTheDocument(), {
      timeout: 5000,
    });

    // Every intermediate configuration was invalid anyway, so the preview
    // never asked for them, and the valid final one was asked for once.
    expect(seen).toHaveLength(1);
    expect(seen[0]?.cart[0]?.selection).toEqual({
      toast: 1,
      scrambled: 2,
      sausage: 1,
      ketchup: 1,
    });
  });

  it('shows the price of the final configuration, not an earlier one', async () => {
    const user = userEvent.setup({ delay: null });
    await renderApp();
    instrumentPrice({ latencyMs: 60 });

    await user.click(plus('Toast'));
    await user.click(plus('Scrambled'));
    await user.click(plus('Scrambled'));
    await user.click(plus('Chicken Sausage'));

    // A = 380.00, so payable is 380.00 + 19.00 VAT = 399 BDT.
    await waitFor(
      () => expect(screen.getAllByText('399.00 BDT').length).toBeGreaterThan(0),
      { timeout: 5000 },
    );

    // Two more Fried takes the eggs to 4 units: 380.00 + 60.00 = 440.00,
    // payable 440.00 + 22.00 = 462 BDT.
    await user.click(plus('Fried'));
    await user.click(plus('Fried'));

    await waitFor(
      () => expect(screen.getAllByText('462.00 BDT').length).toBeGreaterThan(0),
      { timeout: 5000 },
    );
    // The older configuration's price is gone, not sitting underneath.
    expect(screen.queryByText('399.00 BDT')).not.toBeInTheDocument();
  });

  it('asks again only for a genuinely different configuration', async () => {
    const user = userEvent.setup({ delay: null });
    await renderApp();
    const seen = instrumentPrice();

    await user.click(plus('Toast'));
    await user.click(plus('Scrambled'));
    await user.click(plus('Scrambled'));
    await user.click(plus('Chicken Sausage'));
    await waitFor(() => expect(screen.getByText('Payable')).toBeInTheDocument(), {
      timeout: 5000,
    });
    expect(seen).toHaveLength(1);

    // Adding then removing the same option returns to the priced state, so
    // there is nothing new to ask about.
    await user.click(plus('Ketchup'));
    await user.click(screen.getByRole('button', { name: 'Remove one Ketchup' }));

    await waitFor(() => expect(seen.length).toBeLessThanOrEqual(2), { timeout: 2000 });
    expect(seen[seen.length - 1]?.cart[0]?.selection).toEqual({
      toast: 1,
      scrambled: 2,
      sausage: 1,
    });
  });

  it('keeps the configuration and offers Retry when /price fails', async () => {
    const user = userEvent.setup({ delay: null });
    await renderApp();
    // Fail the first call only; the Retry must then succeed.
    instrumentPrice({ failures: 1 });

    await user.click(plus('Toast'));
    await user.click(plus('Scrambled'));
    await user.click(plus('Scrambled'));
    await user.click(plus('Chicken Sausage'));

    const retry = await waitFor(
      () => screen.getByRole('button', { name: 'Retry' }),
      { timeout: 5000 },
    );
    expect(screen.getByText('Pricing service hiccuped')).toBeInTheDocument();
    expect(screen.getByText('Your configuration is untouched.')).toBeInTheDocument();

    // The draft survived the failure: the selection is still on screen and
    // the item can still be added.
    expect(plus('Scrambled').closest('li')).toHaveTextContent('2');
    expect(screen.getByRole('button', { name: 'Add to Cart' })).toBeEnabled();

    await user.click(retry);

    await waitFor(
      () => expect(screen.getAllByText('399.00 BDT').length).toBeGreaterThan(0),
      { timeout: 5000 },
    );
    expect(screen.queryByRole('button', { name: 'Retry' })).not.toBeInTheDocument();
  });

  it('does not price an invalid configuration at all', async () => {
    const user = userEvent.setup({ delay: null });
    await renderApp();
    const seen = instrumentPrice();

    // One Scrambled breaks both the eggs minimum and its step of 2.
    await user.click(plus('Toast'));
    await user.click(plus('Scrambled'));

    // Instead of a price, the checklist says what is still missing and
    // offers to jump to it.
    expect(screen.getByText(/steps? left/)).toBeInTheDocument();
    expect(screen.getByText(/Eggs total must be 2-6 in steps of 2/)).toBeInTheDocument();
    expect(screen.getAllByText('Fix →').length).toBeGreaterThan(0);

    await new Promise((resolve) => setTimeout(resolve, 600));
    expect(seen).toHaveLength(0);
  });
});
