/**
 * Integer money. Everything is poisha; 1 BDT = 100 poisha.
 *
 * C1 (checkpoint): 679.50 cannot be held exactly in a binary float, so a
 * chain of float operations drifts and TC-06 lands on 1584.97 or 1585.01
 * instead of 1585. Every function here works on integers only - the single
 * division by 100 is done with integer arithmetic (see `roundHalfUpDiv`),
 * so no intermediate value is ever a non-integer.
 */

import type { Poisha } from './types';

export const POISHA_PER_BDT = 100;

/**
 * Half-up integer division: round(n / d) with .5 going away from zero.
 * Both arguments must be integers and `d` must be positive.
 */
export function roundHalfUpDiv(n: number, d: number): number {
  if (!Number.isInteger(n) || !Number.isInteger(d)) {
    throw new Error(`roundHalfUpDiv expects integers, got ${n} / ${d}`);
  }
  if (d <= 0) throw new Error(`roundHalfUpDiv expects a positive divisor, got ${d}`);
  const half = Math.floor(d / 2);
  return n >= 0 ? Math.floor((n + half) / d) : -Math.floor((-n + half) / d);
}

/**
 * `percent`% of `amount`, rounded half-up to the nearest poisha.
 *
 * Worked example - the VAT in TC-06 (C1 asks for this by hand):
 *   discounted subtotal = 1,509.50 BDT = 150950 poisha
 *   150950 * 5          = 754750
 *   754750 / 100        = 7547.5  -> exactly half, so round UP
 *   = 7548 poisha       = 75.48 BDT
 * Done as integers: floor((754750 + 50) / 100) = floor(7548.0) = 7548.
 */
export function percentOf(amount: Poisha, percent: number): Poisha {
  assertPoisha(amount);
  return roundHalfUpDiv(amount * percent, 100);
}

/** Round a poisha amount half-up to a whole BDT, returned as poisha. */
export function roundHalfUpToWholeBdt(amount: Poisha): Poisha {
  assertPoisha(amount);
  return roundHalfUpDiv(amount, POISHA_PER_BDT) * POISHA_PER_BDT;
}

/**
 * Build a poisha amount from a BDT figure written in a fixture or a test,
 * e.g. `bdt(679.5)` -> 67950. Rejects anything finer than a poisha so a
 * typo in a fixture fails loudly instead of silently rounding.
 */
export function bdt(amount: number): Poisha {
  const scaled = Math.round(amount * POISHA_PER_BDT);
  if (Math.abs(amount * POISHA_PER_BDT - scaled) > 1e-6) {
    throw new Error(`bdt(${amount}) is finer than one poisha`);
  }
  return scaled;
}

/** "1,659.50" - always two decimals, grouped thousands, no currency symbol. */
export function formatPoisha(amount: Poisha): string {
  assertPoisha(amount);
  const sign = amount < 0 ? '-' : '';
  const abs = Math.abs(amount);
  const whole = Math.floor(abs / POISHA_PER_BDT);
  const frac = abs % POISHA_PER_BDT;
  return `${sign}${whole.toLocaleString('en-US')}.${String(frac).padStart(2, '0')}`;
}

/** "1,659.50 BDT" */
export function formatBdt(amount: Poisha): string {
  return `${formatPoisha(amount)} BDT`;
}

export function sumPoisha(amounts: readonly Poisha[]): Poisha {
  let total = 0;
  for (const amount of amounts) {
    assertPoisha(amount);
    total += amount;
  }
  return total;
}

function assertPoisha(amount: number): void {
  if (!Number.isInteger(amount)) {
    throw new Error(`Money must be an integer number of poisha, got ${amount}`);
  }
}
