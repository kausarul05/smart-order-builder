/**
 * The floating launcher. It was a tab inside the order rail, which hid the
 * assistant behind the till; this is the pattern every support widget
 * uses, and the point of it is that it is always reachable.
 *
 * The behaviour worth pinning is the keyboard: a panel you can open but
 * not escape, or that leaves focus behind it, is worse than a tab.
 */

import { describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

import { AssistantLauncher } from '@/features/assistant/AssistantLauncher';
import { DEFAULT_MENU } from '@/fixtures/menu.default';

const renderLauncher = () =>
  render(<AssistantLauncher menu={DEFAULT_MENU} orders={[]} />);

const launcher = () => screen.getByRole('button', { name: 'Open the sales assistant' });

describe('AssistantLauncher', () => {
  it('starts closed, with the button always on screen', () => {
    renderLauncher();
    expect(launcher()).toHaveAttribute('aria-expanded', 'false');
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });

  it('opens the panel and moves focus into it', async () => {
    const user = userEvent.setup();
    renderLauncher();

    await user.click(launcher());

    const panel = screen.getByRole('dialog', { name: 'Sales assistant' });
    expect(panel).toBeInTheDocument();
    // The question box is focused, so typing works straight away.
    expect(document.activeElement).toBe(
      screen.getByLabelText('Ask the sales assistant'),
    );
  });

  it('closes on Escape and gives focus back to the button', async () => {
    const user = userEvent.setup();
    renderLauncher();

    await user.click(launcher());
    expect(screen.getByRole('dialog')).toBeInTheDocument();

    await user.keyboard('{Escape}');
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(document.activeElement).toBe(launcher());
  });

  it('closes from the panel header', async () => {
    const user = userEvent.setup();
    renderLauncher();
    await user.click(launcher());

    const closers = screen.getAllByRole('button', {
      name: 'Close the sales assistant',
    });
    await user.click(closers[closers.length - 1]!);
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });

  it('carries the order count in the panel header', async () => {
    const user = userEvent.setup();
    render(
      <AssistantLauncher
        menu={DEFAULT_MENU}
        orders={[{ id: 'ORD-1' }, { id: 'ORD-2' }] as never}
      />,
    );

    await user.click(launcher());
    expect(
      screen.getByText('2 orders · answers from your own data'),
    ).toBeInTheDocument();
  });

  it('shows the assistant itself once open', async () => {
    const user = userEvent.setup();
    renderLauncher();
    await user.click(launcher());

    // The suggestion that proves TC-20 is one tap away.
    expect(
      screen.getByRole('button', { name: 'Who is our best customer?' }),
    ).toBeInTheDocument();
  });
});
