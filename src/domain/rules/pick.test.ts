import { describe, expect, it } from 'vitest';

import { bdt } from '../money';
import { applyPick, isSingleChoice } from './pick';
import { validate } from './validate';
import { DEFAULT_MENU } from '@/fixtures/menu.default';
import type { Menu, Selection } from '../types';

const { groups, rules } = DEFAULT_MENU;
const pick = (selection: Selection, optionId: string, delta = 1): Selection =>
  applyPick(selection, optionId, delta, groups, rules);

describe('a group capped at one unit is a choice, not a limit', () => {
  it('recognises Bread as single-choice and Eggs as cumulative', () => {
    expect(isSingleChoice('bread', {}, groups, rules)).toBe(true);
    expect(isSingleChoice('eggs', {}, groups, rules)).toBe(false);
  });

  it('replaces the pick rather than pushing the group over its max', () => {
    const withToast = pick({}, 'toast');
    expect(withToast).toEqual({ toast: 1 });

    const swapped = pick(withToast, 'paratha');
    expect(swapped).toEqual({ paratha: 1 });
    // The swap lands in one tap, and the result is still valid bread.
    expect(validate({ productId: DEFAULT_MENU.productId, selection: swapped }, groups, rules)
      .filter((violation) => violation.scope.kind === 'group' && violation.scope.groupId === 'bread'))
      .toEqual([]);
  });

  it('keeps the rest of the plate untouched while swapping', () => {
    const plate: Selection = { toast: 1, scrambled: 2, sausage: 1, cheese: 1 };
    expect(pick(plate, 'croissant')).toEqual({
      croissant: 1,
      scrambled: 2,
      sausage: 1,
      cheese: 1,
    });
  });

  it('does not swap a group that counts units', () => {
    expect(pick({ fried: 1 }, 'scrambled')).toEqual({ fried: 1, scrambled: 1 });
  });

  it('leaves removal literal, so minus only ever takes what it names', () => {
    expect(pick({ toast: 1 }, 'toast', -1)).toEqual({});
    expect(pick({ fried: 2, scrambled: 1 }, 'fried', -1)).toEqual({ fried: 1, scrambled: 1 });
  });

  it('ignores an option the menu does not have', () => {
    expect(pick({ toast: 1 }, 'caviar')).toEqual({ toast: 1, caviar: 1 });
  });
});

describe('the single-choice signal comes from the data, not a group id', () => {
  /** A fixture whose second group is only single-choice once X is picked. */
  const menu: Menu = {
    ...DEFAULT_MENU,
    version: 'pick-test-1',
    groups: [
      {
        id: 'size',
        name: 'Size',
        limits: { min: 1, max: 1 },
        options: [
          { id: 'small', name: 'Small', price: bdt(0), uses: {} },
          { id: 'large', name: 'Large', price: bdt(50), uses: {} },
        ],
      },
      {
        id: 'sides',
        name: 'Sides',
        limits: { min: 0, max: 3 },
        options: [
          { id: 'fries', name: 'Fries', price: bdt(40), uses: {} },
          { id: 'salad', name: 'Salad', price: bdt(30), uses: {} },
        ],
      },
    ],
    rules: [
      { id: 'X1', type: 'overrideLimit', option: 'large', group: 'sides', limits: { min: 0, max: 1 } },
    ],
  };

  it('treats Sides as cumulative until the override caps it at one', () => {
    expect(isSingleChoice('sides', { small: 1 }, menu.groups, menu.rules)).toBe(false);
    expect(isSingleChoice('sides', { large: 1 }, menu.groups, menu.rules)).toBe(true);
  });

  it('swaps inside a group an overrideLimit rule has just narrowed', () => {
    const cumulative = applyPick({ small: 1, fries: 1 }, 'salad', 1, menu.groups, menu.rules);
    expect(cumulative).toEqual({ small: 1, fries: 1, salad: 1 });

    const narrowed = applyPick({ large: 1, fries: 1 }, 'salad', 1, menu.groups, menu.rules);
    expect(narrowed).toEqual({ large: 1, salad: 1 });
  });
});
