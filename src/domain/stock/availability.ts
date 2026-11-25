/**
 * Part B - shared stock, headroom and the net-difference rule for edits.
 *
 * The one rule that makes editing correct: an item's OWN current allocation
 * counts as available to itself. So an edit is never "release then reserve"
 * (which can lose the ingredients to another tab in between) and never
 * "reserve the whole new amount" (which double-counts). It is a single
 * atomic swap of `current` for `next`, and only the positive part of the
 * difference has to be found in free stock.
 */

import { addUsage, pruneUsage } from './ingredients';
import type {
  Ingredient,
  IngredientId,
  MenuGroup,
  MenuOption,
  Shortage,
  Usage,
} from '../types';
import { usageOfSelection } from './ingredients';
import type { Selection } from '../types';

export interface NetDifference {
  /** Extra units that must be found in free stock. */
  readonly needs: Usage;
  /** Units handed back to free stock by the same call. */
  readonly releases: Usage;
}

/**
 * The net effect of replacing allocation `current` with allocation `next`.
 *
 * TC-09/TC-10 are exactly this: item B holds 6 eggs. Editing it to need 7
 * only has to find 1 more egg; editing it to need 5 hands 1 egg back.
 */
export function netDifference(current: Usage, next: Usage): NetDifference {
  const ids = new Set<IngredientId>([
    ...Object.keys(current),
    ...Object.keys(next),
  ]);
  const needs: Record<IngredientId, number> = {};
  const releases: Record<IngredientId, number> = {};
  for (const id of ids) {
    const delta = (next[id] ?? 0) - (current[id] ?? 0);
    if (delta > 0) needs[id] = delta;
    else if (delta < 0) releases[id] = -delta;
  }
  return { needs, releases };
}

/**
 * Every ingredient that is short, with the exact missing amount, ordered by
 * the menu's ingredient declaration order. The order is what makes TC-11
 * read "Short: 2 egg, 2 cheese" and not "Short: 2 cheese, 2 egg".
 */
export function shortagesFor(
  needs: Usage,
  available: Readonly<Record<IngredientId, number>>,
  ingredients: readonly Ingredient[],
): readonly Shortage[] {
  const out: Shortage[] = [];
  for (const ingredient of ingredients) {
    const needed = needs[ingredient.id] ?? 0;
    if (needed <= 0) continue;
    const free = available[ingredient.id] ?? 0;
    if (free >= needed) continue;
    out.push({
      ingredientId: ingredient.id,
      name: ingredient.name,
      missing: needed - free,
    });
  }
  // An ingredient the menu never declared cannot be satisfied at all.
  for (const [id, needed] of Object.entries(needs)) {
    if (needed <= 0) continue;
    if (ingredients.some((ingredient) => ingredient.id === id)) continue;
    out.push({ ingredientId: id, name: id, missing: needed });
  }
  return out;
}

/** "Short: 2 egg, 2 cheese" - empty string when nothing is short. */
export function formatShortages(shortages: readonly Shortage[]): string {
  if (shortages.length === 0) return '';
  const parts = shortages.map(
    (shortage) => `${shortage.missing} ${shortage.name}`,
  );
  return `Short: ${parts.join(', ')}`;
}

/**
 * How many MORE units of `option` can be added right now, limited by stock
 * alone. Group limits are a separate concern (see `limitHeadroom`); the UI
 * shows the smaller of the two and disables the option at 0.
 *
 * `available` must already include the editing item's own allocation when
 * this is called while editing - that is the net-difference rule applied to
 * the headroom display.
 *
 * `qty` is the cart item quantity, because quantity multiplies usage.
 */
export function stockHeadroom(
  option: MenuOption,
  available: Readonly<Record<IngredientId, number>>,
  qty: number,
): number {
  const uses = Object.entries(option.uses);
  if (uses.length === 0) return Number.POSITIVE_INFINITY;
  let headroom = Number.POSITIVE_INFINITY;
  for (const [ingredientId, perUnit] of uses) {
    if (perUnit <= 0) continue;
    const free = available[ingredientId] ?? 0;
    headroom = Math.min(headroom, Math.floor(free / (perUnit * qty)));
  }
  return Math.max(0, headroom);
}

/** Stock headroom for every option on the menu, keyed by option id. */
export function stockHeadroomByOption(
  groups: readonly MenuGroup[],
  available: Readonly<Record<IngredientId, number>>,
  qty: number,
): Readonly<Record<string, number>> {
  const out: Record<string, number> = {};
  for (const group of groups) {
    for (const option of group.options) {
      out[option.id] = stockHeadroom(option, available, qty);
    }
  }
  return out;
}

/**
 * Can this change be served? Returns the shortages, which is also the
 * blocking reason the UI shows.
 */
export function checkChange(args: {
  readonly current: Usage;
  readonly next: Usage;
  readonly available: Readonly<Record<IngredientId, number>>;
  readonly ingredients: readonly Ingredient[];
}): { readonly ok: boolean; readonly shortages: readonly Shortage[]; readonly diff: NetDifference } {
  const diff = netDifference(args.current, args.next);
  const shortages = shortagesFor(diff.needs, args.available, args.ingredients);
  return { ok: shortages.length === 0, shortages, diff };
}

/**
 * Convenience wrapper for a whole cart line: what a line of `qty` units of
 * `selection` allocates.
 */
export function lineAllocation(
  selection: Selection,
  groups: readonly MenuGroup[],
  qty: number,
): Usage {
  const perUnit = usageOfSelection(selection, groups);
  const scaled: Record<IngredientId, number> = {};
  for (const [id, amount] of Object.entries(perUnit)) scaled[id] = amount * qty;
  return pruneUsage(scaled);
}

/** Total allocation held by a set of lines. */
export function totalAllocation(
  lines: readonly { readonly selection: Selection; readonly qty: number }[],
  groups: readonly MenuGroup[],
): Usage {
  return pruneUsage(
    addUsage(...lines.map((line) => lineAllocation(line.selection, groups, line.qty))),
  );
}
