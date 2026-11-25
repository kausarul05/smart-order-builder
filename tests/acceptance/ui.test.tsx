/**
 * React Testing Library over the real screen, talking to the real mock
 * server through MSW. These cover the behaviour the brief describes in the
 * UI rather than in an engine:
 *
 *   - "Add to Cart stays disabled while any violation exists"
 *   - every violation is listed, not just the first
 *   - "For each option, show how many more units can be added right now,
 *     and disable it at 0"
 *   - the full breakdown (subtotal, each discount, VAT, payable) is shown
 *   - TC-13: three fast clicks on Add to Cart create exactly one item
 */

import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { http, HttpResponse } from 'msw';

import App from '@/App';
import { setApiBaseUrl } from '@/api/client';
import { handlers, setChaos } from '@/server/handlers';
import { resetSeedLoader } from '@/server/handlers';
import { resetServerClock } from '@/server/clock';
import { getState, resetState } from '@/server/state';
import { setupServer } from 'msw/node';
import seedJson from '../../public/orders.seed.json';

const server = setupServer(
  // The order store seeds itself from this static file in the real app.
  http.get('/orders.seed.json', () => HttpResponse.json(seedJson)),
  ...handlers,
);

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
  // /price is deliberately slow and 15 % flaky; the preview behaviour has
  // its own tests, so the screen tests take the dice out.
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

/** Waits for the menu to arrive from GET /api/menu. */
async function renderApp() {
  render(<App />);
  await waitFor(
    () => expect(screen.getByText('Build Your Breakfast')).toBeInTheDocument(),
    { timeout: 5000 },
  );
}

const addButton = () => screen.getByRole('button', { name: 'Add to Cart' });

/** The "+" control for an option, found by its accessible name. */
const plus = (optionName: string) =>
  screen.getByRole('button', { name: `Add one ${optionName}` });

/** Builds configuration A: Toast, Scrambled x2, Chicken Sausage, Ketchup. */
async function buildConfigA(user: ReturnType<typeof userEvent.setup>) {
  await user.click(plus('Toast'));
  await user.click(plus('Scrambled'));
  await user.click(plus('Scrambled'));
  await user.click(plus('Chicken Sausage'));
  await user.click(plus('Ketchup'));
}

describe('the configurator screen', () => {
  it('keeps Add to Cart disabled while any violation exists', async () => {
    const user = userEvent.setup();
    await renderApp();

    // An empty configuration breaks three mandatory minimums at once.
    expect(addButton()).toBeDisabled();

    await user.click(plus('Toast'));
    expect(addButton()).toBeDisabled();

    await user.click(plus('Scrambled')); // 1 egg unit: breaks min 2 and step 2
    expect(addButton()).toBeDisabled();

    await user.click(plus('Scrambled'));
    await user.click(plus('Chicken Sausage'));

    await waitFor(() => expect(addButton()).toBeEnabled());
  });

  it('lists every violation, not just the first', async () => {
    await renderApp();

    // Bread, Eggs and Protein all have a minimum, so all three must show.
    expect(await screen.findByText(/Bread needs at least 1/)).toBeInTheDocument();
    expect(screen.getByText(/Eggs needs at least 2/)).toBeInTheDocument();
    expect(screen.getByText(/Protein needs at least 1/)).toBeInTheDocument();
  });

  it('shows how many more units of each option can be added', async () => {
    const user = userEvent.setup();
    await renderApp();

    // Cheese stock is 4, so four more can be added before it runs out.
    const cheeseRow = plus('Cheese').closest('li');
    expect(cheeseRow).not.toBeNull();
    expect(within(cheeseRow!).getByText('4 more can be added')).toBeInTheDocument();

    // Croissant stock is 2.
    const croissantRow = plus('Croissant').closest('li');
    expect(within(croissantRow!).getByText('2 more can be added')).toBeInTheDocument();

    // Ketchup has no stock at all, so it is never limited.
    const ketchupRow = plus('Ketchup').closest('li');
    expect(within(ketchupRow!).getByText('unlimited')).toBeInTheDocument();

    // Quantity multiplies usage: at qty 3, cheese allows only one unit.
    await user.selectOptions(screen.getByLabelText('Quantity'), '3');
    await waitFor(() =>
      expect(within(cheeseRow!).getByText('1 more can be added')).toBeInTheDocument(),
    );
  });

  it('disables an option at zero headroom, including a group cap', async () => {
    const user = userEvent.setup();
    await renderApp();

    // Bread is max 1: once Toast is picked, no bread can be added.
    await user.click(plus('Toast'));
    expect(plus('Toast')).toBeDisabled();
    expect(plus('Paratha')).toBeDisabled();
    expect(plus('Croissant')).toBeDisabled();

    // Eggs is max 6, so the sixth unit is the last one allowed.
    for (let click = 0; click < 6; click += 1) await user.click(plus('Fried'));
    expect(plus('Fried')).toBeDisabled();
    expect(plus('Omelette')).toBeDisabled();
  });

  it('enforces the Croissant override: Extras max drops from 4 to 2', async () => {
    const user = userEvent.setup();
    await renderApp();

    await user.click(plus('Croissant'));
    await user.click(plus('Hash Brown'));
    await user.click(plus('Mushroom'));

    // Base Extras max is 4, but R3 overrides it to 2 while Croissant is on.
    await waitFor(() => expect(plus('Baked Beans')).toBeDisabled());
    expect(plus('Cheese')).toBeDisabled();
  });

  it('shows the full price breakdown for configuration A', async () => {
    const user = userEvent.setup();
    await renderApp();
    await buildConfigA(user);

    await waitFor(
      () => expect(screen.getByText('Payable')).toBeInTheDocument(),
      { timeout: 5000 },
    );

    // A = 380.00 (base 250 + Scrambled x2 70 + Chicken Sausage 60), which
    // appears as the unit price, the line total and the cart subtotal.
    expect(screen.getAllByText('380.00').length).toBeGreaterThanOrEqual(3);
    expect(screen.getByText('Cart subtotal')).toBeInTheDocument();
    expect(screen.getByText('VAT 5%')).toBeInTheDocument();
    // No discount applies, so payable is 380.00 + 19.00 VAT = 399 BDT.
    expect(screen.getByText('19.00')).toBeInTheDocument();
    expect(screen.getByText('399.00 BDT')).toBeInTheDocument();
  });
});

describe('TC-13 on the screen - three fast clicks on Add to Cart', () => {
  it('creates exactly one cart item', async () => {
    const user = userEvent.setup();
    await renderApp();
    await buildConfigA(user);
    await waitFor(() => expect(addButton()).toBeEnabled());

    const button = addButton();
    // Fire all three without awaiting in between, the way a real
    // double/triple click arrives.
    await Promise.all([
      user.click(button),
      user.click(button),
      user.click(button),
    ]);

    await waitFor(() => {
      expect(getState().cart.size).toBe(1);
      expect(getState().reservations.size).toBe(1);
    });
  });
});

describe('the cart and stock panels', () => {
  it('shows a held item with its countdown and drops the stock', async () => {
    const user = userEvent.setup();
    await renderApp();
    await buildConfigA(user);
    await waitFor(() => expect(addButton()).toBeEnabled());
    await user.click(addButton());

    // The item appears with a 5-minute hold.
    await waitFor(() => expect(screen.getByText(/hold 4:5\d left/)).toBeInTheDocument());
    expect(screen.getByRole('button', { name: 'Remove' })).toBeEnabled();
    expect(screen.getByRole('button', { name: 'Edit' })).toBeEnabled();

    // A used 2 eggs, so free egg stock falls from 10 to 8.
    const stock = screen.getByRole('heading', { name: 'Shared stock' }).closest('section');
    await waitFor(() =>
      expect(within(stock!).getByText('egg').nextSibling).toHaveTextContent('8'),
    );
  });

  it('hands the ingredients back when the item is removed', async () => {
    const user = userEvent.setup();
    await renderApp();
    await buildConfigA(user);
    await waitFor(() => expect(addButton()).toBeEnabled());
    await user.click(addButton());

    await waitFor(() =>
      expect(screen.getByRole('button', { name: 'Remove' })).toBeInTheDocument(),
    );
    await user.click(screen.getByRole('button', { name: 'Remove' }));

    await waitFor(() => expect(getState().cart.size).toBe(0));
    const stock = screen.getByRole('heading', { name: 'Shared stock' }).closest('section');
    await waitFor(() =>
      expect(within(stock!).getByText('egg').nextSibling).toHaveTextContent('10'),
    );
  });
});
