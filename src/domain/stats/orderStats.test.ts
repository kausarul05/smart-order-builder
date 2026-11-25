/**
 * C2 asks for the stats functions to be unit tested against the seed data.
 * These are the same figures ANSWERS.md Q5-Q8 report, so a change that
 * would move an answer fails here too.
 */

import { describe, expect, it } from 'vitest';

import { bdt } from '../money';
import { DEFAULT_MENU } from '@/fixtures/menu.default';
import { priceSeedOrders } from '@/server/state';
import type { SeedOrdersFile } from '../types';
import seedJson from '../../../public/orders.seed.json';
import {
  averageOrderValue,
  bestSellingOption,
  countOrders,
  datesWithOrders,
  optionUnitsSold,
  ordersOnDate,
  ordersWithCouponApplied,
  ordersWithCouponRejected,
  revenueByPaymentMethod,
  topPaymentMethod,
  totalRevenue,
} from './orderStats';

const seed = seedJson as unknown as SeedOrdersFile;
const orders = priceSeedOrders(seed, DEFAULT_MENU);

describe('countOrders', () => {
  it('counts the six seed orders', () => {
    expect(countOrders(orders)).toBe(6);
  });

  it('is 0 for an empty store', () => {
    expect(countOrders([])).toBe(0);
  });
});

describe('totalRevenue', () => {
  it('sums every payable to 4,995 BDT', () => {
    expect(totalRevenue(orders)).toBe(bdt(4995));
  });

  it('matches the sum of the individual payables', () => {
    const byHand = orders.reduce((total, order) => total + order.totals.payable, 0);
    expect(totalRevenue(orders)).toBe(byHand);
  });

  it('is 0 for an empty store', () => {
    expect(totalRevenue([])).toBe(0);
  });
});

describe('averageOrderValue', () => {
  it('is 832.50 BDT across the six seed orders', () => {
    expect(averageOrderValue(orders)).toBe(bdt(832.5));
  });

  it('is 0 rather than NaN for an empty store', () => {
    expect(averageOrderValue([])).toBe(0);
  });
});

describe('optionUnitsSold / bestSellingOption', () => {
  it('counts line quantity multiplied by option quantity', () => {
    const ranked = optionUnitsSold(orders, DEFAULT_MENU);
    const byId = new Map(ranked.map((entry) => [entry.optionId, entry.units]));

    // ORD-1003 has Fried x2 on a line of qty 2 (4), ORD-1006 has 2 + 2,
    // ORD-1002 has 2. Total 10.
    expect(byId.get('fried')).toBe(10);
    // Paratha: 1 per unit on a qty-2 line in ORD-1003, and again in
    // ORD-1005, so 4.
    expect(byId.get('paratha')).toBe(4);
    // Cheese: 2 per unit on a qty-2 line (4) plus 2 in ORD-1006.
    expect(byId.get('cheese')).toBe(6);
  });

  it('names Fried as the best seller with 10 units', () => {
    const best = bestSellingOption(orders, DEFAULT_MENU);
    expect(best?.optionId).toBe('fried');
    expect(best?.name).toBe('Fried');
    expect(best?.units).toBe(10);
  });

  it('is sorted by units, descending', () => {
    const ranked = optionUnitsSold(orders, DEFAULT_MENU);
    for (let i = 1; i < ranked.length; i += 1) {
      expect(ranked[i - 1]!.units).toBeGreaterThanOrEqual(ranked[i]!.units);
    }
  });

  it('is null for an empty store rather than a made-up answer', () => {
    expect(bestSellingOption([], DEFAULT_MENU)).toBeNull();
  });
});

describe('revenueByPaymentMethod / topPaymentMethod', () => {
  it('splits revenue across the three methods', () => {
    const byMethod = revenueByPaymentMethod(orders);
    expect(byMethod.card).toBe(bdt(2145));
    expect(byMethod.bkash).toBe(bdt(1579));
    expect(byMethod.cash).toBe(bdt(1271));
  });

  it('adds back up to the total revenue', () => {
    const byMethod = revenueByPaymentMethod(orders);
    const sum = Object.values(byMethod).reduce(
      (total, amount) => total + (amount ?? 0),
      0,
    );
    expect(sum).toBe(totalRevenue(orders));
  });

  it('names card as the top method', () => {
    expect(topPaymentMethod(orders)).toEqual({
      method: 'card',
      revenue: bdt(2145),
    });
  });

  it('is null for an empty store', () => {
    expect(topPaymentMethod([])).toBeNull();
  });
});

describe('coupon usage', () => {
  it('finds the three orders that actually received the discount', () => {
    const applied = ordersWithCouponApplied(orders);
    expect(applied.map((order) => order.id)).toEqual([
      'ORD-1001',
      'ORD-1003',
      'ORD-1005',
    ]);
  });

  it('separates the order that carried a code but got nothing', () => {
    const rejected = ordersWithCouponRejected(orders);
    expect(rejected).toHaveLength(1);
    expect(rejected[0]?.order.id).toBe('ORD-1006');
    expect(rejected[0]?.reason).toBe(
      'MORNING15 is only valid before 11:00 (Asia/Dhaka)',
    );
  });

  it('keeps "carries a code" and "got the discount" as different questions', () => {
    const withCode = orders.filter((order) => order.coupon.entered !== null);
    expect(withCode).toHaveLength(4);
    expect(ordersWithCouponApplied(orders)).toHaveLength(3);
  });
});

describe('ordersOnDate / datesWithOrders', () => {
  it('groups by the Asia/Dhaka calendar date', () => {
    expect(ordersOnDate(orders, '2026-11-20').map((order) => order.id)).toEqual([
      'ORD-1001',
      'ORD-1002',
    ]);
    expect(ordersOnDate(orders, '2026-11-21')).toHaveLength(2);
    expect(ordersOnDate(orders, '2026-11-22')).toHaveLength(2);
  });

  it('does not slip the 19:30 order into the next day', () => {
    // 19:30 in Dhaka is 13:30 UTC; a naive UTC date would still be the 21st,
    // but a naive LOCAL date on a western host would not be.
    expect(ordersOnDate(orders, '2026-11-21').map((order) => order.id)).toContain(
      'ORD-1004',
    );
  });

  it('returns nothing for a date with no orders', () => {
    expect(ordersOnDate(orders, '2026-01-01')).toEqual([]);
  });

  it('lists every date that has an order, ascending', () => {
    expect(datesWithOrders(orders)).toEqual([
      '2026-11-20',
      '2026-11-21',
      '2026-11-22',
    ]);
  });
});
