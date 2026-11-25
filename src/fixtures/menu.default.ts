/**
 * Appendix A, as data.
 *
 * This file is imported ONLY by `src/server` (the mock API). No component
 * and no engine may import it: Section 2 requires that every group, option,
 * rule, ingredient, stock level and promotion reaches the app over the
 * network, so the app keeps working against a different fixture without a
 * code change. `src/fixtures/menu.alt.ts` exists to prove that.
 */

import { bdt } from '@/domain/money';
import type { Ingredient, Menu } from '@/domain/types';

export const DEFAULT_INGREDIENTS: readonly Ingredient[] = [
  { id: 'egg', name: 'egg' },
  { id: 'sausage', name: 'sausage' },
  { id: 'bacon', name: 'bacon' },
  { id: 'tofu', name: 'tofu' },
  { id: 'croissant', name: 'croissant' },
  { id: 'paratha', name: 'paratha' },
  { id: 'toast', name: 'toast' },
  { id: 'hashbrown', name: 'hash brown' },
  { id: 'mushroom', name: 'mushroom' },
  { id: 'beans', name: 'baked beans' },
  { id: 'cheese', name: 'cheese' },
  { id: 'hollandaise', name: 'hollandaise' },
];

/**
 * Ingredient stock on hand. Declaration order above is also the order in
 * which shortages are listed, which is what makes TC-11 read exactly
 * "Short: 2 egg, 2 cheese" rather than "2 cheese, 2 egg".
 */
export const DEFAULT_STOCK: Readonly<Record<string, number>> = {
  egg: 10,
  sausage: 4,
  bacon: 3,
  tofu: 5,
  croissant: 2,
  paratha: 10,
  toast: 20,
  hashbrown: 6,
  mushroom: 6,
  beans: 8,
  cheese: 4,
  hollandaise: 5,
};

export const DEFAULT_MENU: Menu = {
  version: 'appendix-a-1',
  productId: 'build-your-breakfast',
  productName: 'Build Your Breakfast',
  basePrice: bdt(250),
  itemQty: { min: 1, max: 3 },

  groups: [
    {
      id: 'bread',
      icon: 'bread',
      section: 'Build your plate',
      name: 'Bread',
      limits: { min: 1, max: 1 },
      options: [
        { id: 'toast', name: 'Toast', price: bdt(0), uses: { toast: 1 }, image: '/img/options/toast.svg' },
        { id: 'paratha', name: 'Paratha', price: bdt(20), uses: { paratha: 1 }, image: '/img/options/paratha.svg' },
        { id: 'croissant', name: 'Croissant', price: bdt(60), uses: { croissant: 1 }, image: '/img/options/croissant.svg' },
      ],
    },
    {
      id: 'eggs',
      icon: 'egg',
      section: 'Build your plate',
      name: 'Eggs',
      limits: { min: 2, max: 6, step: 2 },
      options: [
        { id: 'fried', name: 'Fried', price: bdt(30), uses: { egg: 1 }, image: '/img/options/fried.svg' },
        { id: 'scrambled', name: 'Scrambled', price: bdt(35), uses: { egg: 1 }, image: '/img/options/scrambled.svg' },
        { id: 'omelette', name: 'Omelette', price: bdt(70), uses: { egg: 2 }, image: '/img/options/omelette.svg' },
      ],
    },
    {
      id: 'protein',
      icon: 'protein',
      section: 'Build your plate',
      name: 'Protein',
      limits: { min: 1, max: 3 },
      options: [
        { id: 'sausage', name: 'Chicken Sausage', price: bdt(60), uses: { sausage: 1 }, image: '/img/options/sausage.svg' },
        { id: 'bacon', name: 'Beef Bacon', price: bdt(90), uses: { bacon: 1 }, image: '/img/options/bacon.svg' },
        { id: 'tofu', name: 'Tofu', price: bdt(50), uses: { tofu: 1 }, image: '/img/options/tofu.svg' },
      ],
    },
    {
      id: 'extras',
      icon: 'extras',
      section: 'Add-ons',
      name: 'Extras',
      limits: { min: 0, max: 4 },
      options: [
        { id: 'hashbrown', name: 'Hash Brown', price: bdt(40), uses: { hashbrown: 1 }, image: '/img/options/hashbrown.svg' },
        { id: 'mushroom', name: 'Mushroom', price: bdt(30), uses: { mushroom: 1 }, image: '/img/options/mushroom.svg' },
        { id: 'beans', name: 'Baked Beans', price: bdt(25), uses: { beans: 1 }, image: '/img/options/beans.svg' },
        { id: 'cheese', name: 'Cheese', price: bdt(35), uses: { cheese: 1 }, image: '/img/options/cheese.svg' },
      ],
    },
    {
      id: 'sauce',
      icon: 'sauce',
      section: 'Add-ons',
      name: 'Sauce',
      limits: { min: 0, maxDistinct: 2, maxPerOption: 1 },
      options: [
        // Ketchup and Chili consume nothing: "no stock" in Appendix A.
        { id: 'ketchup', name: 'Ketchup', price: bdt(0), uses: {}, image: '/img/options/ketchup.svg' },
        { id: 'hollandaise', name: 'Hollandaise', price: bdt(25), uses: { hollandaise: 1 }, image: '/img/options/hollandaise.svg' },
        { id: 'chili', name: 'Chili', price: bdt(10), uses: {}, image: '/img/options/chili.svg' },
      ],
    },
  ],

  rules: [
    {
      id: 'R1',
      type: 'requires',
      option: 'hollandaise',
      anyOf: ['scrambled', 'omelette'],
    },
    {
      id: 'R2',
      type: 'excludes',
      option: 'tofu',
      noneOf: ['sausage', 'bacon'],
    },
    {
      id: 'R3',
      type: 'overrideLimit',
      option: 'croissant',
      group: 'extras',
      limits: { min: 0, max: 2 },
    },
    {
      id: 'R4',
      type: 'excludes',
      option: 'chili',
      noneOf: ['hollandaise'],
    },
  ],

  ingredients: DEFAULT_INGREDIENTS,

  promotions: {
    extrasDeal: { id: 'P2', groupId: 'extras', every: 3 },
    combo: {
      id: 'P1',
      percent: 10,
      thresholds: [
        { groupId: 'eggs', minUnits: 4 },
        { groupId: 'protein', minUnits: 2 },
      ],
    },
    cartThreshold: {
      id: 'C1',
      minSubtotal: bdt(1200),
      amountOff: bdt(100),
    },
    coupons: [
      {
        id: 'C2',
        code: 'MORNING15',
        percent: 15,
        cap: bdt(150),
        validBefore: '11:00',
        timeZone: 'Asia/Dhaka',
      },
    ],
    vatPercent: 5,
  },
};
