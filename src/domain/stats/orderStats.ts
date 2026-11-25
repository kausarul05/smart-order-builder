/**
 * Part F - the numbers behind the sales assistant.
 *
 * These are the ONLY things that compute a figure for the chatbot. The
 * model never sees the orders and never adds anything up: it picks one of
 * these functions through Gemini function calling and phrases what comes
 * back. Each one is a pure function over the stored orders, so it is unit
 * tested against the seed data (C2) and its answers also fill ANSWERS.md
 * questions 5 to 8.
 */

import { isoDateIn } from '../time';
import { indexOptions } from '../selection';
import type {
  Menu,
  OptionId,
  PaymentMethod,
  Poisha,
  StoredOrder,
} from '../types';

export const STATS_TIME_ZONE = 'Asia/Dhaka';

/** How many orders exist. */
export function countOrders(orders: readonly StoredOrder[]): number {
  return orders.length;
}

/**
 * Total revenue = the sum of what customers actually pay, i.e. every
 * order's `payable` (after the discount, including VAT).
 */
export function totalRevenue(orders: readonly StoredOrder[]): Poisha {
  return orders.reduce((total, order) => total + order.totals.payable, 0);
}

/** Mean payable per order, rounded half-up to the poisha. 0 for no orders. */
export function averageOrderValue(orders: readonly StoredOrder[]): Poisha {
  if (orders.length === 0) return 0;
  const total = totalRevenue(orders);
  return Math.floor((total + Math.floor(orders.length / 2)) / orders.length);
}

export interface OptionUnits {
  readonly optionId: OptionId;
  readonly name: string;
  readonly units: number;
}

/**
 * Units sold per option, counted as line quantity x option quantity, so
 * two of item C each carrying Cheese x2 is four cheese units.
 */
export function optionUnitsSold(
  orders: readonly StoredOrder[],
  menu: Menu,
): readonly OptionUnits[] {
  const index = indexOptions(menu.groups);
  const totals = new Map<OptionId, number>();

  for (const order of orders) {
    for (const line of order.lines) {
      for (const [optionId, perUnit] of Object.entries(line.options)) {
        if (perUnit <= 0) continue;
        totals.set(optionId, (totals.get(optionId) ?? 0) + perUnit * line.qty);
      }
    }
  }

  return [...totals.entries()]
    .map(([optionId, units]) => ({
      optionId,
      name: index.get(optionId)?.option.name ?? optionId,
      units,
    }))
    .sort((a, b) => b.units - a.units || a.optionId.localeCompare(b.optionId));
}

/** The single best-selling option by units, or null for no orders. */
export function bestSellingOption(
  orders: readonly StoredOrder[],
  menu: Menu,
): OptionUnits | null {
  return optionUnitsSold(orders, menu)[0] ?? null;
}

/** Revenue per payment method. Methods with no orders are omitted. */
export function revenueByPaymentMethod(
  orders: readonly StoredOrder[],
): Readonly<Partial<Record<PaymentMethod, Poisha>>> {
  const out: Partial<Record<PaymentMethod, Poisha>> = {};
  for (const order of orders) {
    out[order.paymentMethod] =
      (out[order.paymentMethod] ?? 0) + order.totals.payable;
  }
  return out;
}

/** The method that brought in the most revenue (ANSWERS Q7). */
export function topPaymentMethod(
  orders: readonly StoredOrder[],
): { readonly method: PaymentMethod; readonly revenue: Poisha } | null {
  const byMethod = revenueByPaymentMethod(orders);
  let best: { method: PaymentMethod; revenue: Poisha } | null = null;
  for (const [method, revenue] of Object.entries(byMethod)) {
    if (revenue === undefined) continue;
    if (best === null || revenue > best.revenue) {
      best = { method: method as PaymentMethod, revenue };
    }
  }
  return best;
}

/**
 * Orders that ACTUALLY received a coupon discount - not merely orders that
 * carry a code. The difference is the whole point of ANSWERS Q8 and of the
 * `entered` / `applied` split in the stored shape (D6).
 */
export function ordersWithCouponApplied(
  orders: readonly StoredOrder[],
): readonly StoredOrder[] {
  return orders.filter((order) => order.coupon.applied !== null);
}

/** Orders that carry a code which did NOT turn into a discount, with why. */
export function ordersWithCouponRejected(
  orders: readonly StoredOrder[],
): readonly { readonly order: StoredOrder; readonly reason: string }[] {
  return orders
    .filter(
      (order) => order.coupon.entered !== null && order.coupon.applied === null,
    )
    .map((order) => ({
      order,
      reason: order.coupon.rejectedReason ?? 'Coupon was not applied',
    }));
}

/** Orders placed on a calendar date in Asia/Dhaka, as "YYYY-MM-DD". */
export function ordersOnDate(
  orders: readonly StoredOrder[],
  isoDate: string,
): readonly StoredOrder[] {
  return orders.filter(
    (order) => isoDateIn(new Date(order.createdAt), STATS_TIME_ZONE) === isoDate,
  );
}

/** Every date that has at least one order, ascending - used to say "no data". */
export function datesWithOrders(
  orders: readonly StoredOrder[],
): readonly string[] {
  const dates = new Set(
    orders.map((order) => isoDateIn(new Date(order.createdAt), STATS_TIME_ZONE)),
  );
  return [...dates].sort();
}
