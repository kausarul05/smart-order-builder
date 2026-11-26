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
  fixtures/        Appendix A as data, plus an unrelated second menu
                   — imported ONLY by src/server
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
    assistant/       Gemini function calling, tool table, floating chat
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

### The one thing a deployed build does that localhost does not

MSW's service worker keeps its list of active clients in memory, and the
browser terminates an idle service worker. When it restarts, that list is
empty until the page repeats the activation handshake, and a request made in
that window is passed through to the network. The dev server answers an
unknown path with `index.html`, so locally it looks like a stale worker; a
static host answers with a bare **404**, which is why this only appeared on
the deployed site and why pressing Retry made it go away.

So `src/api/client.ts` treats a response that carries no `error` code of
ours as "that did not come from the mock server", revives the worker and
makes the request once more, rather than reporting a 404 nobody can act on.
Retrying is safe because the first attempt never reached the server, and
every write carries an `Idempotency-Key` regardless. A failure the mock
server composed itself — the deliberate 15% on `/price`, a shortage, a
version conflict — is never retried, since that is a real answer. The
worker is also re-handshaked when the tab becomes visible again, which is
where it is most likely to have been terminated.

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

That extends to how the controls behave. A group the fixture caps at one
unit (Appendix A's Bread) is a choice of one, so tapping a second bread
means "that one instead" and swaps the pick in a single tap, while a group
that counts units (Eggs) keeps adding. The signal is the effective `max`,
after any `overrideLimit` rule, never a group id — see
`src/domain/rules/pick.ts`.

### The one place the brief is ambiguous

Part C says the combo applies "if eggs >= 4 AND protein >= 2". That can
mean four option **units** in the Eggs group or four egg **ingredients** —
Omelette is one unit but two eggs. Protein is 1:1, so only eggs can
differ, and **no acceptance test distinguishes the two readings**:
`tests/acceptance/combo-measure.test.ts` proves it by pricing every pinned
configuration both ways and getting the same number.

The shipped fixture counts option units, for consistency with every other
count in the engine. A threshold can instead name an ingredient, so the
other reading is one line in the fixture and no code change:

```ts
{ groupId: 'eggs', minUnits: 4 }      // shipped
{ ingredientId: 'egg', minUnits: 4 }  // the other reading
```

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
| G — bonus | Done, after A–F. A refresh keeps only still-valid reservations, a stale tab gets a conflict instead of overwriting, and an unfinished plate survives a refresh |

`npm test` runs 343 passing tests, with nothing skipped or pending. Every
acceptance test from Section 9 (TC-01 … TC-20) exists as a real test, and
`tests/acceptance/coverage.test.ts` enforces that: it fails the suite if a
TC id ever loses the test that covers it, or if a placeholder test is left
behind.

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
- **The mock server's own state is what persists, not a client copy.** Part
  G writes stock, reservations, the cart and the idempotency keys to
  localStorage after every committed mutation. A reload restores them and
  drops any reservation whose five minutes elapsed while the tab was away,
  which is exactly what the sweep would have done. Seed orders are
  deliberately kept out of sold stock: they are history, and subtracting
  them would empty today's shelves on first load.
- **That store is also how two tabs share one server.** MSW runs a worker
  per tab, so without it each tab would have its own memory. With it, a
  write in one tab raises a `storage` event in the other, which refetches;
  and a tab that pays against a cart version someone else has moved past
  gets a conflict rather than charging for an order the customer cannot
  see.
- **The unfinished plate is in sessionStorage, not localStorage.** A draft
  belongs to one tab and one sitting; restoring someone else's half-built
  order in a new window would be surprising rather than helpful.
- **The Gemini model id will rot.** `gemini-2.0-flash` was shut down on
  1 June 2026. The default is a current Flash-Lite, chosen over the newest
  Flash because its free daily allowance is far larger and each question
  costs two calls. A retired id comes back as a 404 and the panel says so by
  name; `VITE_GEMINI_MODEL` overrides it without a code change.

## Hours spent

<!-- Keep this honest and keep it current — the brief asks for actual hours. -->

| Date | Hours | What |
| --- | --- | --- |
| | | |
| **Total** | | |
