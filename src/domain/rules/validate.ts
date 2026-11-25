/**
 * Part A - the rules engine.
 *
 * `validate` is pure and generic: it never mentions an option id, a group id
 * or a limit value. Everything comes from `groups` and `rules`, so the same
 * function validates a different menu fixture without a code change.
 *
 * It returns EVERY violation, not the first one. "Add to Cart" is disabled
 * while the returned array is non-empty.
 */

import {
  groupDistinct,
  groupUnits,
  indexOptions,
  isSelected,
  joinWithOr,
  unknownOptionIds,
} from '../selection';
import type {
  Configuration,
  GroupId,
  GroupLimits,
  MenuGroup,
  OptionId,
  Rule,
  RuleId,
  Selection,
  Violation,
} from '../types';

/** The limits that actually apply to a group, after any override. */
export interface EffectiveLimits {
  readonly limits: GroupLimits;
  /** The overrideLimit rule that supplied them, if any. */
  readonly viaRule: RuleId | null;
  /** The option whose selection triggered the override. */
  readonly triggeredBy: OptionId | null;
}

/**
 * Resolve the limits for every group given the current selection.
 *
 * An `overrideLimit` rule whose trigger option is selected REPLACES the
 * group's base limits - it does not merge with them. That is what "the
 * override must win over the base limit" means for TC-02: base Extras max
 * is 4, Croissant overrides it to 2, and 3 extras must be blocked even
 * though 3 <= 4.
 *
 * If several overrides target the same group, the last matching rule in
 * menu order wins; the menu is expected not to contain conflicting ones.
 */
export function effectiveLimits(
  selection: Selection,
  groups: readonly MenuGroup[],
  rules: readonly Rule[],
): ReadonlyMap<GroupId, EffectiveLimits> {
  const resolved = new Map<GroupId, EffectiveLimits>();
  for (const group of groups) {
    resolved.set(group.id, {
      limits: group.limits,
      viaRule: null,
      triggeredBy: null,
    });
  }

  for (const rule of rules) {
    if (rule.type !== 'overrideLimit') continue;
    if (!resolved.has(rule.group)) continue;
    if (!isSelected(selection, rule.option)) continue;
    resolved.set(rule.group, {
      limits: rule.limits,
      viaRule: rule.id,
      triggeredBy: rule.option,
    });
  }

  return resolved;
}

export function validate(
  config: Configuration,
  groups: readonly MenuGroup[],
  rules: readonly Rule[],
): readonly Violation[] {
  const { selection } = config;
  const violations: Violation[] = [];
  const index = indexOptions(groups);
  const nameOf = (optionId: OptionId): string =>
    index.get(optionId)?.option.name ?? optionId;

  for (const unknown of unknownOptionIds(selection, groups)) {
    violations.push({
      scope: { kind: 'group', groupId: '*' },
      code: 'unknownOption',
      message: `"${unknown}" is not on this menu`,
    });
  }

  const limitsByGroup = effectiveLimits(selection, groups, rules);

  for (const group of groups) {
    const effective = limitsByGroup.get(group.id);
    if (!effective) continue;
    violations.push(...checkGroup(selection, group, effective, nameOf));
  }

  for (const rule of rules) {
    switch (rule.type) {
      case 'requires': {
        if (!isSelected(selection, rule.option)) break;
        const satisfied = rule.anyOf.some((id) => isSelected(selection, id));
        if (satisfied) break;
        violations.push({
          scope: { kind: 'rule', ruleId: rule.id },
          code: 'requires',
          message: `${nameOf(rule.option)} requires ${joinWithOr(
            rule.anyOf.map(nameOf),
          )}`,
        });
        break;
      }
      case 'excludes': {
        if (!isSelected(selection, rule.option)) break;
        const clashing = rule.noneOf.filter((id) => isSelected(selection, id));
        if (clashing.length === 0) break;
        violations.push({
          scope: { kind: 'rule', ruleId: rule.id },
          code: 'excludes',
          message: `${nameOf(rule.option)} cannot be combined with ${joinWithOr(
            clashing.map(nameOf),
          )}`,
        });
        break;
      }
      case 'overrideLimit':
        // Already folded into the effective limits above.
        break;
    }
  }

  return violations;
}

function checkGroup(
  selection: Selection,
  group: MenuGroup,
  effective: EffectiveLimits,
  nameOf: (optionId: OptionId) => string,
): readonly Violation[] {
  const { limits, viaRule, triggeredBy } = effective;
  const units = groupUnits(selection, group);
  const out: Violation[] = [];

  const base = (code: Violation['code'], message: string): Violation =>
    viaRule === null
      ? { scope: { kind: 'group', groupId: group.id }, code, message }
      : {
          scope: { kind: 'group', groupId: group.id },
          code,
          message,
          viaOverride: viaRule,
        };

  const overrideSuffix =
    triggeredBy === null ? '' : ` when ${nameOf(triggeredBy)} is selected`;

  if (limits.min !== undefined && units < limits.min) {
    out.push(
      base(
        'min',
        `${group.name} needs at least ${limits.min}${overrideSuffix} (you have ${units})`,
      ),
    );
  }

  if (limits.max !== undefined && units > limits.max) {
    out.push(
      base(
        'max',
        `${group.name} max is ${limits.max}${overrideSuffix} (you have ${units})`,
      ),
    );
  }

  if (limits.step !== undefined && limits.step > 0 && units % limits.step !== 0) {
    const range =
      limits.min !== undefined && limits.max !== undefined
        ? `${limits.min}-${limits.max}`
        : null;
    out.push(
      base(
        'step',
        range === null
          ? `${group.name} total must be a multiple of ${limits.step} (you have ${units})`
          : `${group.name} total must be ${range} in steps of ${limits.step} (you have ${units})`,
      ),
    );
  }

  if (limits.maxDistinct !== undefined) {
    const distinct = groupDistinct(selection, group);
    if (distinct > limits.maxDistinct) {
      out.push(
        base(
          'maxDistinct',
          `${group.name} allows at most ${limits.maxDistinct} different options${overrideSuffix} (you have ${distinct})`,
        ),
      );
    }
  }

  if (limits.maxPerOption !== undefined) {
    for (const option of group.options) {
      const picked = selection[option.id] ?? 0;
      if (picked > limits.maxPerOption) {
        out.push(
          base(
            'maxPerOption',
            `${option.name}: at most ${limits.maxPerOption} per option in ${group.name} (you have ${picked})`,
          ),
        );
      }
    }
  }

  return out;
}

/** Convenience for the UI: is this configuration addable? */
export function isValid(
  config: Configuration,
  groups: readonly MenuGroup[],
  rules: readonly Rule[],
): boolean {
  return validate(config, groups, rules).length === 0;
}
