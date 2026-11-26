/**
 * Domain types. Pure data only - nothing in `src/domain` may import React,
 * MSW or anything from `src/features`. The engines here are shared by the
 * mock server and the tests, exactly as Part C requires.
 *
 * MONEY: every amount in this file is an integer number of poisha
 * (1 BDT = 100 poisha). There are no floats anywhere in the money path.
 */

export type Poisha = number;

export type OptionId = string;
export type GroupId = string;
export type IngredientId = string;
export type RuleId = string;

/* ------------------------------------------------------------------ menu */

/** Ingredient units consumed, keyed by ingredient id. */
export type Usage = Readonly<Record<IngredientId, number>>;

export interface MenuOption {
  readonly id: OptionId;
  readonly name: string;
  /** Price of ONE unit of this option, in poisha. */
  readonly price: Poisha;
  /** Ingredients consumed by ONE unit of this option. */
  readonly uses: Usage;
  /**
   * Illustration for the POS tile. Served from the menu like every other
   * field, so a different fixture can point at its own artwork - or at
   * photographs - without a code change. Missing is fine: the tile falls
   * back to the option's initials.
   */
  readonly image?: string;
}

/**
 * Limits are counted in OPTION UNITS selected inside the group, never in
 * ingredient units. TC-01 and TC-09 together prove this: Scrambled x3 is
 * 3 units and breaks `step: 2`, while Omelette x3 + Fried x1 is 4 units
 * (7 eggs) and is rejected only for stock, not for the step.
 */
export interface GroupLimits {
  /** Minimum total units in the group. */
  readonly min?: number;
  /** Maximum total units in the group. */
  readonly max?: number;
  /** Total units must be a multiple of this. */
  readonly step?: number;
  /** Maximum number of DISTINCT options selected in the group. */
  readonly maxDistinct?: number;
  /** Maximum units of any single option in the group. */
  readonly maxPerOption?: number;
}

export interface MenuGroup {
  readonly id: GroupId;
  readonly name: string;
  readonly limits: GroupLimits;
  readonly options: readonly MenuOption[];
  /**
   * Name of the sidebar glyph. Presentation, but it travels with the menu
   * so a different fixture names its own; an unknown name falls back to a
   * generic dish rather than to nothing.
   */
  readonly icon?: string;
  /** Sidebar section heading this group sits under. */
  readonly section?: string;
}

export type Rule =
  | {
      readonly id: RuleId;
      readonly type: 'requires';
      /** The option that imposes the requirement. */
      readonly option: OptionId;
      /** At least one of these must also be selected. */
      readonly anyOf: readonly OptionId[];
    }
  | {
      readonly id: RuleId;
      readonly type: 'excludes';
      readonly option: OptionId;
      /** None of these may be selected together with `option`. */
      readonly noneOf: readonly OptionId[];
    }
  | {
      readonly id: RuleId;
      readonly type: 'overrideLimit';
      /** When this option is selected... */
      readonly option: OptionId;
      /** ...this group uses these limits instead of its base limits. */
      readonly group: GroupId;
      readonly limits: GroupLimits;
    };

export interface Ingredient {
  readonly id: IngredientId;
  /** Singular, lower-case - used verbatim in "Short: 2 egg, 2 cheese". */
  readonly name: string;
  /** Ketchup and Chili have no stock at all. */
  readonly unlimited?: boolean;
}

/**
 * Promotion parameters are data, not code (Section 2: everything in
 * Appendix A must come from the mock API, promotions included).
 */
export interface Promotions {
  /** P2: inside `groupId`, every `every` units makes the cheapest unit free. */
  readonly extrasDeal: {
    readonly id: string;
    readonly groupId: GroupId;
    readonly every: number;
  };
  /**
   * P1: percentage off the step-2 amount when every threshold is met.
   *
   * A threshold counts EITHER option units in a group, or units of an
   * ingredient. The brief writes "eggs >= 4 AND protein >= 2" without
   * saying which, and no acceptance test distinguishes them - see
   * `tests/acceptance/combo-measure.test.ts`. Making it a fixture choice
   * means the reading is declared rather than buried in the engine.
   */
  readonly combo: {
    readonly id: string;
    readonly percent: number;
    readonly thresholds: readonly ComboThreshold[];
  };
  /** C1: flat amount off when the cart subtotal reaches a threshold. */
  readonly cartThreshold: {
    readonly id: string;
    readonly minSubtotal: Poisha;
    readonly amountOff: Poisha;
  };
  /** C2: coupon codes. */
  readonly coupons: readonly {
    readonly id: string;
    readonly code: string;
    readonly percent: number;
    readonly cap: Poisha;
    /** Valid only while server-local time is STRICTLY before this "HH:mm". */
    readonly validBefore: string;
    readonly timeZone: string;
  }[];
  readonly vatPercent: number;
}

export type ComboThreshold =
  | { readonly groupId: GroupId; readonly minUnits: number }
  | { readonly ingredientId: IngredientId; readonly minUnits: number };

export interface Menu {
  readonly version: string;
  readonly productId: string;
  readonly productName: string;
  readonly basePrice: Poisha;
  readonly groups: readonly MenuGroup[];
  readonly rules: readonly Rule[];
  /** Declaration order decides the order of shortage messages. */
  readonly ingredients: readonly Ingredient[];
  readonly promotions: Promotions;
  /** Allowed cart item quantities, e.g. 1..3. */
  readonly itemQty: { readonly min: number; readonly max: number };
}

/* --------------------------------------------------------- configuration */

/** Units per option. An option with 0 units must not appear. */
export type Selection = Readonly<Record<OptionId, number>>;

export interface Configuration {
  readonly productId: string;
  readonly selection: Selection;
}

/* ----------------------------------------------------------- validation */

export type ViolationCode =
  | 'min'
  | 'max'
  | 'step'
  | 'maxDistinct'
  | 'maxPerOption'
  | 'requires'
  | 'excludes'
  | 'unknownOption';

export type ViolationScope =
  | { readonly kind: 'group'; readonly groupId: GroupId }
  | { readonly kind: 'rule'; readonly ruleId: RuleId };

export interface Violation {
  readonly scope: ViolationScope;
  readonly code: ViolationCode;
  readonly message: string;
  /** Set when an overrideLimit rule supplied the limit that was broken. */
  readonly viaOverride?: RuleId;
}

/* -------------------------------------------------------------- pricing */

export interface UnitPrice {
  readonly base: Poisha;
  readonly optionsTotal: Poisha;
  /** Step 1: base + sum(option price x units). */
  readonly step1: Poisha;
  /** Step 2 (P2): amount made free by the extras deal. */
  readonly extrasDealOff: Poisha;
  readonly step2: Poisha;
  /** Step 3 (P1): combo percentage off the step-2 amount. */
  readonly comboOff: Poisha;
  /** Final per-unit price. */
  readonly unitPrice: Poisha;
  /**
   * True when `unitPrice` came from the price locked at Add to Cart (D2)
   * rather than from the steps above. The steps are still reported, so the
   * UI can show what the same configuration would cost today.
   */
  readonly locked: boolean;
}

export interface LinePrice {
  readonly unit: UnitPrice;
  readonly qty: number;
  readonly lineTotal: Poisha;
}

export interface DiscountCandidate {
  readonly id: string;
  readonly kind: 'cartThreshold' | 'coupon';
  readonly code: string | null;
  readonly amount: Poisha;
  readonly eligible: boolean;
  /** Why it was not applied, for the UI and for D6. */
  readonly reason: string | null;
}

export interface PriceBreakdown {
  readonly lines: readonly LinePrice[];
  readonly subtotal: Poisha;
  /** Both C1 and C2 are always evaluated so the UI can explain the choice. */
  readonly candidates: readonly DiscountCandidate[];
  readonly discount: DiscountCandidate | null;
  readonly discountedSubtotal: Poisha;
  readonly vat: Poisha;
  /** Half-up to whole BDT, stored as poisha (always a multiple of 100). */
  readonly payable: Poisha;
}

export interface PriceCartLine {
  readonly selection: Selection;
  readonly qty: number;
  /**
   * The unit price locked when the item entered the cart (D2). When it is
   * given, the engine uses it instead of re-pricing the configuration, so
   * a later menu change cannot move the price of an item already in the
   * cart. Cart-level discounts and VAT are still recomputed.
   */
  readonly lockedUnitPrice?: Poisha;
}

export interface PriceCartInput {
  readonly cart: readonly PriceCartLine[];
  readonly menu: Menu;
  /** Coupon the user typed. Kept even when rejected (D6). */
  readonly couponCode?: string | null;
  /** Server time, never Date.now(). */
  readonly serverTime: Date;
}

/* ---------------------------------------------------------------- stock */

export interface StockSnapshot {
  readonly onHand: Readonly<Record<IngredientId, number>>;
  readonly reserved: Readonly<Record<IngredientId, number>>;
  readonly sold: Readonly<Record<IngredientId, number>>;
}

export interface Shortage {
  readonly ingredientId: IngredientId;
  readonly name: string;
  readonly missing: number;
}

/* ----------------------------------------------------------------- cart */

export type CartItemStatus = 'active' | 'expired';

export interface CartItem {
  readonly id: string;
  readonly productId: string;
  readonly selection: Selection;
  readonly qty: number;
  /** Unit price locked when the item entered the cart (D2). */
  readonly unitPrice: Poisha;
  readonly pricedAt: string;
  readonly reservationId: string;
  /** ISO timestamp on the SERVER clock. */
  readonly expiresAt: string;
  readonly status: CartItemStatus;
  /** Optimistic-concurrency token (Part G). */
  readonly version: number;
}

/* --------------------------------------------------------------- orders */

export type PaymentMethod = 'card' | 'bkash' | 'cash';

/** The payment method is a label only; no payment data is ever collected. */
export const PAYMENT_METHODS: readonly PaymentMethod[] = ['card', 'bkash', 'cash'];

export interface OrderLine {
  readonly qty: number;
  readonly options: Selection;
  readonly unitPrice: Poisha;
  readonly lineTotal: Poisha;
}

/**
 * Stored order shape (D6). The money unit is declared in the envelope so a
 * reader never has to guess, and a coupon that was ENTERED but not applied
 * is kept together with the reason it lost.
 */
export interface StoredOrder {
  readonly id: string;
  /** ISO 8601 with the +06:00 offset, from the server clock (D4). */
  readonly createdAt: string;
  readonly paymentMethod: PaymentMethod;
  readonly coupon: {
    readonly entered: string | null;
    readonly applied: string | null;
    readonly rejectedReason: string | null;
  };
  readonly lines: readonly OrderLine[];
  readonly totals: PriceBreakdown;
  readonly menuVersion: string;
}

export interface OrdersFile {
  readonly schemaVersion: number;
  readonly currency: 'BDT';
  readonly moneyUnit: 'poisha';
  readonly exportedAt: string;
  readonly orders: readonly StoredOrder[];
}

/** Shape of public/orders.seed.json - seed orders carry no prices. */
export interface SeedOrdersFile {
  readonly schemaVersion: number;
  readonly currency: string;
  readonly note?: string;
  readonly orders: readonly {
    readonly id: string;
    readonly createdAt: string;
    readonly paymentMethod: PaymentMethod;
    readonly couponCode: string | null;
    readonly lines: readonly { readonly qty: number; readonly options: Selection }[];
  }[];
}
