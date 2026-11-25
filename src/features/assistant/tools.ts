/**
 * C2 (checkpoint) in code: every question the bot supports and the exact
 * function that answers it. The prose version of this table lives in
 * DECISIONS.md; this file is the executable copy, and the two must agree.
 *
 * The contract with the model:
 *   - the model may ONLY call one of these tools;
 *   - the tool computes the number from the stored orders;
 *   - the model phrases the result and nothing else;
 *   - no order data is ever put in the prompt.
 *
 * `answerable: false` is how TC-20 is answered: "Who is our best customer?"
 * maps to no tool, so the model is told to say the data cannot answer it.
 */

import {
  averageOrderValue,
  bestSellingOption,
  countOrders,
  datesWithOrders,
  ordersOnDate,
  ordersWithCouponApplied,
  ordersWithCouponRejected,
  revenueByPaymentMethod,
  topPaymentMethod,
  totalRevenue,
} from '@/domain/stats/orderStats';
import { formatPoisha } from '@/domain/money';
import type { Menu, StoredOrder } from '@/domain/types';

export interface ToolContext {
  readonly orders: readonly StoredOrder[];
  readonly menu: Menu;
}

/** What a tool hands back to the model: small, already-computed facts. */
export type ToolResult = Readonly<Record<string, unknown>>;

export interface ToolDefinition {
  readonly name: string;
  /** Sent to Gemini as the function description. */
  readonly description: string;
  readonly parameters: {
    readonly type: 'object';
    readonly properties: Readonly<Record<string, { type: string; description: string }>>;
    readonly required: readonly string[];
  };
  /** Example questions this tool is meant to catch - also the C2 table. */
  readonly answers: readonly string[];
  readonly run: (args: Readonly<Record<string, unknown>>, context: ToolContext) => ToolResult;
}

const noArgs = {
  type: 'object',
  properties: {},
  required: [],
} as const;

export const TOOLS: readonly ToolDefinition[] = [
  {
    name: 'count_orders',
    description: 'The total number of orders in the store.',
    parameters: noArgs,
    answers: ['How many orders?', 'How many orders have we taken today?'],
    run: (_args, { orders }) => ({ count: countOrders(orders) }),
  },
  {
    name: 'total_revenue',
    description:
      'Total revenue across all orders, as the sum of each payable amount after discount and including VAT.',
    parameters: noArgs,
    answers: ['What is our total revenue?', 'How much money did we make?'],
    run: (_args, { orders }) => {
      const poisha = totalRevenue(orders);
      return { poisha, bdt: formatPoisha(poisha), orders: countOrders(orders) };
    },
  },
  {
    name: 'best_selling_option',
    description:
      'The option sold in the greatest number of units, counting line quantity multiplied by option quantity.',
    parameters: noArgs,
    answers: ['What is our best-selling option?', 'Which add-on sells most?'],
    run: (_args, { orders, menu }) => {
      const best = bestSellingOption(orders, menu);
      return best === null ? { found: false } : { found: true, ...best };
    },
  },
  {
    name: 'revenue_by_payment_method',
    description:
      'Revenue split by payment method (card, bkash, cash), and which method brought in the most.',
    parameters: noArgs,
    answers: [
      'Revenue by payment method?',
      'Which payment method brought in the most money?',
    ],
    run: (_args, { orders }) => ({
      byMethod: revenueByPaymentMethod(orders),
      top: topPaymentMethod(orders),
    }),
  },
  {
    name: 'average_order_value',
    description: 'The mean payable amount per order.',
    parameters: noArgs,
    answers: ['What is our average order value?'],
    run: (_args, { orders }) => {
      const poisha = averageOrderValue(orders);
      return { poisha, bdt: formatPoisha(poisha), orders: countOrders(orders) };
    },
  },
  {
    name: 'coupon_usage',
    description:
      'How many orders actually received a coupon discount, and which orders carried a code that was not applied, with the reason.',
    parameters: noArgs,
    answers: [
      'How many orders got the coupon?',
      'How many orders actually received MORNING15?',
    ],
    run: (_args, { orders }) => ({
      applied: ordersWithCouponApplied(orders).length,
      rejected: ordersWithCouponRejected(orders).map(({ order, reason }) => ({
        id: order.id,
        entered: order.coupon.entered,
        reason,
      })),
    }),
  },
  {
    name: 'orders_on_date',
    description:
      'The orders placed on one calendar date in Asia/Dhaka. Use when the question names a day.',
    parameters: {
      type: 'object',
      properties: {
        date: {
          type: 'string',
          description: 'The date in YYYY-MM-DD form, in Asia/Dhaka.',
        },
      },
      required: ['date'],
    },
    answers: ['How many orders on 21 November?', 'Revenue on 2026-11-22?'],
    run: (args, { orders }) => {
      const date = typeof args.date === 'string' ? args.date : '';
      const matched = ordersOnDate(orders, date);
      return {
        date,
        count: matched.length,
        revenuePoisha: totalRevenue(matched),
        datesWithOrders: datesWithOrders(orders),
      };
    },
  },
];

/**
 * The system instruction. It is the other half of TC-20: the model is told
 * in plain terms that it may not supply a figure of its own, and that a
 * question outside this tool set gets a refusal rather than a guess.
 */
export const SYSTEM_INSTRUCTION = `You are the sales assistant for a breakfast shop. You answer staff questions about sales.

Hard rules:
- Every number you state must come from a tool result in this conversation. Never calculate, estimate or remember a figure yourself.
- If no tool can answer the question, say plainly that the order data does not contain it, and name what the data does hold. Never invent a name, a customer, a product or an amount.
- Orders contain no customer information at all, so questions about customers, people or names cannot be answered.
- Money is Bangladeshi Taka. Tool results give a "bdt" string already formatted; use it as given.
- Answer in the language the question was asked in (English or Bangla). Keep answers to one or two sentences.`;

export function toolByName(name: string): ToolDefinition | undefined {
  return TOOLS.find((tool) => tool.name === name);
}

/** Gemini `functionDeclarations` payload. */
export function functionDeclarations(): readonly {
  name: string;
  description: string;
  parameters: ToolDefinition['parameters'];
}[] {
  return TOOLS.map((tool) => ({
    name: tool.name,
    description: tool.description,
    parameters: tool.parameters,
  }));
}
