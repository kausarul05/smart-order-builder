/**
 * TC-18 .. TC-20 - Part F, the sales assistant.
 *
 * The Gemini call is mocked with MSW, so these tests need no API key and no
 * network. The mock phrases its answer FROM the functionResponse it was
 * given, which is how each test proves the figure came from our own tool
 * rather than from the model.
 */

import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { http, HttpResponse } from 'msw';
import { setupServer } from 'msw/node';

import { bestSellingOption, countOrders, totalRevenue } from '@/domain/stats/orderStats';
import { formatPoisha } from '@/domain/money';
import { DEFAULT_MENU } from '@/fixtures/menu.default';
import { askAssistant, NO_TOOL_FALLBACK } from '@/features/assistant/askAssistant';
import { AssistantError } from '@/features/assistant/gemini';
import { reserveItem } from '@/server/cart';
import { manualClock, resetServerClock, setServerClock } from '@/server/clock';
import { checkout, initOrders, listOrders } from '@/server/orders';
import { resetState } from '@/server/state';
import type { SeedOrdersFile } from '@/domain/types';
import seedJson from '../../public/orders.seed.json';
import { SELECTION_A } from '../fixtures/configs';

const GEMINI = 'https://generativelanguage.googleapis.com/v1beta/models/*';
const seed = seedJson as unknown as SeedOrdersFile;

interface FunctionCall {
  readonly name: string;
  readonly args?: Record<string, unknown>;
}

const server = setupServer();

beforeAll(() => server.listen({ onUnhandledRequest: 'bypass' }));
afterAll(() => server.close());

beforeEach(() => {
  localStorage.clear();
  resetState();
  setServerClock(manualClock(new Date('2026-11-25T09:00:00+06:00')));
  vi.stubEnv('VITE_GEMINI_API_KEY', 'AIzaTEST_KEY_FOR_TESTS_ONLY_0000000000');
  vi.stubEnv('VITE_GEMINI_MODEL', 'gemini-3.5-flash-lite');
});

afterEach(() => {
  server.resetHandlers();
  vi.unstubAllEnvs();
  resetServerClock();
  localStorage.clear();
});

/**
 * A Gemini stand-in that always picks `call` and then reports the tool
 * result it was handed. Also records every request body, so a test can
 * assert what was and was not sent to the model.
 */
function mockGemini(call: FunctionCall | null) {
  const bodies: unknown[] = [];

  server.use(
    http.post(GEMINI, async ({ request }) => {
      const body = (await request.json()) as {
        contents: { role: string; parts: Record<string, unknown>[] }[];
      };
      bodies.push(body);

      const response = body.contents
        .flatMap((turn) => turn.parts)
        .find((part) => 'functionResponse' in part);

      if (response !== undefined) {
        // Second leg: phrase the figure our code computed.
        const { functionResponse } = response as {
          functionResponse: { name: string; response: { result: unknown } };
        };
        return HttpResponse.json({
          candidates: [
            {
              content: {
                role: 'model',
                parts: [
                  {
                    text: `From ${functionResponse.name}: ${JSON.stringify(
                      functionResponse.response.result,
                    )}`,
                  },
                ],
              },
            },
          ],
        });
      }

      // First leg: either pick a tool, or answer with words only.
      return HttpResponse.json({
        candidates: [
          {
            content: {
              role: 'model',
              parts:
                call === null
                  ? [
                      {
                        text: 'The order data holds no customer information, so I cannot say who the best customer is.',
                      },
                    ]
                  : [{ functionCall: call }],
            },
          },
        ],
      });
    }),
  );

  return bodies;
}

const context = () => ({ orders: listOrders(), menu: DEFAULT_MENU });

/** Adds configuration A to the cart and pays for it. */
function placeOneOrder(key: string): void {
  reserveItem({ selection: SELECTION_A, qty: 1, idempotencyKey: `add-${key}` });
  checkout({ paymentMethod: 'card', idempotencyKey: `pay-${key}` });
}

describe('TC-18 - the order count rises by exactly one after a checkout', () => {
  it('answers 6, then 7, with no reload in between', async () => {
    initOrders(seed);
    mockGemini({ name: 'count_orders' });

    const before = await askAssistant('How many orders?', context());
    expect(before.toolName).toBe('count_orders');
    expect(before.toolResult).toEqual({ count: 6 });
    expect(before.text).toContain('"count":6');

    placeOneOrder('tc18');

    const after = await askAssistant('How many orders?', context());
    expect(after.toolResult).toEqual({ count: 7 });

    const countBefore = (before.toolResult as { count: number }).count;
    const countAfter = (after.toolResult as { count: number }).count;
    expect(countAfter - countBefore).toBe(1);
  });

  it('agrees with countOrders() at every step', async () => {
    initOrders(seed);
    mockGemini({ name: 'count_orders' });

    for (const key of ['a', 'b', 'c']) {
      const answer = await askAssistant('How many orders?', context());
      expect(answer.toolResult).toEqual({ count: countOrders(listOrders()) });
      placeOneOrder(key);
    }
    expect(listOrders()).toHaveLength(9);
  });
});

describe('TC-19 - the best-selling option matches the stats function', () => {
  it('reports Fried with 10 units from the seed data', async () => {
    initOrders(seed);
    mockGemini({ name: 'best_selling_option' });

    const answer = await askAssistant('What sells best?', context());
    const expected = bestSellingOption(listOrders(), DEFAULT_MENU);

    expect(answer.grounded).toBe(true);
    expect(answer.toolResult).toEqual({ found: true, ...expected });
    expect(answer.text).toContain('Fried');
    expect(answer.text).toContain('10');
  });

  it('follows the data when the data changes during review', async () => {
    initOrders(seed);
    mockGemini({ name: 'best_selling_option' });

    // The seed leaves Fried on 10 and Scrambled on 8. Configuration A adds
    // two Scrambled, so one order brings Scrambled level at 10 - and a tie
    // is broken by option id, so Fried still wins.
    placeOneOrder('s1');
    const tied = await askAssistant('What sells best?', context());
    expect(tied.toolResult).toMatchObject({ optionId: 'fried', units: 10 });

    // A second order puts Scrambled on 12 and it overtakes.
    placeOneOrder('s2');
    const now = await askAssistant('What sells best?', context());
    expect(now.toolResult).toEqual({
      found: true,
      ...bestSellingOption(listOrders(), DEFAULT_MENU),
    });
    expect((now.toolResult as { optionId: string }).optionId).toBe('scrambled');
  });

  it('reports total revenue straight from the engine', async () => {
    initOrders(seed);
    mockGemini({ name: 'total_revenue' });

    const answer = await askAssistant('How much did we make?', context());
    expect(answer.toolResult).toEqual({
      poisha: totalRevenue(listOrders()),
      bdt: formatPoisha(totalRevenue(listOrders())),
      orders: 6,
    });
    expect(answer.text).toContain('4,995.00');
  });
});

describe('TC-20 - it refuses to invent a best customer', () => {
  it('explains the data cannot answer it and names nobody', async () => {
    initOrders(seed);
    mockGemini(null);

    const answer = await askAssistant('Who is our best customer?', context());

    expect(answer.toolName).toBeNull();
    expect(answer.toolResult).toBeNull();
    // Nothing it said is a figure we stand behind.
    expect(answer.grounded).toBe(false);
    expect(answer.text).toMatch(/no customer information/i);
  });

  it('answers for itself when the model asks for a tool we do not have', async () => {
    initOrders(seed);
    mockGemini({ name: 'best_customer' });

    const answer = await askAssistant('Who is our best customer?', context());
    expect(answer.text).toBe(NO_TOOL_FALLBACK);
    expect(answer.grounded).toBe(false);
  });

  it('echoes the call id back on the functionResponse', async () => {
    initOrders(seed);
    const bodies: unknown[] = [];
    server.use(
      http.post(GEMINI, async ({ request }) => {
        const body = (await request.json()) as {
          contents: { parts: Record<string, unknown>[] }[];
        };
        bodies.push(body);
        const answered = body.contents
          .flatMap((turn) => turn.parts)
          .some((part) => 'functionResponse' in part);
        return HttpResponse.json({
          candidates: [
            {
              content: {
                role: 'model',
                parts: answered
                  ? [{ text: 'six' }]
                  : [{ functionCall: { name: 'count_orders', args: {}, id: 'call-42' } }],
              },
            },
          ],
        });
      }),
    );

    await askAssistant('How many orders?', context());

    // Without the id the model cannot match the result to its own call.
    const second = bodies[1] as { contents: { parts: Record<string, unknown>[] }[] };
    const response = second.contents
      .flatMap((turn) => turn.parts)
      .find((part) => 'functionResponse' in part) as {
      functionResponse: { id?: string; name: string };
    };
    expect(response.functionResponse.id).toBe('call-42');
    expect(response.functionResponse.name).toBe('count_orders');
  });

  it('omits the id when the model did not send one', async () => {
    initOrders(seed);
    const bodies = mockGemini({ name: 'count_orders' });
    await askAssistant('How many orders?', context());

    const second = bodies[1] as { contents: { parts: Record<string, unknown>[] }[] };
    const response = second.contents
      .flatMap((turn) => turn.parts)
      .find((part) => 'functionResponse' in part) as {
      functionResponse: Record<string, unknown>;
    };
    expect('id' in response.functionResponse).toBe(false);
  });

  it('never puts the orders in the prompt', async () => {
    initOrders(seed);
    const bodies = mockGemini({ name: 'count_orders' });

    await askAssistant('How many orders?', context());

    // The only order-derived data that reaches the model is the single tool
    // result on the second leg - never an order id, never a line.
    const firstLeg = JSON.stringify(bodies[0]);
    expect(firstLeg).not.toContain('ORD-1001');
    expect(firstLeg).not.toContain('scrambled');
    expect(firstLeg).not.toContain('paymentMethod');
  });
});

describe('assistant error handling', () => {
  it('reports a missing key before making any request', async () => {
    vi.stubEnv('VITE_GEMINI_API_KEY', '');
    let reached = false;
    server.use(
      http.post(GEMINI, () => {
        reached = true;
        return HttpResponse.json({});
      }),
    );

    await expect(askAssistant('How many orders?', context())).rejects.toThrow(
      AssistantError,
    );
    await expect(askAssistant('How many orders?', context())).rejects.toThrow(
      /No Gemini API key/,
    );
    expect(reached).toBe(false);
  });

  it('reports an invalid key on a 400', async () => {
    server.use(
      http.post(GEMINI, () =>
        HttpResponse.json(
          { error: { message: 'API key not valid. Please pass a valid API key.' } },
          { status: 400 },
        ),
      ),
    );
    await expect(askAssistant('How many orders?', context())).rejects.toThrow(
      /rejected this API key/,
    );
  });

  it('reports a quota error on a 429', async () => {
    server.use(
      http.post(GEMINI, () =>
        HttpResponse.json(
          { error: { message: 'Resource has been exhausted' } },
          { status: 429 },
        ),
      ),
    );
    await expect(askAssistant('How many orders?', context())).rejects.toThrow(
      /free Gemini quota/,
    );
  });

  it('reports a network failure', async () => {
    server.use(http.post(GEMINI, () => HttpResponse.error()));
    await expect(askAssistant('How many orders?', context())).rejects.toThrow(
      /Could not reach Gemini/,
    );
  });

  it('names a retired model id on a 404', async () => {
    // gemini-2.0-flash was shut down on 1 June 2026; the id that ships
    // today will be retired too, and this is the message that says so.
    server.use(
      http.post(GEMINI, () =>
        HttpResponse.json(
          { error: { message: 'models/gemini-2.0-flash is not found' } },
          { status: 404 },
        ),
      ),
    );
    await expect(askAssistant('How many orders?', context())).rejects.toThrow(
      /model is not available for this key/,
    );
  });

  it('reports a blocked prompt', async () => {
    server.use(
      http.post(GEMINI, () =>
        HttpResponse.json({ promptFeedback: { blockReason: 'SAFETY' } }),
      ),
    );
    await expect(askAssistant('How many orders?', context())).rejects.toThrow(
      /declined to answer/,
    );
  });

  it('sends the key in a header, never in the URL', async () => {
    const seen: { url: string; header: string | null }[] = [];
    server.use(
      http.post(GEMINI, ({ request }) => {
        seen.push({
          url: request.url,
          header: request.headers.get('x-goog-api-key'),
        });
        return HttpResponse.json({
          candidates: [{ content: { role: 'model', parts: [{ text: 'ok' }] } }],
        });
      }),
    );

    await askAssistant('How many orders?', context());
    expect(seen).toHaveLength(1);
    // A key in a query string ends up in logs and in history.
    expect(seen[0]?.url).not.toMatch(/key=/);
    expect(seen[0]?.url).not.toMatch(/AIza/);
    expect(seen[0]?.header).toMatch(/^AIza/);
  });
});
