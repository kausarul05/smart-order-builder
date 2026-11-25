/**
 * The three named configurations from Section 9 of the brief, plus the
 * server timestamps the acceptance tests pin themselves to.
 *
 *   A = Toast, Scrambled x2, Chicken Sausage x1, Ketchup
 *   B = Croissant, Omelette x2, Fried x2, Chicken Sausage x1,
 *       Beef Bacon x1, Hash Brown x1, Mushroom x1, Hollandaise
 *   C = Paratha, Fried x2, Tofu x1, Cheese x2, Baked Beans x1,
 *       Mushroom x1, Chili
 */

import type { Configuration, Selection } from '@/domain/types';
import { DEFAULT_MENU } from '@/fixtures/menu.default';

export const SELECTION_A: Selection = {
  toast: 1,
  scrambled: 2,
  sausage: 1,
  ketchup: 1,
};

export const SELECTION_B: Selection = {
  croissant: 1,
  omelette: 2,
  fried: 2,
  sausage: 1,
  bacon: 1,
  hashbrown: 1,
  mushroom: 1,
  hollandaise: 1,
};

export const SELECTION_C: Selection = {
  paratha: 1,
  fried: 2,
  tofu: 1,
  cheese: 2,
  beans: 1,
  mushroom: 1,
  chili: 1,
};

export const configOf = (selection: Selection): Configuration => ({
  productId: DEFAULT_MENU.productId,
  selection,
});

export const CONFIG_A = configOf(SELECTION_A);
export const CONFIG_B = configOf(SELECTION_B);
export const CONFIG_C = configOf(SELECTION_C);

/** Just inside the MORNING15 window (TC-06). */
export const AT_1059 = new Date('2026-11-25T10:59:59+06:00');
/** The first instant outside it (TC-07). */
export const AT_1100 = new Date('2026-11-25T11:00:00+06:00');
export const AT_1030 = new Date('2026-11-25T10:30:00+06:00');
export const AT_1130 = new Date('2026-11-25T11:30:00+06:00');
