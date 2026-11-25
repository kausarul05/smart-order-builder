/**
 * Part C - the pricing engine.
 *
 * `priceCart` is pure and is the ONLY place a price is ever computed. The
 * mock server imports it for `/price` and for checkout, the tests import it
 * for TC-05..TC-07 and for ANSWERS.md, and the seed orders are priced with
 * it at their own `createdAt`. There is no second implementation to drift.
 *
 * The order of operations is fixed by the brief and is reflected one step
 * per block below:
 *   1  unit subtotal = base + sum(option price x units)
 *   2  P2 extras deal   (per unit)
 *   3  P1 combo         (per unit, 10% off the step-2 amount)
 *   4  line total, cart subtotal
 *   5  exactly one cart discount: max(C1, C2), tie -> C1
 *   6  VAT on the discounted subtotal, payable rounded to whole BDT
 */

import { formatBdt, percentOf, roundHalfUpToWholeBdt } from '../money';
import { groupUnits, indexOptions } from '../selection';
import { isStrictlyBefore } from '../time';
import type {
  DiscountCandidate,
  LinePrice,
  Menu,
  MenuGroup,
  Poisha,
  PriceBreakdown,
  PriceCartInput,
  Selection,
  UnitPrice,
} from '../types';

/* --------------------------------------------------------- steps 1 to 3 */

/** Steps 1-3 for a single unit of `selection`. */
export function priceUnit(selection: Selection, menu: Menu): UnitPrice {
  const index = indexOptions(menu.groups);

  // Step 1 - base price plus every selected option unit.
  let optionsTotal = 0;
  for (const [optionId, units] of Object.entries(selection)) {
    if (units <= 0) continue;
    const entry = index.get(optionId);
    if (!entry) continue;
    optionsTotal += entry.option.price * units;
  }
  const step1 = menu.basePrice + optionsTotal;

  // Step 2 - P2: for every `every` units in the deal group, the cheapest
  // unit is free. Units are expanded first (Cheese x2 is two units), so two
  // cheap units can both be free before one expensive one is.
  const extrasDealOff = extrasDealDiscount(selection, menu);
  const step2 = step1 - extrasDealOff;

  // Step 3 - P1: percentage off the step-2 amount when every threshold is
  // met. Thresholds count option units, the same measure the group limits
  // use (see the note on GroupLimits).
  const comboOff = comboQualifies(selection, menu)
    ? percentOf(step2, menu.promotions.combo.percent)
    : 0;

  return {
    base: menu.basePrice,
    optionsTotal,
    step1,
    extrasDealOff,
    step2,
    comboOff,
    unitPrice: step2 - comboOff,
  };
}

function findGroup(menu: Menu, groupId: string): MenuGroup | undefined {
  return menu.groups.find((group) => group.id === groupId);
}

/** P2 - the value of the free units inside the extras-deal group. */
export function extrasDealDiscount(selection: Selection, menu: Menu): Poisha {
  const { groupId, every } = menu.promotions.extrasDeal;
  if (every <= 0) return 0;
  const group = findGroup(menu, groupId);
  if (!group) return 0;

  // One entry per selected UNIT, so the "cheapest units" are picked
  // individually rather than per option.
  const unitPrices: Poisha[] = [];
  for (const option of group.options) {
    const units = selection[option.id] ?? 0;
    for (let i = 0; i < units; i += 1) unitPrices.push(option.price);
  }

  const freeCount = Math.floor(unitPrices.length / every);
  if (freeCount <= 0) return 0;

  unitPrices.sort((a, b) => a - b);
  let off = 0;
  for (let i = 0; i < freeCount; i += 1) off += unitPrices[i] ?? 0;
  return off;
}

/** P1 - does the selection meet every combo threshold? */
export function comboQualifies(selection: Selection, menu: Menu): boolean {
  return menu.promotions.combo.thresholds.every((threshold) => {
    const group = findGroup(menu, threshold.groupId);
    if (!group) return false;
    return groupUnits(selection, group) >= threshold.minUnits;
  });
}

/* ------------------------------------------------------------ steps 4-6 */

export function priceCart(input: PriceCartInput): PriceBreakdown {
  const { cart, menu, serverTime } = input;
  const entered = normaliseCoupon(input.couponCode ?? null);

  // Step 4 - lines and cart subtotal.
  const lines: LinePrice[] = cart.map((item) => {
    const unit = priceUnit(item.selection, menu);
    return { unit, qty: item.qty, lineTotal: unit.unitPrice * item.qty };
  });
  const subtotal = lines.reduce((total, line) => total + line.lineTotal, 0);

  // Step 5 - evaluate BOTH cart discounts, then apply exactly one.
  const candidates = cartDiscountCandidates(subtotal, entered, menu, serverTime);
  const discount = chooseDiscount(candidates);
  const annotated = candidates.map((candidate) =>
    candidate.eligible && candidate.id !== discount?.id
      ? {
          ...candidate,
          reason: `Not applied: ${formatBdt(candidate.amount)} is not more than the applied ${formatBdt(discount?.amount ?? 0)}`,
        }
      : candidate,
  );
  const discountedSubtotal = subtotal - (discount?.amount ?? 0);

  // Step 6 - VAT, then the only rounding to whole BDT in the whole engine.
  const vat = percentOf(discountedSubtotal, menu.promotions.vatPercent);
  const payable = roundHalfUpToWholeBdt(discountedSubtotal + vat);

  return {
    lines,
    subtotal,
    candidates: annotated,
    discount,
    discountedSubtotal,
    vat,
    payable,
  };
}

/** Both C1 and C2, each with its amount and the reason it is or is not eligible. */
export function cartDiscountCandidates(
  subtotal: Poisha,
  enteredCoupon: string | null,
  menu: Menu,
  serverTime: Date,
): readonly DiscountCandidate[] {
  const out: DiscountCandidate[] = [];
  const { cartThreshold, coupons } = menu.promotions;

  const thresholdMet = subtotal >= cartThreshold.minSubtotal;
  out.push({
    id: cartThreshold.id,
    kind: 'cartThreshold',
    code: null,
    amount: thresholdMet ? cartThreshold.amountOff : 0,
    eligible: thresholdMet,
    reason: thresholdMet
      ? null
      : `Subtotal must reach ${formatBdt(cartThreshold.minSubtotal)}`,
  });

  if (enteredCoupon !== null) {
    const coupon = coupons.find((item) => item.code === enteredCoupon);
    if (!coupon) {
      out.push({
        id: 'coupon-unknown',
        kind: 'coupon',
        code: enteredCoupon,
        amount: 0,
        eligible: false,
        reason: `Coupon "${enteredCoupon}" does not exist`,
      });
    } else {
      const inWindow = isStrictlyBefore(
        serverTime,
        coupon.validBefore,
        coupon.timeZone,
      );
      const uncapped = percentOf(subtotal, coupon.percent);
      out.push({
        id: coupon.id,
        kind: 'coupon',
        code: coupon.code,
        amount: inWindow ? Math.min(uncapped, coupon.cap) : 0,
        eligible: inWindow,
        reason: inWindow
          ? null
          : `${coupon.code} is only valid before ${coupon.validBefore} (${coupon.timeZone})`,
      });
    }
  }

  return out;
}

/**
 * Only one cart discount applies: the larger amount wins, and on a tie the
 * cart-threshold discount (C1) wins. `candidates` is already in C1-first
 * order, so a strict `>` comparison gives the tie to C1.
 */
export function chooseDiscount(
  candidates: readonly DiscountCandidate[],
): DiscountCandidate | null {
  let best: DiscountCandidate | null = null;
  for (const candidate of candidates) {
    if (!candidate.eligible || candidate.amount <= 0) continue;
    if (best === null || candidate.amount > best.amount) best = candidate;
  }
  return best;
}

function normaliseCoupon(code: string | null): string | null {
  if (code === null) return null;
  const trimmed = code.trim().toUpperCase();
  return trimmed.length === 0 ? null : trimmed;
}

/** The coupon the user typed, and what became of it - used by D6. */
export function couponOutcome(breakdown: PriceBreakdown, entered: string | null): {
  readonly entered: string | null;
  readonly applied: string | null;
  readonly rejectedReason: string | null;
} {
  const normalised = normaliseCoupon(entered);
  if (normalised === null) {
    return { entered: null, applied: null, rejectedReason: null };
  }
  const applied =
    breakdown.discount?.kind === 'coupon' ? breakdown.discount.code : null;
  if (applied !== null) {
    return { entered: normalised, applied, rejectedReason: null };
  }
  const couponCandidate = breakdown.candidates.find(
    (candidate) => candidate.kind === 'coupon',
  );
  return {
    entered: normalised,
    applied: null,
    rejectedReason: couponCandidate?.reason ?? 'Coupon was not applied',
  };
}
