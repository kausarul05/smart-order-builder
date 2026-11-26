/**
 * Turning a selection into ingredient usage, and the small amount of
 * arithmetic the stock engine needs. Pure and menu-driven.
 */

import { indexOptions } from '../selection';
import type {
  Ingredient,
  IngredientId,
  MenuGroup,
  Selection,
  StockSnapshot,
  Usage,
} from '../types';

/** Ingredients consumed by ONE unit of this configuration. */
export function usageOfSelection(
  selection: Selection,
  groups: readonly MenuGroup[],
): Usage {
  const index = indexOptions(groups);
  const usage: Record<IngredientId, number> = {};
  for (const [optionId, units] of Object.entries(selection)) {
    if (units <= 0) continue;
    const entry = index.get(optionId);
    if (!entry) continue; // unknown options are reported by validate()
    for (const [ingredientId, perUnit] of Object.entries(entry.option.uses)) {
      usage[ingredientId] = (usage[ingredientId] ?? 0) + perUnit * units;
    }
  }
  return usage;
}

/**
 * Ingredients consumed by a whole cart line: one unit's usage multiplied by
 * the item quantity (1-3).
 */
export function usageOfLine(
  selection: Selection,
  groups: readonly MenuGroup[],
  qty: number,
): Usage {
  return scaleUsage(usageOfSelection(selection, groups), qty);
}

export function scaleUsage(usage: Usage, factor: number): Usage {
  const out: Record<IngredientId, number> = {};
  for (const [id, amount] of Object.entries(usage)) out[id] = amount * factor;
  return out;
}

export function addUsage(...parts: readonly Usage[]): Usage {
  const out: Record<IngredientId, number> = {};
  for (const part of parts) {
    for (const [id, amount] of Object.entries(part)) {
      out[id] = (out[id] ?? 0) + amount;
    }
  }
  return out;
}

/**
 * `available` less what `usage` already speaks for, floored at zero.
 *
 * The brief shares stock across the cart AND the configuration being
 * built, but a draft holds nothing on the server until Add to Cart. So the
 * screen subtracts the draft itself before it tells anyone how many more
 * units they can add; otherwise the grid offers eggs the plate has already
 * claimed and the shortage only surfaces at Add to Cart.
 *
 * An unlimited ingredient stays `Infinity`.
 */
export function minusUsage(
  available: Readonly<Record<IngredientId, number>>,
  usage: Usage,
): Readonly<Record<IngredientId, number>> {
  const out: Record<IngredientId, number> = { ...available };
  for (const [id, amount] of Object.entries(usage)) {
    out[id] = Math.max(0, (out[id] ?? 0) - amount);
  }
  return out;
}

/** Drops zero and negative entries so a usage map stays canonical. */
export function pruneUsage(usage: Usage): Usage {
  const out: Record<IngredientId, number> = {};
  for (const [id, amount] of Object.entries(usage)) {
    if (amount > 0) out[id] = amount;
  }
  return out;
}

export function emptySnapshot(
  onHand: Readonly<Record<IngredientId, number>>,
): StockSnapshot {
  return { onHand: { ...onHand }, reserved: {}, sold: {} };
}

/**
 * Units of `ingredientId` that can be handed out right now:
 * on hand - reserved - sold. `Infinity` for an unlimited ingredient
 * (Appendix A: Ketchup and Chili), and 0 for one the fixture never mentions.
 */
export function availableOf(
  snapshot: StockSnapshot,
  ingredientId: IngredientId,
  ingredients: readonly Ingredient[],
): number {
  const declared = ingredients.find((item) => item.id === ingredientId);
  if (declared?.unlimited === true) return Number.POSITIVE_INFINITY;
  const onHand = snapshot.onHand[ingredientId];
  if (onHand === undefined) return 0;
  return onHand - (snapshot.reserved[ingredientId] ?? 0) - (snapshot.sold[ingredientId] ?? 0);
}

/** The full availability map, in the menu's ingredient declaration order. */
export function availableMap(
  snapshot: StockSnapshot,
  ingredients: readonly Ingredient[],
): Readonly<Record<IngredientId, number>> {
  const out: Record<IngredientId, number> = {};
  for (const ingredient of ingredients) {
    out[ingredient.id] = availableOf(snapshot, ingredient.id, ingredients);
  }
  return out;
}
