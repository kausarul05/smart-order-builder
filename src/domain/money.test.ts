import { describe, expect, it } from 'vitest';

import {
  bdt,
  formatBdt,
  formatPoisha,
  percentOf,
  roundHalfUpDiv,
  roundHalfUpToWholeBdt,
  sumPoisha,
} from './money';

describe('roundHalfUpDiv', () => {
  it('rounds a half away from zero', () => {
    expect(roundHalfUpDiv(5, 2)).toBe(3);
    expect(roundHalfUpDiv(7, 2)).toBe(4);
    expect(roundHalfUpDiv(-5, 2)).toBe(-3);
  });

  it('leaves exact divisions alone', () => {
    expect(roundHalfUpDiv(100, 100)).toBe(1);
    expect(roundHalfUpDiv(0, 100)).toBe(0);
  });

  it('refuses non-integers, so a float can never sneak in', () => {
    expect(() => roundHalfUpDiv(7.5, 2)).toThrow(/integers/);
    expect(() => roundHalfUpDiv(5, 0)).toThrow(/positive divisor/);
  });
});

describe('percentOf', () => {
  it('computes the TC-06 VAT exactly: 5% of 1,509.50 = 75.48', () => {
    // 150950 * 5 = 754750; 754750 / 100 = 7547.5, a dead-on half, so it
    // rounds UP to 7548 poisha = 75.48 BDT.
    expect(percentOf(bdt(1509.5), 5)).toBe(bdt(75.48));
  });

  it('computes the TC-07 VAT: 5% of 1,559.50 = 77.98', () => {
    expect(percentOf(bdt(1559.5), 5)).toBe(bdt(77.98));
  });

  it('computes the 10% combo on 755.00 = 75.50', () => {
    expect(percentOf(bdt(755), 10)).toBe(bdt(75.5));
  });

  it('computes 15% of 1,659.50 = 248.93 before the cap', () => {
    // 165950 * 15 = 2489250; / 100 = 24892.5 -> 24893.
    expect(percentOf(bdt(1659.5), 15)).toBe(bdt(248.93));
  });
});

describe('roundHalfUpToWholeBdt', () => {
  it('rounds the TC-06 total 1,584.98 up to 1,585', () => {
    expect(roundHalfUpToWholeBdt(bdt(1584.98))).toBe(bdt(1585));
  });

  it('rounds the TC-07 total 1,637.48 down to 1,637', () => {
    expect(roundHalfUpToWholeBdt(bdt(1637.48))).toBe(bdt(1637));
  });

  it('rounds an exact half up', () => {
    expect(roundHalfUpToWholeBdt(bdt(1039.5))).toBe(bdt(1040));
  });

  it('always returns a whole number of BDT', () => {
    for (const amount of [1, 49, 50, 51, 99, 100, 150, 12345]) {
      expect(roundHalfUpToWholeBdt(amount) % 100).toBe(0);
    }
  });
});

describe('bdt', () => {
  it('scales a BDT figure to poisha', () => {
    expect(bdt(679.5)).toBe(67950);
    expect(bdt(0)).toBe(0);
    expect(bdt(250)).toBe(25000);
  });

  it('rejects an amount finer than one poisha', () => {
    expect(() => bdt(1.005)).toThrow(/finer than one poisha/);
  });
});

describe('formatting', () => {
  it('always shows two decimals and grouped thousands', () => {
    expect(formatPoisha(bdt(1659.5))).toBe('1,659.50');
    expect(formatPoisha(bdt(0))).toBe('0.00');
    expect(formatPoisha(bdt(75.48))).toBe('75.48');
    expect(formatPoisha(bdt(1585))).toBe('1,585.00');
  });

  it('appends the currency only in formatBdt', () => {
    expect(formatBdt(bdt(100))).toBe('100.00 BDT');
  });

  it('handles a negative amount', () => {
    expect(formatPoisha(-bdt(12.05))).toBe('-12.05');
  });
});

describe('sumPoisha', () => {
  it('adds integers and rejects a float', () => {
    expect(sumPoisha([bdt(679.5), bdt(490), bdt(490)])).toBe(bdt(1659.5));
    expect(() => sumPoisha([1.5])).toThrow(/integer number of poisha/);
  });
});
