/**
 * TC-01 .. TC-04 - Part A, the rules engine.
 */

import { describe, expect, it } from 'vitest';

import { validate } from '@/domain/rules/validate';
import { DEFAULT_MENU } from '@/fixtures/menu.default';
import type { Selection, Violation } from '@/domain/types';
import { CONFIG_A, CONFIG_B, CONFIG_C, configOf } from '../fixtures/configs';

const run = (selection: Selection): readonly Violation[] =>
  validate(configOf(selection), DEFAULT_MENU.groups, DEFAULT_MENU.rules);

const codes = (violations: readonly Violation[]): readonly string[] =>
  violations.map((violation) => violation.code);

describe('the three named configurations are valid', () => {
  it.each([
    ['A', CONFIG_A],
    ['B', CONFIG_B],
    ['C', CONFIG_C],
  ])('config %s passes validation', (_label, config) => {
    expect(validate(config, DEFAULT_MENU.groups, DEFAULT_MENU.rules)).toEqual([]);
  });
});

describe('TC-01 - Scrambled x3 breaks the eggs step', () => {
  const violations = run({ toast: 1, scrambled: 3, sausage: 1 });

  it('is blocked', () => {
    expect(violations.length).toBeGreaterThan(0);
  });

  it('reports a step violation against the eggs group', () => {
    const step = violations.find((violation) => violation.code === 'step');
    expect(step).toBeDefined();
    expect(step?.scope).toEqual({ kind: 'group', groupId: 'eggs' });
    expect(step?.message).toBe(
      'Eggs total must be 2-6 in steps of 2 (you have 3)',
    );
  });
});

describe('TC-02 - Croissant + 3 extras breaks the override (max 2)', () => {
  const violations = run({
    croissant: 1,
    scrambled: 2,
    sausage: 1,
    hashbrown: 1,
    mushroom: 1,
    beans: 1,
  });

  it('is blocked even though the base Extras max is 4', () => {
    expect(DEFAULT_MENU.groups.find((group) => group.id === 'extras')?.limits.max).toBe(4);
    expect(codes(violations)).toContain('max');
  });

  it('names the override rule that won', () => {
    const max = violations.find((violation) => violation.code === 'max');
    expect(max?.scope).toEqual({ kind: 'group', groupId: 'extras' });
    expect(max?.viaOverride).toBe('R3');
    expect(max?.message).toBe(
      'Extras max is 2 when Croissant is selected (you have 3)',
    );
  });

  it('accepts exactly 2 extras with Croissant', () => {
    expect(
      run({ croissant: 1, scrambled: 2, sausage: 1, hashbrown: 1, mushroom: 1 }),
    ).toEqual([]);
  });
});

describe('TC-03 - Hollandaise with only Fried eggs', () => {
  const violations = run({
    toast: 1,
    fried: 2,
    sausage: 1,
    hollandaise: 1,
  });

  it('is blocked by the requires rule', () => {
    const requires = violations.find((violation) => violation.code === 'requires');
    expect(requires?.scope).toEqual({ kind: 'rule', ruleId: 'R1' });
    expect(requires?.message).toBe('Hollandaise requires Scrambled or Omelette');
  });

  it('passes once Scrambled is present', () => {
    expect(run({ toast: 1, scrambled: 2, sausage: 1, hollandaise: 1 })).toEqual([]);
  });
});

describe('TC-04 - excludes rules, and every violation is listed', () => {
  it('Tofu excludes Beef Bacon', () => {
    const violations = run({ toast: 1, scrambled: 2, tofu: 1, bacon: 1 });
    const excludes = violations.find((violation) => violation.code === 'excludes');
    expect(excludes?.scope).toEqual({ kind: 'rule', ruleId: 'R2' });
    expect(excludes?.message).toBe('Tofu cannot be combined with Beef Bacon');
  });

  it('Chili excludes Hollandaise', () => {
    const violations = run({
      toast: 1,
      scrambled: 2,
      sausage: 1,
      chili: 1,
      hollandaise: 1,
    });
    const excludes = violations.find((violation) => violation.scope.kind === 'rule');
    expect(excludes?.scope).toEqual({ kind: 'rule', ruleId: 'R4' });
  });

  it('lists BOTH violations when both exist', () => {
    const violations = run({
      toast: 1,
      fried: 2,
      tofu: 1,
      bacon: 1,
      chili: 1,
      hollandaise: 1,
    });
    const ruleIds = violations
      .filter((violation) => violation.scope.kind === 'rule')
      .map((violation) => (violation.scope.kind === 'rule' ? violation.scope.ruleId : ''));

    // R2 (tofu/bacon), R4 (chili/hollandaise) and R1 (hollandaise needs
    // scrambled or omelette, and only Fried is selected).
    expect(new Set(ruleIds)).toEqual(new Set(['R1', 'R2', 'R4']));
  });
});

describe('group limits beyond the acceptance table', () => {
  it('reports min when a mandatory group is empty', () => {
    const violations = run({ scrambled: 2, sausage: 1 });
    const min = violations.find((violation) => violation.code === 'min');
    expect(min?.scope).toEqual({ kind: 'group', groupId: 'bread' });
  });

  it('reports maxDistinct for three sauces', () => {
    const violations = run({
      toast: 1,
      scrambled: 2,
      sausage: 1,
      ketchup: 1,
      hollandaise: 1,
      chili: 1,
    });
    expect(codes(violations)).toContain('maxDistinct');
  });

  it('reports maxPerOption for two of the same sauce', () => {
    const violations = run({ toast: 1, scrambled: 2, sausage: 1, ketchup: 2 });
    expect(codes(violations)).toContain('maxPerOption');
  });

  it('rejects an option that is not on the menu', () => {
    const violations = run({ toast: 1, scrambled: 2, sausage: 1, caviar: 1 });
    expect(codes(violations)).toContain('unknownOption');
  });
});
