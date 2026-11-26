/**
 * Part G, third item: an unfinished configuration survives a refresh.
 *
 * A "refresh" here is unmounting the tree and rendering it again with
 * sessionStorage intact, which is what the browser does.
 *
 * The draft is in sessionStorage rather than localStorage on purpose: a
 * half-built plate belongs to this tab and this sitting. Restoring
 * someone else's unfinished order in a new window would be surprising.
 */

import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { http, HttpResponse } from 'msw';
import { setupServer } from 'msw/node';

import AppRoot from '@/AppRoot';
import { setApiBaseUrl } from '@/api/client';
import { handlers, resetSeedLoader, setChaos } from '@/server/handlers';
import { resetServerClock } from '@/server/clock';
import { resetState } from '@/server/state';
import seedJson from '../../public/orders.seed.json';

const server = setupServer(
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
});

async function renderApp() {
  const view = render(<AppRoot />);
  await waitFor(
    () =>
      expect(
        screen.getByRole('heading', { name: 'Build Your Breakfast' }),
      ).toBeInTheDocument(),
    { timeout: 10_000 },
  );
  return view;
}

const plus = (optionName: string) =>
  screen.getByRole('button', { name: `Add one ${optionName}` });

/**
 * A tile only renders its minus button and its count once something is
 * picked, so presence of the minus button IS "has units" - which is a
 * sturdier check than matching a digit against the whole tile's text.
 */
const tileOf = (optionName: string): HTMLElement =>
  plus(optionName).closest('li') as HTMLElement;

const isPicked = (optionName: string): boolean =>
  within(tileOf(optionName)).queryByRole('button', {
    name: `Remove one ${optionName}`,
  }) !== null;

const countOf = (optionName: string): string =>
  within(tileOf(optionName))
    .getAllByText(/^\d+$/)
    .at(-1)?.textContent ?? '0';

describe('G3 - an unfinished configuration survives a refresh', () => {
  it('brings back the options and the quantity', async () => {
    const user = userEvent.setup();
    const first = await renderApp();

    await user.click(plus('Toast'));
    await user.click(plus('Scrambled'));
    await user.click(plus('Scrambled'));
    await user.selectOptions(screen.getByLabelText('Quantity'), '3');

    first.unmount();

    // Same tab, same sessionStorage: the plate is where it was left.
    await renderApp();
    expect(countOf('Scrambled')).toBe('2');
    expect(countOf('Toast')).toBe('1');
    expect(screen.getByLabelText('Quantity')).toHaveValue('3');
  });

  it('keeps the plate incomplete rather than quietly completing it', async () => {
    const user = userEvent.setup();
    const first = await renderApp();

    await user.click(plus('Toast'));
    first.unmount();

    await renderApp();
    // Still missing eggs and protein, and still refusing to be added.
    expect(await screen.findByText(/Eggs needs at least 2/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Add to Cart' })).toBeDisabled();
  });

  it('forgets the draft once the plate is in the cart', async () => {
    const user = userEvent.setup();
    const first = await renderApp();

    await user.click(plus('Toast'));
    await user.click(plus('Scrambled'));
    await user.click(plus('Scrambled'));
    await user.click(plus('Chicken Sausage'));
    await waitFor(() =>
      expect(screen.getByRole('button', { name: 'Add to Cart' })).toBeEnabled(),
    );
    await user.click(screen.getByRole('button', { name: 'Add to Cart' }));

    await waitFor(() => expect(screen.getByText(/hold 4:5\d left/)).toBeInTheDocument());
    first.unmount();

    // The plate was finished, so there is nothing unfinished to restore.
    await renderApp();
    expect(isPicked('Scrambled')).toBe(false);
    expect(isPicked('Toast')).toBe(false);
  });

  it('drops options a different fixture no longer has', async () => {
    sessionStorage.setItem(
      'sob.draft.v1',
      JSON.stringify({ selection: { toast: 1, caviar: 2 }, qty: 1 }),
    );

    await renderApp();
    // Toast survives; an id this menu does not know is discarded rather
    // than revived into a configuration the engine cannot price.
    expect(countOf('Toast')).toBe('1');
    expect(screen.queryByText(/caviar/i)).not.toBeInTheDocument();
  });

  it('ignores a corrupt draft rather than failing to boot', async () => {
    sessionStorage.setItem('sob.draft.v1', '{ not json');
    await renderApp();

    // The screen comes up empty, as if there had been no draft at all.
    expect(isPicked('Toast')).toBe(false);
    expect(await screen.findByText('3 steps left')).toBeInTheDocument();
  });

  it('clamps a quantity the menu does not allow', async () => {
    sessionStorage.setItem(
      'sob.draft.v1',
      JSON.stringify({ selection: { toast: 1 }, qty: 99 }),
    );
    await renderApp();
    expect(screen.getByLabelText('Quantity')).toHaveValue('1');
  });
});
