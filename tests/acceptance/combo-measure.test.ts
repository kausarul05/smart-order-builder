/**
 * The one ambiguity in the brief, pinned.
 *
 * Part C: "P1 Combo (per unit): if eggs >= 4 AND protein >= 2, take 10%
 * off the step-2 amount."
 *
 * "eggs >= 4" can mean four option UNITS in the Eggs group, or four egg
 * INGREDIENTS. They are not the same: Omelette is one unit but two eggs.
 * Protein is 1:1, so only the eggs threshold can differ at all.
 *
 * This file does three things:
 *   1. proves no acceptance test distinguishes the two readings, so the
 *      choice cannot be settled from the brief;
 *   2. shows the single configuration shape where they disagree;
 *   3. shows the one-line fixture change that switches the reading, so a
 *      reviewer who wants the other one does not need a code change.
 *
 * The shipped fixture counts option units, for consistency: every other
 * count in the engine - min, max, step, maxDistinct - is option units,
 * proven by TC-01 and TC-09.
 */

import { describe, expect, it } from 'vitest';

import { bdt } from '@/domain/money';
import { comboQualifies, priceUnit } from '@/domain/pricing/priceCart';
import { DEFAULT_MENU } from '@/fixtures/menu.default';
import type { Menu, Selection } from '@/domain/types';
import { SELECTION_A, SELECTION_B, SELECTION_C } from '../fixtures/configs';

/** The same menu, reading "eggs >= 4" as four egg ingredients. */
const BY_INGREDIENT: Menu = {
  ...DEFAULT_MENU,
  promotions: {
    ...DEFAULT_MENU.promotions,
    combo: {
      ...DEFAULT_MENU.promotions.combo,
      thresholds: [
        { ingredientId: 'egg', minUnits: 4 },
        { groupId: 'protein', minUnits: 2 },
      ],
    },
  },
};

/** Every configuration the brief pins a number to. */
const PINNED: readonly (readonly [string, Selection])[] = [
  ['A (TC-05)', SELECTION_A],
  ['B (TC-05, TC-06, TC-07)', SELECTION_B],
  ['C (TC-05, TC-06, TC-07)', SELECTION_C],
  ['B edited (TC-10)', { ...SELECTION_B, omelette: 1, fried: 3 }],
  ['B edited (TC-09)', { ...SELECTION_B, omelette: 3, fried: 1 }],
  ['cheapest valid (ANSWERS Q2)', { toast: 1, fried: 2, tofu: 1 }],
];

describe('the two readings agree on everything the brief pins', () => {
  it.each(PINNED)('%s prices the same either way', (_label, selection) => {
    expect(priceUnit(selection, DEFAULT_MENU).unitPrice).toBe(
      priceUnit(selection, BY_INGREDIENT).unitPrice,
    );
  });

  it('still produces the exact figures from Section 9', () => {
    expect(priceUnit(SELECTION_A, BY_INGREDIENT).unitPrice).toBe(bdt(380));
    expect(priceUnit(SELECTION_B, BY_INGREDIENT).unitPrice).toBe(bdt(679.5));
    expect(priceUnit(SELECTION_C, BY_INGREDIENT).unitPrice).toBe(bdt(490));
  });
});

describe('where the two readings part company', () => {
  // Omelette x2 is TWO units but FOUR eggs, with two proteins alongside.
  const OMELETTE_PAIR: Selection = { toast: 1, omelette: 2, sausage: 1, bacon: 1 };

  it('counts 2 units and 4 eggs for the same plate', () => {
    expect(comboQualifies(OMELETTE_PAIR, DEFAULT_MENU)).toBe(false); // 2 units
    expect(comboQualifies(OMELETTE_PAIR, BY_INGREDIENT)).toBe(true); // 4 eggs
  });

  it('is a 54.00 BDT difference on that plate', () => {
    // base 250 + Toast 0 + Omelette x2 140 + Sausage 60 + Bacon 90 = 540.00
    const asUnits = priceUnit(OMELETTE_PAIR, DEFAULT_MENU);
    const asIngredients = priceUnit(OMELETTE_PAIR, BY_INGREDIENT);

    expect(asUnits.step2).toBe(bdt(540));
    expect(asUnits.unitPrice).toBe(bdt(540));
    expect(asIngredients.unitPrice).toBe(bdt(486)); // 10% off
  });

  it('no acceptance test covers that shape, which is why it is a decision', () => {
    // None of the pinned configurations selects Omelette without also
    // reaching four units in the Eggs group.
    for (const [, selection] of PINNED) {
      expect(comboQualifies(selection, DEFAULT_MENU)).toBe(
        comboQualifies(selection, BY_INGREDIENT),
      );
    }
  });
});

describe('switching the reading is a fixture change, not a code change', () => {
  it('needs only the threshold line replaced', () => {
    // This is the whole diff: { groupId: 'eggs' } -> { ingredientId: 'egg' }
    const flipped = BY_INGREDIENT.promotions.combo.thresholds[0];
    expect(flipped).toEqual({ ingredientId: 'egg', minUnits: 4 });

    const shipped = DEFAULT_MENU.promotions.combo.thresholds[0];
    expect(shipped).toEqual({ groupId: 'eggs', minUnits: 4 });
  });

  it('leaves the protein threshold identical, because it is 1:1', () => {
    const byUnits: Selection = { toast: 1, scrambled: 4, sausage: 1, bacon: 1 };
    expect(comboQualifies(byUnits, DEFAULT_MENU)).toBe(true);
    expect(comboQualifies(byUnits, BY_INGREDIENT)).toBe(true);
  });
});
