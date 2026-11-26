/**
 * A second, deliberately unrelated menu.
 *
 * Section 2 of the brief says the reviewers may run the app against a
 * different menu fixture and it must keep working without a code change.
 * This is that fixture, and `tests/acceptance/alt-fixture.test.ts` runs
 * the rules, stock, pricing and checkout engines against it.
 *
 * Nothing is shared with Appendix A on purpose: different product, group
 * ids, option ids, ingredient ids, limits, rule ids, promotion values,
 * coupon code, coupon window, VAT rate and quantity range. If any engine
 * had learned a single id from the default fixture, this file would break
 * it.
 */

import { bdt } from '@/domain/money';
import type { Ingredient, Menu } from '@/domain/types';

export const ALT_INGREDIENTS: readonly Ingredient[] = [
  { id: 'rice', name: 'rice' },
  { id: 'prawn', name: 'prawn' },
  { id: 'chickpea', name: 'chickpea' },
  { id: 'yoghurt', name: 'yoghurt' },
  { id: 'mint', name: 'mint', unlimited: true },
];

export const ALT_STOCK: Readonly<Record<string, number>> = {
  rice: 9,
  prawn: 4,
  chickpea: 6,
  yoghurt: 3,
};

export const ALT_MENU: Menu = {
  version: 'alt-biryani-1',
  productId: 'build-your-biryani',
  productName: 'Build Your Biryani',
  basePrice: bdt(180),
  // A different quantity range, so anything that assumed 1..3 shows up.
  itemQty: { min: 1, max: 2 },

  groups: [
    {
      id: 'portion',
      name: 'Portion',
      icon: 'dish',
      section: 'Base',
      // Counted in units of 3, which is not the default fixture's step.
      limits: { min: 3, max: 9, step: 3 },
      options: [
        { id: 'half', name: 'Half plate', price: bdt(0), uses: { rice: 1 } },
        { id: 'full', name: 'Full plate', price: bdt(40), uses: { rice: 2 } },
      ],
    },
    {
      id: 'topping',
      name: 'Topping',
      icon: 'protein',
      section: 'Base',
      limits: { min: 1, max: 4 },
      options: [
        { id: 'prawn', name: 'Prawn', price: bdt(120), uses: { prawn: 1 } },
        { id: 'chickpea', name: 'Chickpea', price: bdt(45), uses: { chickpea: 1 } },
      ],
    },
    {
      id: 'side',
      name: 'Side',
      icon: 'extras',
      section: 'Extras',
      limits: { min: 0, max: 3 },
      options: [
        { id: 'raita', name: 'Raita', price: bdt(35), uses: { yoghurt: 1 } },
        { id: 'salad', name: 'Salad', price: bdt(25), uses: {} },
        { id: 'chutney', name: 'Chutney', price: bdt(15), uses: { mint: 1 } },
      ],
    },
  ],

  rules: [
    // Rule ids differ too, so nothing can key off R1..R4.
    { id: 'A1', type: 'requires', option: 'raita', anyOf: ['full'] },
    { id: 'A2', type: 'excludes', option: 'prawn', noneOf: ['chickpea'] },
    {
      id: 'A3',
      type: 'overrideLimit',
      option: 'prawn',
      group: 'side',
      limits: { min: 0, max: 1 },
    },
  ],

  ingredients: ALT_INGREDIENTS,

  promotions: {
    // Every third SIDE unit is free here, not every third extra.
    extrasDeal: { id: 'ALT-P2', groupId: 'side', every: 3 },
    combo: {
      id: 'ALT-P1',
      percent: 20,
      thresholds: [
        { groupId: 'portion', minUnits: 6 },
        { groupId: 'topping', minUnits: 2 },
      ],
    },
    cartThreshold: { id: 'ALT-C1', minSubtotal: bdt(800), amountOff: bdt(75) },
    coupons: [
      {
        id: 'ALT-C2',
        code: 'LUNCH20',
        percent: 20,
        cap: bdt(200),
        validBefore: '15:00',
        timeZone: 'Asia/Dhaka',
      },
    ],
    vatPercent: 10,
  },
};
