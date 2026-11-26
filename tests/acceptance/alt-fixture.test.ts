/**
 * Section 2: "We may run your app against a different menu fixture; it
 * must keep working without code changes."
 *
 * This runs every engine - rules, stock, pricing, reservations, checkout
 * and the assistant's stats - against `menu.alt.ts`, which shares nothing
 * with Appendix A: different product, group ids, option ids, ingredient
 * ids, limits, step, rule ids, promotion values, coupon code, coupon
 * window, VAT rate and quantity range.
 *
 * Any id learned from the default fixture would fail here.
 */

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { bdt } from '@/domain/money';
import { priceCart, priceUnit } from '@/domain/pricing/priceCart';
import { validate } from '@/domain/rules/validate';
import { checkChange, lineAllocation, stockHeadroom } from '@/domain/stock/availability';
import { availableMap } from '@/domain/stock/ingredients';
import { bestSellingOption, totalRevenue } from '@/domain/stats/orderStats';
import { reserveItem } from '@/server/cart';
import { manualClock, resetServerClock, setServerClock } from '@/server/clock';
import { checkout, listOrders } from '@/server/orders';
import { getState, resetState, snapshot } from '@/server/state';
import { ALT_MENU, ALT_STOCK } from '@/fixtures/menu.alt';
import type { Selection, StockSnapshot } from '@/domain/types';

/** Full plate x3 (6 rice), Prawn x2, Chutney - valid under the alt rules. */
const ALT_A: Selection = { full: 3, prawn: 2, chutney: 1 };

const config = (selection: Selection) => ({
  productId: ALT_MENU.productId,
  selection,
});

const run = (selection: Selection) =>
  validate(config(selection), ALT_MENU.groups, ALT_MENU.rules);

beforeEach(() => {
  resetState(ALT_MENU);
  // The alt fixture carries its own stock, which resetState does not know.
  getState().onHand = { ...ALT_STOCK };
  setServerClock(manualClock(new Date('2026-11-25T12:00:00+06:00')));
});

afterEach(() => {
  resetServerClock();
  resetState();
});

describe('the rules engine on a different fixture', () => {
  it('accepts a configuration valid under the alt limits', () => {
    expect(run(ALT_A)).toEqual([]);
  });

  it('enforces the alt step of 3, not the default step of 2', () => {
    const violations = run({ full: 2, prawn: 1 });
    const step = violations.find((violation) => violation.code === 'step');
    expect(step?.message).toBe('Portion total must be 3-9 in steps of 3 (you have 2)');
  });

  it('enforces an alt requires rule', () => {
    const violations = run({ half: 3, chickpea: 1, raita: 1 });
    const requires = violations.find((violation) => violation.code === 'requires');
    expect(requires?.scope).toEqual({ kind: 'rule', ruleId: 'A1' });
    expect(requires?.message).toBe('Raita requires Full plate');
  });

  it('enforces an alt excludes rule', () => {
    const violations = run({ full: 3, prawn: 1, chickpea: 1 });
    const excludes = violations.find((violation) => violation.code === 'excludes');
    expect(excludes?.scope).toEqual({ kind: 'rule', ruleId: 'A2' });
  });

  it('lets an alt overrideLimit beat the base limit', () => {
    // Side allows 3, but Prawn overrides it to 1.
    expect(run({ full: 3, chickpea: 1, salad: 1, chutney: 1 })).toEqual([]);
    const violations = run({ full: 3, prawn: 1, salad: 1, chutney: 1 });
    const max = violations.find((violation) => violation.code === 'max');
    expect(max?.viaOverride).toBe('A3');
    expect(max?.message).toBe('Side max is 1 when Prawn is selected (you have 2)');
  });
});

describe('the pricing engine on a different fixture', () => {
  it('prices a unit with the alt base, deal and combo', () => {
    // base 180 + Full x3 (120) + Prawn x2 (240) + Chutney 15 = 555.00
    // Side has 1 unit, so the every-3 deal does not fire.
    // Portion 3 units is under the combo's 6, so no combo either.
    expect(priceUnit(ALT_A, ALT_MENU).unitPrice).toBe(bdt(555));
  });

  it('fires the alt every-3 side deal on the cheapest side unit', () => {
    const withSides: Selection = { full: 3, chickpea: 1, raita: 1, salad: 1, chutney: 1 };
    const unit = priceUnit(withSides, ALT_MENU);
    // 3 side units -> one free, and Chutney at 15.00 is the cheapest.
    expect(unit.extrasDealOff).toBe(bdt(15));
  });

  it('fires the alt 20% combo at its own thresholds', () => {
    const big: Selection = { full: 6, prawn: 2 };
    const unit = priceUnit(big, ALT_MENU);
    // base 180 + Full x6 (240) + Prawn x2 (240) = 660.00, less 20%.
    expect(unit.step2).toBe(bdt(660));
    expect(unit.comboOff).toBe(bdt(132));
    expect(unit.unitPrice).toBe(bdt(528));
  });

  it('uses the alt coupon code, window and VAT rate', () => {
    const atNoon = new Date('2026-11-25T12:00:00+06:00');
    const breakdown = priceCart({
      cart: [{ selection: ALT_A, qty: 2 }],
      menu: ALT_MENU,
      couponCode: 'LUNCH20',
      serverTime: atNoon,
    });

    expect(breakdown.subtotal).toBe(bdt(1110));
    // 20% of 1,110.00 = 222.00, capped at 200.00, which beats ALT-C1's 75.
    expect(breakdown.discount?.id).toBe('ALT-C2');
    expect(breakdown.discount?.amount).toBe(bdt(200));
    // VAT is 10% here, not 5%.
    expect(breakdown.vat).toBe(bdt(91));
    expect(breakdown.payable).toBe(bdt(1001));
  });

  it('rejects the alt coupon outside its own 15:00 window', () => {
    const breakdown = priceCart({
      cart: [{ selection: ALT_A, qty: 2 }],
      menu: ALT_MENU,
      couponCode: 'LUNCH20',
      serverTime: new Date('2026-11-25T15:00:00+06:00'),
    });
    expect(breakdown.discount?.id).toBe('ALT-C1');
    const coupon = breakdown.candidates.find((c) => c.kind === 'coupon');
    expect(coupon?.reason).toBe('LUNCH20 is only valid before 15:00 (Asia/Dhaka)');
  });

  it('rejects the DEFAULT fixture coupon, which does not exist here', () => {
    const breakdown = priceCart({
      cart: [{ selection: ALT_A, qty: 1 }],
      menu: ALT_MENU,
      couponCode: 'MORNING15',
      serverTime: new Date('2026-11-25T09:00:00+06:00'),
    });
    const coupon = breakdown.candidates.find((c) => c.kind === 'coupon');
    expect(coupon?.reason).toBe('Coupon "MORNING15" does not exist');
  });
});

describe('the stock engine on a different fixture', () => {
  it('computes headroom from the alt ingredients', () => {
    const empty: StockSnapshot = { onHand: ALT_STOCK, reserved: {}, sold: {} };
    const available = availableMap(empty, ALT_MENU.ingredients);

    const full = ALT_MENU.groups[0]?.options.find((option) => option.id === 'full');
    // Full plate uses 2 rice and there are 9, so four more fit.
    expect(stockHeadroom(full!, available, 1)).toBe(4);

    const chutney = ALT_MENU.groups[2]?.options.find((option) => option.id === 'chutney');
    // Mint is declared unlimited in this fixture.
    expect(stockHeadroom(chutney!, available, 1)).toBe(Number.POSITIVE_INFINITY);
  });

  it('names the alt ingredients in a shortage, in fixture order', () => {
    const empty: StockSnapshot = { onHand: ALT_STOCK, reserved: {}, sold: {} };
    const available = availableMap(empty, ALT_MENU.ingredients);

    // Full x6 + Chickpea x4 + Raita x3, twice over: 24 rice against 9,
    // 8 chickpea against 6 and 6 yoghurt against 3.
    const result = checkChange({
      current: {},
      next: lineAllocation({ full: 6, chickpea: 4, raita: 3 }, ALT_MENU.groups, 2),
      available,
      ingredients: ALT_MENU.ingredients,
    });

    expect(result.ok).toBe(false);
    // Reported in the fixture's own ingredient order, not alphabetically.
    expect(result.shortages.map((shortage) => shortage.name)).toEqual([
      'rice',
      'chickpea',
      'yoghurt',
    ]);
    expect(result.shortages.map((shortage) => shortage.missing)).toEqual([15, 2, 3]);
  });
});

describe('the mock server on a different fixture', () => {
  it('reserves, holds stock and checks out', () => {
    const added = reserveItem({ selection: ALT_A, qty: 1, idempotencyKey: 'alt' });
    expect(added.ok).toBe(true);
    expect(added.ok && added.item.unitPrice).toBe(bdt(555));

    // Full x3 is 6 rice of 9, Prawn x2 is 2 of 4.
    const available = availableMap(snapshot(), ALT_MENU.ingredients);
    expect(available.rice).toBe(3);
    expect(available.prawn).toBe(2);

    const paid = checkout({ paymentMethod: 'cash', idempotencyKey: 'alt-pay' });
    expect(paid.ok).toBe(true);
    expect(paid.ok && paid.order.menuVersion).toBe('alt-biryani-1');
    expect(getState().sold.rice).toBe(6);
  });

  it('enforces the alt quantity range of 1 to 2', () => {
    const tooMany = reserveItem({ selection: ALT_A, qty: 3, idempotencyKey: 'q3' });
    expect(tooMany.ok).toBe(false);
    expect(!tooMany.ok && tooMany.message).toMatch(/1 to 2/);
  });

  it('feeds the assistant stats from the alt menu', () => {
    reserveItem({ selection: ALT_A, qty: 1, idempotencyKey: 'a' });
    checkout({ paymentMethod: 'card', idempotencyKey: 'a-pay' });

    const orders = listOrders();
    expect(totalRevenue(orders)).toBeGreaterThan(0);

    const best = bestSellingOption(orders, ALT_MENU);
    // Full plate x3 is the most units on the only order.
    expect(best?.optionId).toBe('full');
    expect(best?.name).toBe('Full plate');
    expect(best?.units).toBe(3);
  });
});
