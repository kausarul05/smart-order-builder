/**
 * The checklist that replaced "Finish a valid configuration to see the
 * price".
 *
 * Two behaviours are worth pinning: every violation is still shown (the
 * brief requires all of them, not just the first), and an unfinished group
 * is not dressed up as an error — if everything is red, red stops meaning
 * anything.
 */

import { describe, expect, it, vi } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

import { validate } from '@/domain/rules/validate';
import { DEFAULT_MENU } from '@/fixtures/menu.default';
import { ValidationPanel } from '@/features/configurator/ValidationPanel';
import type { Selection } from '@/domain/types';

function panelFor(selection: Selection, onJump = vi.fn()) {
  const violations = validate(
    { productId: DEFAULT_MENU.productId, selection },
    DEFAULT_MENU.groups,
    DEFAULT_MENU.rules,
  );
  render(
    <ValidationPanel
      menu={DEFAULT_MENU}
      violations={violations}
      satisfiedGroups={3}
      onJump={onJump}
    />,
  );
  return { violations, onJump };
}

describe('the validation checklist', () => {
  it('lists every violation, not just the first', () => {
    const { violations } = panelFor({});
    expect(violations.length).toBe(3); // bread, eggs, protein minimums

    expect(screen.getByText('Bread needs at least 1 (you have 0)')).toBeInTheDocument();
    expect(screen.getByText('Eggs needs at least 2 (you have 0)')).toBeInTheDocument();
    expect(screen.getByText('Protein needs at least 1 (you have 0)')).toBeInTheDocument();
  });

  it('counts the steps left in the headline', () => {
    panelFor({});
    expect(screen.getByText('3 steps left')).toBeInTheDocument();
    expect(screen.getByText('3 of 5 categories ready')).toBeInTheDocument();
  });

  it('uses the singular for one step', () => {
    panelFor({ toast: 1, scrambled: 2 });
    expect(screen.getByText('One step left')).toBeInTheDocument();
  });

  it('calls an unmet minimum a to-do, not a conflict', () => {
    panelFor({ toast: 1, scrambled: 2 });
    const row = screen.getByText('Protein needs at least 1 (you have 0)').closest('li');
    expect(row).not.toBeNull();
    expect(within(row!).getByText(/^To do/)).toBeInTheDocument();
  });

  it('calls an impossible combination a conflict', () => {
    panelFor({ toast: 1, scrambled: 2, tofu: 1, bacon: 1 });
    const row = screen
      .getByText('Tofu cannot be combined with Beef Bacon')
      .closest('li');
    expect(within(row!).getByText(/^Conflict/)).toBeInTheDocument();
    expect(screen.getByText('One combination does not work')).toBeInTheDocument();
  });

  it('names the override rule that produced a limit', () => {
    panelFor({
      croissant: 1,
      scrambled: 2,
      sausage: 1,
      hashbrown: 1,
      mushroom: 1,
      beans: 1,
    });
    const row = screen
      .getByText('Extras max is 2 when Croissant is selected (you have 3)')
      .closest('li');
    expect(within(row!).getByText(/rule R3/)).toBeInTheDocument();
  });

  it('puts conflicts above the to-dos', () => {
    panelFor({ fried: 2, tofu: 1, bacon: 1 });
    const rows = screen.getAllByRole('listitem');
    // The excludes conflict comes before the missing bread.
    expect(rows[0]?.textContent).toMatch(/Conflict/);
    expect(rows[rows.length - 1]?.textContent).toMatch(/To do/);
  });

  it('jumps to the group a group-scoped violation belongs to', async () => {
    const user = userEvent.setup();
    const onJump = vi.fn();
    panelFor({}, onJump);

    await user.click(screen.getByText('Eggs needs at least 2 (you have 0)'));
    expect(onJump).toHaveBeenCalledWith('eggs');
  });

  it('traces a cross-group rule back to the option that triggered it', async () => {
    const user = userEvent.setup();
    const onJump = vi.fn();
    panelFor({ toast: 1, fried: 2, sausage: 1, hollandaise: 1 }, onJump);

    // R1 lives on Hollandaise, which is in Sauce - so that is where the
    // fix is, not in Eggs.
    await user.click(screen.getByText('Hollandaise requires Scrambled or Omelette'));
    expect(onJump).toHaveBeenCalledWith('sauce');
  });

  it('reports progress to assistive technology', () => {
    panelFor({});
    const bar = screen.getByRole('progressbar', { name: 'Categories ready' });
    expect(bar).toHaveAttribute('aria-valuenow', '60'); // 3 of 5
  });
});
