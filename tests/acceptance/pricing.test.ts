/**
 * TC-05 .. TC-07 - Part C, the pricing engine.
 * Every expected figure is taken verbatim from Section 9 of the brief.
 */

import { describe, expect, it } from 'vitest';

import { bdt, formatPoisha } from '@/domain/money';
import { priceCart, priceUnit } from '@/domain/pricing/priceCart';
import { DEFAULT_MENU } from '@/fixtures/menu.default';
import {
  AT_1059,
  AT_1100,
  SELECTION_A,
  SELECTION_B,
  SELECTION_C,
} from '../fixtures/configs';

const menu = DEFAULT_MENU;

describe('TC-05 - unit price of A, B and C', () => {
  it('A = 380.00 BDT', () => {
    expect(priceUnit(SELECTION_A, menu).unitPrice).toBe(bdt(380));
  });

  it('B = 679.50 BDT', () => {
    expect(priceUnit(SELECTION_B, menu).unitPrice).toBe(bdt(679.5));
  });

  it('C = 490.00 BDT', () => {
    expect(priceUnit(SELECTION_C, menu).unitPrice).toBe(bdt(490));
  });

  it('B gets the combo but not the extras deal', () => {
    const unit = priceUnit(SELECTION_B, menu);
    expect(unit.step1).toBe(bdt(755));
    expect(unit.extrasDealOff).toBe(0); // 2 extra units, 2 < 3
    expect(unit.comboOff).toBe(bdt(75.5)); // 10% of 755.00
  });

  it('C gets the extras deal but not the combo', () => {
    const unit = priceUnit(SELECTION_C, menu);
    expect(unit.step1).toBe(bdt(515));
    // 4 extra units -> 1 free, and the cheapest unit is Baked Beans at 25.
    expect(unit.extrasDealOff).toBe(bdt(25));
    expect(unit.comboOff).toBe(0); // 2 egg units and 1 protein unit
  });

  it('A gets neither', () => {
    const unit = priceUnit(SELECTION_A, menu);
    expect(unit.extrasDealOff).toBe(0);
    expect(unit.comboOff).toBe(0);
  });
});

describe('TC-06 - cart B x1 + C x2 at server time 10:59:59', () => {
  const breakdown = priceCart({
    cart: [
      { selection: SELECTION_B, qty: 1 },
      { selection: SELECTION_C, qty: 2 },
    ],
    menu,
    couponCode: 'MORNING15',
    serverTime: AT_1059,
  });

  it('subtotal is 1,659.50', () => {
    expect(breakdown.subtotal).toBe(bdt(1659.5));
    expect(formatPoisha(breakdown.subtotal)).toBe('1,659.50');
  });

  it('C2 = 150.00 wins over C1 = 100.00', () => {
    expect(breakdown.discount?.id).toBe('C2');
    expect(breakdown.discount?.amount).toBe(bdt(150));
    const c1 = breakdown.candidates.find((candidate) => candidate.id === 'C1');
    expect(c1?.amount).toBe(bdt(100));
  });

  it('the coupon is capped at 150.00 rather than 15% of 1,659.50', () => {
    // 15% of 1,659.50 = 248.93 before the cap.
    expect(breakdown.discount?.amount).toBeLessThan(bdt(248.93));
  });

  it('VAT is 75.48', () => {
    expect(breakdown.discountedSubtotal).toBe(bdt(1509.5));
    expect(breakdown.vat).toBe(bdt(75.48));
  });

  it('payable is 1,585', () => {
    expect(breakdown.payable).toBe(bdt(1585));
  });
});

describe('TC-07 - same cart at 11:00:00, coupon entered', () => {
  const breakdown = priceCart({
    cart: [
      { selection: SELECTION_B, qty: 1 },
      { selection: SELECTION_C, qty: 2 },
    ],
    menu,
    couponCode: 'MORNING15',
    serverTime: AT_1100,
  });

  it('rejects the coupon at exactly 11:00:00', () => {
    const coupon = breakdown.candidates.find(
      (candidate) => candidate.kind === 'coupon',
    );
    expect(coupon?.eligible).toBe(false);
    expect(coupon?.reason).toBe(
      'MORNING15 is only valid before 11:00 (Asia/Dhaka)',
    );
  });

  it('falls back to C1 = 100.00', () => {
    expect(breakdown.discount?.id).toBe('C1');
    expect(breakdown.discount?.amount).toBe(bdt(100));
  });

  it('VAT is 77.98 and payable is 1,637', () => {
    expect(breakdown.vat).toBe(bdt(77.98));
    expect(breakdown.payable).toBe(bdt(1637));
  });
});

describe('cart discount selection rules', () => {
  it('applies no discount under the threshold and outside the coupon window', () => {
    const breakdown = priceCart({
      cart: [{ selection: SELECTION_A, qty: 1 }],
      menu,
      couponCode: 'MORNING15',
      serverTime: AT_1100,
    });
    expect(breakdown.discount).toBeNull();
    expect(breakdown.subtotal).toBe(bdt(380));
  });

  it('applies the coupon alone when the subtotal is under 1,200', () => {
    const breakdown = priceCart({
      cart: [{ selection: SELECTION_A, qty: 1 }],
      menu,
      couponCode: 'MORNING15',
      serverTime: AT_1059,
    });
    expect(breakdown.discount?.id).toBe('C2');
    expect(breakdown.discount?.amount).toBe(bdt(57)); // 15% of 380.00
  });

  it('rejects an unknown coupon code without touching C1', () => {
    const breakdown = priceCart({
      cart: [{ selection: SELECTION_B, qty: 3 }],
      menu,
      couponCode: 'NOPE',
      serverTime: AT_1059,
    });
    expect(breakdown.discount?.id).toBe('C1');
    const coupon = breakdown.candidates.find(
      (candidate) => candidate.kind === 'coupon',
    );
    expect(coupon?.reason).toBe('Coupon "NOPE" does not exist');
  });

  it('never applies two discounts at once', () => {
    const breakdown = priceCart({
      cart: [
        { selection: SELECTION_B, qty: 1 },
        { selection: SELECTION_C, qty: 2 },
      ],
      menu,
      couponCode: 'MORNING15',
      serverTime: AT_1059,
    });
    const applied = breakdown.candidates.filter(
      (candidate) => candidate.id === breakdown.discount?.id,
    );
    expect(applied).toHaveLength(1);
    expect(breakdown.subtotal - breakdown.discountedSubtotal).toBe(
      breakdown.discount?.amount,
    );
  });
});

describe('the engine stays integer-only', () => {
  it('every amount in a breakdown is a whole number of poisha', () => {
    const breakdown = priceCart({
      cart: [
        { selection: SELECTION_B, qty: 1 },
        { selection: SELECTION_C, qty: 2 },
      ],
      menu,
      couponCode: 'MORNING15',
      serverTime: AT_1059,
    });
    const amounts = [
      breakdown.subtotal,
      breakdown.discountedSubtotal,
      breakdown.vat,
      breakdown.payable,
      ...breakdown.lines.flatMap((line) => [
        line.lineTotal,
        line.unit.step1,
        line.unit.step2,
        line.unit.unitPrice,
      ]),
    ];
    for (const amount of amounts) expect(Number.isInteger(amount)).toBe(true);
  });

  it('payable is always a whole number of BDT', () => {
    const breakdown = priceCart({
      cart: [{ selection: SELECTION_C, qty: 3 }],
      menu,
      serverTime: AT_1059,
    });
    expect(breakdown.payable % 100).toBe(0);
  });
});
