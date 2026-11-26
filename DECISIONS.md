# DECISIONS

Answers to every ◆ decision point (D1–D6) and ✋ checkpoint (C1–C2).

---

## C1 (checkpoint) — Why a float is risky for TC-06, and the VAT rounding by hand

**Before writing `priceCart`.**

### Why 679.50 as a float is risky

`679.50` has no exact binary representation. In IEEE-754 double precision it
is stored as the nearest representable value, so a chain of operations —
`679.5 * 1 + 490 * 2`, then `- 150`, then `* 0.05` — accumulates error.
TC-06 lands on a value whose cent digit sits exactly on a rounding boundary
(`75.475`), which is the worst possible place for drift: a float result of
`75.47499999999999` rounds to `75.47` and the final payable comes out as
`1584` instead of `1585`.

Demonstration, in Node:

```
> 0.1 + 0.2
0.30000000000000004
> 1509.5 * 0.05
75.47500000000001        // happens to be high here...
> 1659.5 * 0.15
248.92500000000004       // ...and high here too, but the direction is
                         // not something you can rely on
```

The fix is to hold money as an integer count of poisha and never divide
until the single rounding step. `roundHalfUpDiv` in `src/domain/money.ts`
throws if either argument is not an integer, so a float cannot enter the
money path by accident.

### The TC-06 VAT, by hand

```
discounted subtotal          1,509.50 BDT  = 150950 poisha
VAT is 5%:
  150950 x 5                            =  754750
  754750 / 100                          =    7547.5   <- exactly half
  half-up  ->                              7548 poisha
                                         =      75.48 BDT   ✓

integer-only form (no float appears anywhere):
  floor((754750 + 50) / 100) = floor(7548) = 7548

payable:
  150950 + 7548                         =  158498 poisha = 1,584.98 BDT
  round half-up to whole BDT:
  floor((158498 + 50) / 100)            =    1585 BDT       ✓
```

Covered by `src/domain/money.test.ts`.

**In my own words:**

I hold money as an integer number of poisha because 679.50 cannot be
stored exactly as a float, and TC-06 lands on 75.475, which sits exactly on
a rounding boundary - the worst possible place for a float to be a fraction
out, because it turns the payable from 1585 into 1584. I did not reach for a
decimal library because every sum in this task is addition, multiplication
and one division by 100, and integers do all three exactly; a library would
be a dependency and an API to learn for no extra correctness. I did not use
cents-as-string either, because every amount would have to be parsed before
it could be added to anything. What I gave up is convenience: every amount
in the code is in poisha, so it has to be converted before it is shown, and
one forgotten division by 100 would print a price a hundred times too large.
I made that hard to miss rather than hard to do, by having `roundHalfUpDiv`
throw the moment it is handed something that is not an integer.

---

## D1 — Two tabs: tab A is editing when tab B takes the last eggs

**Decision:** tab A's save is **rejected by the server, and nothing the user
typed is lost.**

**Mechanism:** the server, not the browser, owns the stock. Tab A's save is
a single `PATCH /api/cart/:id` carrying the whole new selection. The server
recomputes the net difference against the allocation that item *currently*
holds, finds the eggs are gone, and answers `409` with the shortage list
(`Short: 2 egg`). The client keeps the configuration exactly as the user
left it, shows the shortage inline and offers Retry — the same failure path
as TC-14. Tab A's own allocation is never released as part of a failed save,
so it does not lose what it already held either.

**In my own words:**

When tab A saves the item, the server checks the latest stock, not the
copy the browser is holding. If tab B has already taken the eggs, tab A's
save is rejected and the screen shows which ingredients are missing. The
item is not saved until there is enough stock, but I keep all of the user's
selections as a draft so they do not lose their work. I reject rather than
silently reduce the quantity or merge it, because at a shop counter the
cashier has already told the customer what they are getting - quietly
changing the order behind their back is worse than saying "two eggs short"
and letting the cashier decide what to do about it.

---

## D2 — When is a price locked?

**Decision:** **at Add to Cart**, for the unit price; the cart-level
discount is recomputed at checkout.

**Mechanism:** `CartItem.unitPrice` and `CartItem.pricedAt` are written when
the item is reserved and never change unless the item is edited (an edit is
a new price). The cart discount (C1 vs C2) and VAT are *not* stored on the
item — they are a property of the whole cart at the moment of payment, so
`priceCart` recomputes them from `serverTime` at checkout.

**Consistency with TC-06/TC-07:** this is exactly what those two tests
describe. The same cart, with the same locked unit prices of 679.50 and
490.00, produces subtotal 1,659.50 in both. Only the cart discount differs —
C2 at 10:59:59 and C1 at 11:00:00 — which is only possible if unit prices
are locked and the cart discount is not.

**In my own words:**

I lock the unit price when the item goes into the cart, and I recompute
the cart-level discount and the VAT at checkout. The unit price is the
number the customer was shown at that moment, so changing it afterwards
would be breaking a promise. The cart discount is not a property of one
item though - it belongs to the whole cart, and adding another item can
change which discount wins - so the server recomputes it from the server
time at the moment of payment. That is why MORNING15 only works before
11:00 in Bangladesh time: a cart paid at or after 11:00 does not get it,
and C1 is taken instead if the subtotal qualifies. Locking everything at
Add to Cart would charge a stale discount, and locking nothing would let
the unit prices move under the customer, so the split is the version that
surprises them least. Once the order is paid, nothing changes.

---

## D3 — A reservation expires mid-edit

**Decision:** the unsaved changes are **kept on screen but can no longer be
saved**; the item becomes read-only and removable.

**Mechanism:** every reservation carries a server-clock `expiresAt` and the
countdown is driven by `api.serverNow()`, never `Date.now()`
(`src/server/clock.ts` deliberately runs 90 s ahead to catch that mistake).
When the sweep expires an item it goes to `status: 'expired'`, its stock is
released, and the edit form switches to a read-only state with an explicit
banner: *"This item's 5-minute hold expired and the ingredients were
released. Your changes are still here — add it to the cart again to try
for them."* The typed configuration is retained so re-adding is one click,
but it has to compete for stock again like any new item.

**In my own words:**

If the reservation expires while the user is editing an item, the
changes can no longer be saved. I keep the user's selections as a draft so
nothing is lost, the expired item becomes read-only, and the only thing
left to do with it is remove it. I show a message explaining that the hold
expired and that the item has to be added again. I keep the draft rather
than clear it because the hold timing out is not the cashier's mistake, and
throwing away half a minute of their work to tell them so would be
punishing the wrong person. I do not auto-renew the hold, because then five
minutes would not mean anything - one unfinished order could keep the stock
locked away from every other customer for as long as the tab stays open.

---

## D4 — Who creates the order id and timestamp, and how is a double Pay stopped?

**Decision:** **the server** creates both. A double click is stopped by an
**idempotency key generated per user intent**.

**Mechanism:** the browser never invents an order id or a `createdAt`. It
sends `POST /api/checkout` with an `Idempotency-Key` header created once
when the checkout screen opens — not once per click. The server keeps
`idempotency: Map<key, orderId>`; the first call creates the order inside
one synchronous critical section (reserved stock becomes sold, the cart
empties) and records the key, and every later call with the same key returns
*the same order* instead of making a new one. The button is also disabled
while the request is in flight, but that is a courtesy, not the guarantee —
the guarantee is on the server, which is the only place that survives a
reload mid-click.

**In my own words:**

The server creates the order ID and the timestamp. When the user clicks
Pay I send a unique idempotency key with the request, created once for that
checkout rather than once per click, so if the same request arrives again
the server returns the same order instead of creating another one. I also
disable the Pay button while the request is in flight, but that is only a
courtesy: it covers one tab at one moment and does nothing about a reload
in the middle of a click, two tabs, or a key held down, so the guarantee
has to live on the server. The ID and the time belong to the server for the
same reason - two browsers have two different clocks, the user can change
theirs, and nothing else can keep the ids in one sequence.

---

## D6 — The stored order shape

**Decision:** see `StoredOrder` in `src/domain/types.ts`. Money is **integer
poisha**, declared in the file envelope. A coupon that was *entered* but not
*applied* is recorded with the reason it lost.

```jsonc
{
  "schemaVersion": 1,
  "currency": "BDT",
  "moneyUnit": "poisha",          // declared once, so no reader has to guess
  "exportedAt": "2026-11-25T23:00:00+06:00",
  "orders": [
    {
      "id": "ORD-1001",                          // server-created (D4)
      "createdAt": "2026-11-20T09:15:00+06:00",  // server clock, +06:00 offset
      "paymentMethod": "card",                   // a label only; no payment data
      "coupon": {
        "entered": "MORNING15",   // what the customer typed
        "applied": "MORNING15",   // null when it did not win
        "rejectedReason": null    // why it did not, when applied is null
      },
      "lines": [
        {
          "qty": 1,
          "options": { "toast": 1, "scrambled": 2, "sausage": 1, "ketchup": 1 },
          "unitPrice": 38000,     // locked at Add to Cart (D2)
          "lineTotal": 38000
        }
      ],
      "totals": {                 // the full PriceBreakdown, not just a number
        "subtotal": 38000,
        "candidates": [ /* C1 and C2, each with amount + reason */ ],
        "discount": { "id": "C2", "kind": "coupon", "amount": 5700 },
        "discountedSubtotal": 32300,
        "vat": 1615,
        "payable": 33900          // always a multiple of 100 (whole BDT)
      },
      "menuVersion": "appendix-a-1"
    }
  ]
}
```

Three choices worth naming:

- **`moneyUnit` is in the envelope.** Integer poisha is unambiguous only if
  the reader knows the unit, so the file says it once instead of relying on
  a convention.
- **The whole `PriceBreakdown` is stored, not just the payable.** Both
  discount candidates are kept with the reason each won or lost, which is
  what lets the assistant answer "how many orders *actually* got the
  coupon" without re-running the pricing engine over history.
- **`menuVersion` is stored.** Prices move. Without it an old order cannot
  be explained against the menu it was placed from.

**In my own words:**

I store all prices as integer poisha instead of decimal numbers, and
each order carries its ID, creation time, payment method, items, subtotal,
discounts, VAT and final payable amount. I keep the coupon in three
separate fields so the file can say what the customer typed and whether it
actually won: `entered: "MORNING15"` with `applied: null` and a
`rejectedReason` means the customer did enter the code but got no discount
from it. One nullable code could not say that - it could only name the
coupon that was applied, and "the customer tried MORNING15 and lost to C1"
is exactly the thing the shop owner asks about. I store the totals rather
than recompute them on read because menu prices move, so recomputing an old
order against today's menu would produce a number that does not match the
receipt the customer was given. That is also why the menu version is stored
next to them.

---

## C2 (checkpoint) — Every question the bot supports, and the function that answers it

**Before wiring Gemini.** The executable copy of this table is `TOOLS` in
`src/features/assistant/tools.ts`; the two must stay in agreement.

| Question | Tool (name) | Inputs | Output |
| --- | --- | --- | --- |
| How many orders? | `count_orders` | none | `{ count }` |
| Total revenue? | `total_revenue` | none | `{ poisha, bdt, orders }` |
| Best-selling option? | `best_selling_option` | none | `{ optionId, name, units }` |
| Revenue by payment method? / Which method earned most? | `revenue_by_payment_method` | none | `{ byMethod, top }` |
| Average order value? | `average_order_value` | none | `{ poisha, bdt, orders }` |
| How many orders actually got the coupon? | `coupon_usage` | none | `{ applied, rejected[] }` |
| Orders on a given date? | `orders_on_date` | `date` (`YYYY-MM-DD`, Asia/Dhaka) | `{ date, count, revenuePoisha, datesWithOrders }` |

Each tool is a thin wrapper over a pure function in
`src/domain/stats/orderStats.ts`, which is unit tested against the seed data.

**The contract with the model:** the orders are never put in a prompt. The
model picks one tool, our code computes the figure, and the model only
phrases the result. `units` for the best seller is counted as line quantity
× option quantity, the same measure ANSWERS Q6 uses.

**In my own words:**

I use function calling rather than sending the orders JSON and asking
for a summary, because the numbers have to be right. Every figure comes
from a pure function in `orderStats.ts` that is unit tested against the
seed data, so the model never does the arithmetic - it picks the tool and
phrases the result. Sending the orders instead would hand the maths to the
part of the system that is least reliable at it, and it would also put the
order data into the model's context, which is where a question like "who is
our best customer" would find something to invent from. What it costs me is
two API calls for every question instead of one, and a question nobody
wrote a tool for cannot be answered at all - so the tool table has to stay
in step with the questions the bot is expected to handle.

---

## D5 — "Who is our best customer?"

**Decision:** the bot says plainly that the order data holds no customer
information, and names what it *can* answer instead. It never produces a
name.

**Mechanism:** two layers, because a prompt instruction alone is not a
guarantee.

1. **No tool can answer it.** There is no customer tool, and the system
   instruction states that every number must come from a tool result and
   that orders contain no customer information at all.
2. **Nothing the model says can become a figure.** The orders are never in
   the context window, so there is no name in the conversation for it to
   latch onto. If it calls no tool, the panel shows the model's sentence
   with no data attached; if it tries to call a tool that does not exist,
   `toolByName` returns `undefined` and the panel answers with the
   "cannot be answered from this data" message directly.

TC-20 asserts both halves: the reply explains the limitation and contains no
invented name.

**In my own words:**

If someone asks who our best customer is, the chatbot says plainly that
this information is not available, because our order data does not contain
customer details. A prompt instruction on its own is not enough: it is a
request rather than a guarantee, and a differently worded question, a
different temperature or a newer model version can all get around it. So I
removed the ability instead of asking for it to be unused - there is no
customer tool for the model to call, and the orders are never put into the
conversation at all, which means there is no name anywhere in the context
for it to latch onto. It only answers questions the available order data
can actually support. If the orders did have customers, I would keep that
behind its own tool and have it return totals rather than names, so
personal data never travels through the model to begin with.
