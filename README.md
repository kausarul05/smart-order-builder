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
  components/ui/   icon set, toast provider and its context
  features/
    pos/             Sidebar (category rail + live stock), ProductGrid,
                     OrderPanel (ticket, totals, Pay, assistant tab)
    configurator/    the draft: headroom, violations, price preview
    checkout/        orders.json export
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

### Responsive shape

A three-column till from `lg`: a dark category rail, the product grid, and
the order rail. Below `lg` it is one column — the rail becomes a drawer
behind a menu button, and the order rail becomes a bottom sheet behind a
sticky "View order · N items · total" bar. Product cards are two across on
a phone, three from `lg`, four from `2xl`. Steppers are 36 px touch targets
below `sm`, and nothing depends on hover.

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
| B — shared stock, net-difference edits | Done, TC-08 … TC-11 green (engine + server + screen) |
| C — pricing engine | Done, TC-05 … TC-07 green |
| C — async `/price` preview | Done, TC-12 green (300 ms debounce, stale-response guard, Retry) |
| D — cart and reservations | Done, TC-13 … TC-15 green (atomic reserve, idempotency, net-difference swap, server-clock expiry) |
| E — checkout and orders JSON | Done, TC-16 … TC-17 green (atomic checkout, idempotent Pay, persisted store, `Download orders.json`) |
| F — sales assistant | Done, TC-18 … TC-20 green (Gemini function calling, 7 tools, chat panel) |
| G — bonus | Not started. Groundwork is in place (cart versioning returns a conflict, reservations are swept against the server clock) but the brief says not to start it before A–F are correct |

`npm test` runs 213 passing tests. Every acceptance test from Section 9
(TC-01 … TC-20) exists as a real test — `tests/acceptance/pending.test.ts`
maps each one to its file and holds the three Part G items that are
deliberately not started.

## Trade-offs and what is unfinished

- **Tailwind plus a small token set, no component library and no toast
  dependency.** Every colour is a CSS variable defined once and redefined
  for dark mode, so no component hard-codes one. Toasts are about sixty
  lines of context and a timer, which is less than the cost of a dependency.
- **The category rail scrolls to a group instead of filtering to it.** Every
  group has a minimum or maximum to satisfy, so hiding four of them behind a
  tab would mean hunting for whatever is still wrong. The rail carries each
  group's count and a dot when it has a violation, which is the useful part.
- **Option artwork is local SVG, not hotlinked photographs.** A hotlinked
  photo breaks when the host changes and drags someone else's licence into
  the repo. The illustrations live in `public/img/options/` and reach the app
  through the menu's `image` field, so a fixture can point at photographs
  instead with no code change. Each one is a 160×120 card filling the tile's
  4:3 area, so the grid reads like a menu rather than a list of icons.
- **The envelope is checked, not assumed.** Every response carries
  `{ serverTime, data }`. A 200 that is not one of those means the request
  fell through to the dev server, which answers any unknown path with
  index.html — the usual cause being an MSW service worker left stale by a
  tab that stayed open across a rebuild. The client says exactly that and
  the shell offers a reload, rather than dying on
  `Cannot read properties of null`.
- **Motion is cosmetic and fails open.** `src/lib/flyTo.ts` flies a ghost of
  the dish into the order rail, bumps the count and pulses the target. It
  animates only `transform` and `opacity`, and it bails out silently under
  `prefers-reduced-motion`, with no registered target, or where there is no
  Web Animations API at all — it is never in the path of a request.
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
