# ANSWERS

Every figure below is produced by running the project's own code:

```bash
npm run answers
```

That command runs `tests/answers/answers.test.ts`, which prints each answer
and asserts the ones the brief pins, and writes the raw transcript to
[`docs/answers.generated.txt`](./docs/answers.generated.txt). If an engine
changes and an answer moves, that test fails before this file goes stale.

> Q5–Q8 depend on the six seed orders, which carry no prices and are priced
> by our own engine at each order's own `createdAt`.

---

## Q1 — Starting from an empty cart, how many of item C can you add? Which ingredient limits it?

**2 units, limited by cheese.**

Item C is *Paratha, Fried ×2, Tofu ×1, Cheese ×2, Baked Beans ×1,
Mushroom ×1, Chili*. One unit consumes:

| Ingredient | Per unit | Stock | Units it allows |
| --- | --- | --- | --- |
| **cheese** | 2 | 4 | **2** ← binding |
| egg | 2 | 10 | 5 |
| tofu | 1 | 5 | 5 |
| mushroom | 1 | 6 | 6 |
| beans | 1 | 8 | 8 |
| paratha | 1 | 10 | 10 |

The limit is `min(floor(stock / perUnit))` across the ingredients C uses, so
cheese caps it at 2. (Chili has no stock at all and never constrains
anything.)

## Q2 — The cheapest valid configuration and its unit price

**Toast + Fried ×2 + Tofu ×1 — 360.00 BDT.**

```
base                           250.00
Toast                            0.00   (cheapest bread; min 1, max 1)
Fried x2                        60.00   (2 units satisfies min 2 / step 2)
Tofu                            50.00   (cheapest protein; min 1)
Extras                           0.00   (min 0)
Sauce                            0.00   (min 0)
                              --------
unit price                     360.00
```

No promotion applies: the extras group is empty so P2 cannot fire, and the
eggs group has 2 units against the combo's threshold of 4, so P1 cannot
either. Found by brute force over every limit-satisfying combination and
filtering with `validate` — see the Q2 block in `answers.test.ts`, so this
is a searched minimum rather than an eyeballed one.

## Q3 — Cart = A ×3 at 10:30, then the same at 11:30

> Assumption stated explicitly: the question only becomes interesting if
> `MORNING15` is entered, so both runs below have the coupon entered. Item
> A's unit price is 380.00 (TC-05).

### At 10:30 — step by step

```
line total       380.00 x 3                        = 1,140.00
cart subtotal                                        1,140.00

C1: subtotal >= 1,200.00 ?   1,140.00 < 1,200.00  -> not eligible, 0.00
C2: before 11:00 in Asia/Dhaka ?        10:30 yes -> eligible
    15% of 1,140.00 = 114000 x 15 / 100 =  17100  =   171.00
    cap 150.00                                    ->  150.00  (capped)

larger of the two                                 ->  C2, 150.00
discounted subtotal   1,140.00 - 150.00            =   990.00

VAT 5%:  99000 x 5 = 495000; /100 = 4950 exactly   =    49.50
payable: 99000 + 4950 = 103950 poisha = 1,039.50
         round half-up to whole BDT                = 1,040 BDT
```

| | 10:30 | 11:30 |
| --- | --- | --- |
| Subtotal | 1,140.00 | 1,140.00 |
| Chosen discount | **C2 — 150.00** (capped from 171.00) | **none** |
| VAT (5%) | 49.50 | 57.00 |
| **Payable** | **1,040 BDT** | **1,197 BDT** |

At 11:30 the coupon is outside its window, and C1 cannot step in because
1,140.00 never reaches the 1,200.00 threshold — so the cart takes no
discount at all and the customer pays 157 BDT more.

## Q4 — After TC-10, what is the payable at 11:30?

**1,600 BDT.**

TC-10 leaves the cart as edited-B ×1 (Omelette ×1 + Fried ×3, re-priced to
643.50) plus C ×2 (490.00 each):

```
643.50 x 1 + 490.00 x 2        subtotal   = 1,623.50
C2 at 11:30                                   rejected (outside the window)
C1: 1,623.50 >= 1,200.00                   =   100.00  applied
discounted subtotal                        = 1,523.50
VAT 5%: 152350 x 5 / 100 = 7617.5 -> 7618  =    76.18
152350 + 7618 = 159968 -> whole BDT        = 1,600 BDT
```

## Q5 — The payable of each seed order, and the total revenue of all six

| Order | Placed (Asia/Dhaka) | Method | Subtotal | Discount | VAT | **Payable** |
| --- | --- | --- | --- | --- | --- | --- |
| ORD-1001 | 2026-11-20 09:15 | card | 380.00 | C2 57.00 | 16.15 | **339** |
| ORD-1002 | 2026-11-20 12:40 | bkash | 679.50 | none | 33.98 | **713** |
| ORD-1003 | 2026-11-21 10:05 | cash | 1,360.00 | C2 150.00 | 60.50 | **1,271** |
| ORD-1004 | 2026-11-21 19:30 | card | 550.00 | none | 27.50 | **578** |
| ORD-1005 | 2026-11-22 08:50 | bkash | 970.00 | C2 145.50 | 41.23 | **866** |
| ORD-1006 | 2026-11-22 13:10 | card | 1,169.50 | none | 58.48 | **1,228** |
| | | | | | **Total** | **4,995 BDT** |

Worth noting: ORD-1004's subtotal is 550.00, not 575.00, because its three
extras (Hash Brown, Baked Beans, Mushroom) trigger P2 — `floor(3 / 3) = 1`
free unit, and the cheapest of the three is Baked Beans at 25.00.

## Q6 — The best-selling option across the seed orders, in units

**Fried, 10 units.** Counted as line quantity × option quantity.

| Option | Units |
| --- | --- |
| **Fried** | **10** |
| Chicken Sausage | 8 |
| Scrambled | 8 |
| Cheese | 6 |
| Omelette | 6 |

Fried appears in ORD-1003 (×2 per unit, 2 lines of qty 2 → 4), ORD-1006
(2 + 2) and ORD-1002 (2). Chicken Sausage and Scrambled both reach 8 — the
tie is below the winner, so it does not affect the answer, but
`optionUnitsSold` breaks ties by option id to keep the ordering stable.

## Q7 — Which payment method brought in the most revenue?

**card — 2,145.00 BDT.**

| Method | Revenue | Orders |
| --- | --- | --- |
| **card** | **2,145.00** | ORD-1001, ORD-1004, ORD-1006 |
| bkash | 1,579.00 | ORD-1002, ORD-1005 |
| cash | 1,271.00 | ORD-1003 |

Revenue is the sum of `payable` — what the customer actually hands over,
after the discount and including VAT.

## Q8 — How many seed orders actually received the MORNING15 discount?

**Three: ORD-1001, ORD-1003 and ORD-1005.**

Four of the six carry the code. Here is every one of them, and why the
fourth got nothing:

| Order | Placed | Code | Got it? | Why |
| --- | --- | --- | --- | --- |
| ORD-1001 | 09:15 | MORNING15 | ✅ 57.00 off | Inside the window. 15% of 380.00 = 57.00, under the 150.00 cap. C1 was not eligible (380.00 < 1,200.00), so C2 won unopposed. |
| ORD-1003 | 10:05 | MORNING15 | ✅ 150.00 off | Inside the window. 15% of 1,360.00 = 204.00, **capped to 150.00**. C1 was also eligible at 100.00, but 150.00 > 100.00, so C2 won. |
| ORD-1005 | 08:50 | MORNING15 | ✅ 145.50 off | Inside the window. 15% of 970.00 = 145.50, under the cap. C1 not eligible (970.00 < 1,200.00). |
| ORD-1006 | **13:10** | MORNING15 | ❌ nothing | **Two separate reasons.** First, 13:10 is after 11:00 Asia/Dhaka, so the coupon is rejected outright. Second, C1 could not take its place either: the subtotal is 1,169.50, which falls 30.50 short of the 1,200.00 threshold. So this order carries a code and received no discount of any kind. |
| ORD-1002 | 12:40 | — | — | No code entered. |
| ORD-1004 | 19:30 | — | — | No code entered. |

This is exactly the case the stored shape is built for (D6): ORD-1006 keeps
`coupon.entered = "MORNING15"` with `coupon.applied = null` and
`rejectedReason = "MORNING15 is only valid before 11:00 (Asia/Dhaka)"`, so
"how many orders *actually* got the coupon" (3) is answerable without
re-running the pricing engine over history — and is distinct from "how many
orders carry the code" (4).
