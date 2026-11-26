/**
 * Turning a tap on an option into the next selection.
 *
 * Most groups add up: Eggs wants 2 to 6 units, so tapping Scrambled adds a
 * unit and tapping it again adds another. A group whose effective max is 1
 * is not like that — it is a choice of one, and Appendix A's Bread group is
 * exactly that (min 1, max 1). Tapping Toast while Paratha is picked means
 * "Toast instead", not "a second bread", so this replaces the group's pick
 * rather than pushing it over its own limit.
 *
 * The signal comes from the data, not from a group id: any group the
 * fixture caps at one unit behaves this way, including one an
 * `overrideLimit` rule has just capped at one.
 */

import { addUnits, indexOptions, withUnits } from '../selection';
import type { MenuGroup, OptionId, Rule, Selection } from '../types';
import { effectiveLimits } from './validate';

/** True when this group holds at most one unit in total, so picking replaces. */
export function isSingleChoice(
  groupId: string,
  selection: Selection,
  groups: readonly MenuGroup[],
  rules: readonly Rule[],
): boolean {
  return effectiveLimits(selection, groups, rules).get(groupId)?.limits.max === 1;
}

/**
 * The selection after tapping `optionId` by `delta`.
 *
 * Removing is always literal — a tap on minus only ever takes away what it
 * names. Adding into a single-choice group clears that group first, so the
 * swap lands in one step instead of forcing the user to find the minus
 * button on the option they are replacing.
 */
export function applyPick(
  selection: Selection,
  optionId: OptionId,
  delta: number,
  groups: readonly MenuGroup[],
  rules: readonly Rule[],
): Selection {
  if (delta <= 0) return addUnits(selection, optionId, delta);

  const entry = indexOptions(groups).get(optionId);
  if (entry === undefined) return addUnits(selection, optionId, delta);

  const { group } = entry;
  if (!isSingleChoice(group.id, selection, groups, rules)) {
    return addUnits(selection, optionId, delta);
  }

  // Already the pick: nothing to swap, and the stepper is capped anyway.
  if ((selection[optionId] ?? 0) > 0) return addUnits(selection, optionId, delta);

  let next = selection;
  for (const option of group.options) {
    if (option.id === optionId) continue;
    if ((next[option.id] ?? 0) === 0) continue;
    next = withUnits(next, option.id, 0);
  }
  return withUnits(next, optionId, 1);
}
