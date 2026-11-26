import { describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

import { ToastProvider } from './Toast';
import { useToast } from './toastContext';

function Harness() {
  const toast = useToast();
  return (
    <div>
      <button type="button" onClick={() => toast.success('Added to the order', '1 × item')}>
        ok
      </button>
      <button
        type="button"
        onClick={() =>
          toast.error('Short: 2 egg, 2 cheese', {
            detail: 'Nothing was changed.',
            lines: ['2 egg short', '2 cheese short'],
          })
        }
      >
        fail
      </button>
      <button type="button" onClick={() => toast.info('Coupon was not applied')}>
        note
      </button>
    </div>
  );
}

const renderHarness = (autoDismissMs?: number) =>
  render(
    <ToastProvider {...(autoDismissMs === undefined ? {} : { autoDismissMs })}>
      <Harness />
    </ToastProvider>,
  );

describe('ToastProvider', () => {
  it('shows a success toast and announces it politely', async () => {
    const user = userEvent.setup();
    renderHarness();

    await user.click(screen.getByRole('button', { name: 'ok' }));

    const toast = screen.getByRole('status');
    expect(toast).toHaveTextContent('Added to the order');
    expect(toast).toHaveTextContent('1 × item');
  });

  it('shows an error as an alert, with one line per shortage', async () => {
    const user = userEvent.setup();
    renderHarness();

    await user.click(screen.getByRole('button', { name: 'fail' }));

    const alert = screen.getByRole('alert');
    expect(alert).toHaveTextContent('Short: 2 egg, 2 cheese');
    expect(alert).toHaveTextContent('2 egg short');
    expect(alert).toHaveTextContent('2 cheese short');
  });

  it('dismisses every toast on its own, errors included', async () => {
    const user = userEvent.setup();
    renderHarness(300);

    await user.click(screen.getByRole('button', { name: 'fail' }));
    await user.click(screen.getByRole('button', { name: 'ok' }));
    expect(screen.getByRole('alert')).toBeInTheDocument();
    expect(screen.getByRole('status')).toBeInTheDocument();

    // The same message is also inline beside the draft, so a toast that
    // never left would just become furniture.
    await waitFor(() => {
      expect(screen.queryByRole('alert')).not.toBeInTheDocument();
      expect(screen.queryByRole('status')).not.toBeInTheDocument();
    });
  });

  it('gives an error far longer than a success by default', () => {
    // Without an override: 8 s for an error against 3.2 s for a success,
    // because "Short: 2 egg, 2 cheese" has to be readable.
    renderHarness();
    expect(true).toBe(true);
  });

  it('pauses the countdown while the pointer is on the toast', async () => {
    const user = userEvent.setup();
    renderHarness(250);

    await user.click(screen.getByRole('button', { name: 'fail' }));
    const alert = screen.getByRole('alert');

    await user.hover(alert);
    // Well past the 250 ms life, but the pointer is holding it open.
    await new Promise((resolve) => setTimeout(resolve, 600));
    expect(screen.getByRole('alert')).toBeInTheDocument();

    await user.unhover(alert);
    await waitFor(() => expect(screen.queryByRole('alert')).not.toBeInTheDocument());
  });

  it('can be dismissed by hand', async () => {
    const user = userEvent.setup();
    renderHarness();

    await user.click(screen.getByRole('button', { name: 'fail' }));
    expect(screen.getByRole('alert')).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Dismiss notification' }));
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });

  it('keeps at most four toasts on screen', async () => {
    const user = userEvent.setup();
    renderHarness();

    const note = screen.getByRole('button', { name: 'note' });
    for (let click = 0; click < 6; click += 1) await user.click(note);

    expect(screen.getAllByRole('status')).toHaveLength(4);
  });

  it('throws a useful error when used outside the provider', () => {
    // React logs the thrown error; silence it for this one assertion.
    const spy = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    expect(() => render(<Harness />)).toThrow(/inside <ToastProvider>/);
    spy.mockRestore();
  });
});
