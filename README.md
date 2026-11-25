# Smart Order Builder

Frontend technical assessment for DevsStream Limited — a breakfast
configurator with a rules engine, ingredient-based shared stock, an integer
pricing engine, reservations, JSON orders and a sales assistant.

There is **no real backend**. MSW is the server.

## Setup

```bash
npm install
cp .env.example .env.local      # then put a free Gemini key in it
npm run dev                     # http://localhost:5173
```

| Command | What it does |
| --- | --- |
| `npm run dev` | Dev server, MSW starts before React renders |
| `npm test` | **The one command for the whole test suite** |
| `npm run answers` | Prints every ANSWERS.md figure and writes `docs/answers.generated.txt` |
| `npm run verify` | typecheck + lint + tests |
| `npm run build` | Production build |

The Gemini key is read from `VITE_GEMINI_API_KEY`. `.env.local` is
git-ignored and **no real key is committed anywhere in this repository** —
`.env.example` ships the variable name only.

## Architecture

The layers only ever point downwards. `src/domain` is the bottom and knows
nothing about React, MSW or the network.

```
src/
  domain/          pure engines — no React, no fetch, no MSW
    types.ts         every shape; all money is integer poisha
    money.ts         half-up rounding, poisha <-> BDT
    time.ts          Asia/Dhaka wall clock (the 11:00 coupon window)
    selection.ts     group units, distinct counts, menu lookups
    rules/           Part A  validate(config, groups, rules)
    stock/           Part B  usage, availability, net-difference edits
    pricing/         Part C  priceCart / priceUnit
    stats/           Part F  the numbers behind the chatbot
  fixtures/        Appendix A as data — imported ONLY by src/server
  server/          the mock backend: state, clock, MSW handlers
  api/             the single typed client; owns the server-time offset
  lib/             LatestOnly (stale-response guard), debounce
  features/
    configurator/    option rows, headroom, violations, price preview
    cart/            held items, server-clock countdown, edit / remove
    checkout/        coupon, payment label, Pay, orders.json export
    orderBuilder/    the one hook holding menu + stock + cart + orders
    assistant/       Gemini function calling, tool table, chat panel
tests/
  fixtures/        configurations A, B, C from Section 9
  acceptance/      TC-01 .. TC-20, named after the brief
  answers/         ANSWERS.md is generated from a real run
```

### Why the engines are pure

`priceCart` is imported by the mock server **and** by the tests, so there is
only one implementation of the money rules and nothing can drift between
what the server charges and what a test asserts. The same holds for
`validate` and for the stock engine.

### The menu is data, never code

Groups, options, prices, ingredient usage, stock levels, the cross-group
rules and every promotion parameter (P1, P2, C1, C2, VAT) live in
`src/fixtures/menu.default.ts` and reach the app over `GET /api/menu`. No
component or engine mentions an option id, a group id or a limit value, so a
different menu fixture works without a code change.

### Three decisions worth knowing before reading the code

1. **Group limits count option units, not ingredient units.** TC-01 and
   TC-09 together prove it: `Scrambled x3` is 3 units and breaks `step: 2`,
   while `Omelette x3 + Fried x1` is 4 units (7 eggs) and is rejected only
   for stock. The P1 combo thresholds use the same measure.
2. **Money never touches a float.** Every amount is an integer number of
   poisha and the only division by 100 goes through `roundHalfUpDiv`, which
   refuses a non-integer argument outright.
3. **An edit is one atomic swap, not release-then-reserve.** The item's own
   allocation counts as available to itself, so only the positive part of
   the difference has to be found in free stock.

The reasoning behind every ◆ decision point and ✋ checkpoint is in
[DECISIONS.md](./DECISIONS.md); the computed answers are in
[ANSWERS.md](./ANSWERS.md).

## Status

| Part | State |
| --- | --- |
| A — rules engine | Done, TC-01 … TC-04 green |
| B — shared stock, net-difference edits | Engine done, TC-08 … TC-11 green |
| C — pricing engine | Done, TC-05 … TC-07 green |
| C — async `/price` preview | Wired: 300 ms debounce, stale-response guard, Retry on failure. TC-12's automated test outstanding |
| D — cart and reservations | Done, TC-13 … TC-15 green (atomic reserve, idempotency, net-difference swap, server-clock expiry) |
| E — checkout and orders JSON | Done, TC-16 … TC-17 green (atomic checkout, idempotent Pay, persisted store, `Download orders.json`) |
| F — sales assistant | Done, TC-18 … TC-20 green (Gemini function calling, 7 tools, chat panel) |
| G — bonus | Not started, and will not be before A–F pass |

`npm test` currently runs 171 passing tests. The outstanding acceptance tests
exist as `it.todo` in `tests/acceptance/pending.test.ts`, so the suite is a
live checklist of Section 9 rather than a list that only lives in the brief.

## Trade-offs and what is unfinished

- **Tailwind over a component library.** This is a logic assessment; a plain
  responsive layout with CSS variables for the two themes is enough, and it
  keeps the diff about the engines.
- **`noUncheckedIndexedAccess` and `exactOptionalPropertyTypes` are on.**
  They cost some verbosity at every `Record` lookup and buy real safety in
  code that is mostly `Record` lookups over stock and selections.
- **The production bundle is large (~530 kB)** because MSW ships inside it.
  That is deliberate: MSW *is* the backend for this task, so it has to be in
  the deployed build for a live demo to work at all.
- **Unfinished:** see the Status table. Nothing in Part G has been started.

## Hours spent

<!-- Keep this honest and keep it current — the brief asks for actual hours. -->

| Date | Hours | What |
| --- | --- | --- |
| | | |
| **Total** | | |
