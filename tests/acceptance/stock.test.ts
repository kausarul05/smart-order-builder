/**
 * TC-08 .. TC-11 - Part B, ingredient-based shared stock and the
 * net-difference rule for edits.
 *
 * These exercise the pure engine. The same scenarios run against the mock
 * server (atomic reserve / swap) in tests/acceptance/cart.test.ts.
 */

import { beforeEach, describe, expect, it } from 'vitest';

import { bdt } from '@/domain/money';
import { priceUnit } from '@/domain/pricing/priceCart';
import {
  checkChange,
  formatShortages,
  lineAllocation,
  stockHeadroom,
  totalAllocation,
} from '@/domain/stock/availability';
import { availableMap } from '@/domain/stock/ingredients';
import { DEFAULT_MENU, DEFAULT_STOCK } from '@/fixtures/menu.default';
import type { IngredientId, Selection, StockSnapshot } from '@/domain/types';
import { SELECTION_B, SELECTION_C } from '../fixtures/configs';

const menu = DEFAULT_MENU;
const groups = menu.groups;

/** The cart from TC-08: B x1 + C x2, both reserved. */
const CART = [
  { selection: SELECTION_B, qty: 1 },
  { selection: SELECTION_C, qty: 2 },
];

let snapshot: StockSnapshot;
let available: Readonly<Record<IngredientId, number>>;

beforeEach(() => {
  snapshot = {
    onHand: DEFAULT_STOCK,
    reserved: totalAllocation(CART, groups),
    sold: {},
  };
  available = availableMap(snapshot, menu.ingredients);
});

describe('TC-08 - remaining stock with B x1 + C x2 in the cart', () => {
  it('egg 0, cheese 0, croissant 1', () => {
    expect(available.egg).toBe(0);
    expect(available.cheese).toBe(0);
    expect(available.croissant).toBe(1);
  });

  it('blocks every new item that needs eggs', () => {
    const eggs = groups.find((group) => group.id === 'eggs');
    expect(eggs).toBeDefined();
    for (const option of eggs?.options ?? []) {
      expect(stockHeadroom(option, available, 1)).toBe(0);
    }
  });

  it('gives the blocking reason, not just a disabled control', () => {
    const next: Selection = { toast: 1, fried: 2, sausage: 1 };
    const result = checkChange({
      current: {},
      next: lineAllocation(next, groups, 1),
      available,
      ingredients: menu.ingredients,
    });
    expect(result.ok).toBe(false);
    expect(formatShortages(result.shortages)).toBe('Short: 2 egg');
  });

  it('still allows an item that needs nothing scarce', () => {
    const ketchupOnly = groups
      .find((group) => group.id === 'sauce')
      ?.options.find((option) => option.id === 'ketchup');
    expect(ketchupOnly).toBeDefined();
    expect(stockHeadroom(ketchupOnly!, available, 1)).toBe(
      Number.POSITIVE_INFINITY,
    );
  });
});

describe('TC-09 - editing B to Omelette x3 + Fried x1 is blocked', () => {
  const edited: Selection = { ...SELECTION_B, omelette: 3, fried: 1 };

  it('needs 7 eggs while holding 6, so it is short exactly 1', () => {
    const result = checkChange({
      current: lineAllocation(SELECTION_B, groups, 1),
      next: lineAllocation(edited, groups, 1),
      available,
      ingredients: menu.ingredients,
    });
    expect(result.diff.needs.egg).toBe(1);
    expect(result.ok).toBe(false);
    expect(formatShortages(result.shortages)).toBe('Short: 1 egg');
  });

  it("counts B's own 6 eggs as available to itself", () => {
    // Without the net-difference rule the shortage would be the full 7.
    const naive = checkChange({
      current: {},
      next: lineAllocation(edited, groups, 1),
      available,
      ingredients: menu.ingredients,
    });
    expect(naive.shortages[0]?.missing).toBe(7);
  });
});

describe('TC-10 - editing B to Omelette x1 + Fried x3 is allowed', () => {
  const edited: Selection = { ...SELECTION_B, omelette: 1, fried: 3 };

  it('is served from the ingredients B already holds', () => {
    const result = checkChange({
      current: lineAllocation(SELECTION_B, groups, 1),
      next: lineAllocation(edited, groups, 1),
      available,
      ingredients: menu.ingredients,
    });
    expect(result.ok).toBe(true);
    expect(result.diff.releases.egg).toBe(1);
    expect(result.diff.needs.egg).toBeUndefined();
  });

  it('re-prices B to 643.50', () => {
    expect(priceUnit(edited, menu).unitPrice).toBe(bdt(643.5));
  });

  it('leaves 1 egg available afterwards', () => {
    const after: StockSnapshot = {
      onHand: DEFAULT_STOCK,
      reserved: totalAllocation(
        [
          { selection: edited, qty: 1 },
          { selection: SELECTION_C, qty: 2 },
        ],
        groups,
      ),
      sold: {},
    };
    expect(availableMap(after, menu.ingredients).egg).toBe(1);
  });
});

describe('TC-11 - raising C from quantity 2 to 3 lists every shortage', () => {
  it('reports 2 egg and 2 cheese, in the menu ingredient order', () => {
    const result = checkChange({
      current: lineAllocation(SELECTION_C, groups, 2),
      next: lineAllocation(SELECTION_C, groups, 3),
      available,
      ingredients: menu.ingredients,
    });
    expect(result.ok).toBe(false);
    expect(result.shortages.map((shortage) => shortage.ingredientId)).toEqual([
      'egg',
      'cheese',
    ]);
    expect(formatShortages(result.shortages)).toBe('Short: 2 egg, 2 cheese');
  });

  it('quantity multiplies ingredient usage', () => {
    expect(lineAllocation(SELECTION_C, groups, 1).egg).toBe(2);
    expect(lineAllocation(SELECTION_C, groups, 3).egg).toBe(6);
  });
});

describe('the engine never releases more than an item holds', () => {
  it('removing an item hands back exactly its own allocation', () => {
    const held = lineAllocation(SELECTION_B, groups, 1);
    const result = checkChange({
      current: held,
      next: {},
      available,
      ingredients: menu.ingredients,
    });
    expect(result.diff.releases).toEqual(held);
    expect(result.diff.needs).toEqual({});
    expect(result.ok).toBe(true);
  });

  it('an unchanged edit needs and releases nothing', () => {
    const result = checkChange({
      current: lineAllocation(SELECTION_B, groups, 1),
      next: lineAllocation(SELECTION_B, groups, 1),
      available,
      ingredients: menu.ingredients,
    });
    expect(result.diff).toEqual({ needs: {}, releases: {} });
  });
});
