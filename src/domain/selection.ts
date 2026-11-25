/**
 * Helpers for reading a `Selection` against a menu. Nothing here knows any
 * option id, group id or limit: every answer is derived from the menu that
 * was passed in.
 */

import type {
  GroupId,
  Menu,
  MenuGroup,
  MenuOption,
  OptionId,
  Selection,
} from './types';

export interface IndexedOption {
  readonly option: MenuOption;
  readonly group: MenuGroup;
}

/** optionId -> { option, group }, built once per menu. */
export function indexOptions(
  groups: readonly MenuGroup[],
): ReadonlyMap<OptionId, IndexedOption> {
  const index = new Map<OptionId, IndexedOption>();
  for (const group of groups) {
    for (const option of group.options) {
      if (index.has(option.id)) {
        throw new Error(`Duplicate option id in menu: ${option.id}`);
      }
      index.set(option.id, { option, group });
    }
  }
  return index;
}

/** Entries with a positive unit count, in menu order. */
export function selectedEntries(
  selection: Selection,
  groups: readonly MenuGroup[],
): readonly { readonly option: MenuOption; readonly group: MenuGroup; readonly units: number }[] {
  const out: { option: MenuOption; group: MenuGroup; units: number }[] = [];
  for (const group of groups) {
    for (const option of group.options) {
      const units = selection[option.id] ?? 0;
      if (units > 0) out.push({ option, group, units });
    }
  }
  return out;
}

/** Option ids present in the selection but not in the menu. */
export function unknownOptionIds(
  selection: Selection,
  groups: readonly MenuGroup[],
): readonly OptionId[] {
  const index = indexOptions(groups);
  return Object.keys(selection).filter(
    (id) => (selection[id] ?? 0) > 0 && !index.has(id),
  );
}

/** Total option UNITS selected inside a group (Omelette x2 counts as 2). */
export function groupUnits(selection: Selection, group: MenuGroup): number {
  let total = 0;
  for (const option of group.options) total += selection[option.id] ?? 0;
  return total;
}

export function groupUnitsById(
  selection: Selection,
  groups: readonly MenuGroup[],
  groupId: GroupId,
): number {
  const group = groups.find((candidate) => candidate.id === groupId);
  if (!group) throw new Error(`Unknown group id: ${groupId}`);
  return groupUnits(selection, group);
}

/** Number of DISTINCT options selected inside a group. */
export function groupDistinct(selection: Selection, group: MenuGroup): number {
  let distinct = 0;
  for (const option of group.options) {
    if ((selection[option.id] ?? 0) > 0) distinct += 1;
  }
  return distinct;
}

export function isSelected(selection: Selection, optionId: OptionId): boolean {
  return (selection[optionId] ?? 0) > 0;
}

/** A selection with `optionId` moved to `units`; 0 removes the key. */
export function withUnits(
  selection: Selection,
  optionId: OptionId,
  units: number,
): Selection {
  const next: Record<OptionId, number> = { ...selection };
  if (units > 0) next[optionId] = units;
  else delete next[optionId];
  return next;
}

export function addUnits(
  selection: Selection,
  optionId: OptionId,
  delta: number,
): Selection {
  return withUnits(selection, optionId, (selection[optionId] ?? 0) + delta);
}

/** Human-readable option name, falling back to the raw id. */
export function optionName(menu: Menu, optionId: OptionId): string {
  return indexOptions(menu.groups).get(optionId)?.option.name ?? optionId;
}

/** "Scrambled or Omelette" / "Chicken Sausage or Beef Bacon" */
export function joinWithOr(names: readonly string[]): string {
  if (names.length === 0) return '';
  if (names.length === 1) return names[0] ?? '';
  return `${names.slice(0, -1).join(', ')} or ${names[names.length - 1] ?? ''}`;
}
