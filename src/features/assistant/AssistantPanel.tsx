import { useState } from 'react';

import type { Menu, StoredOrder } from '@/domain/types';
import { AssistantError, ASSISTANT_ERROR_MESSAGE } from './gemini';
import { askAssistant } from './askAssistant';
import { TOOLS } from './tools';

export interface ChatTurn {
  readonly id: number;
  readonly role: 'user' | 'assistant';
  readonly text: string;
  readonly toolName?: string | null;
  /** False when no tool answered, so the panel can say so. */
  readonly grounded?: boolean;
}

const SUGGESTIONS: readonly string[] = [
  'How many orders?',
  'What is our total revenue?',
  'What is our best-selling option?',
  'Which payment method brought in the most money?',
  'How many orders actually got the coupon?',
  'Who is our best customer?',
];

/**
 * The staff chat panel (Part F).
 *
 * Answers reflect new checkouts immediately because `orders` is passed in
 * from the live store on every render - there is no cached copy and no
 * reload (TC-18).
 */
export function AssistantPanel(props: {
  readonly menu: Menu;
  readonly orders: readonly StoredOrder[];
}) {
  const [turns, setTurns] = useState<readonly ChatTurn[]>([]);
  const [question, setQuestion] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const ask = async (text: string): Promise<void> => {
    const trimmed = text.trim();
    if (trimmed.length === 0 || busy) return;

    setQuestion('');
    setError(null);
    setBusy(true);
    setTurns((current) => [
      ...current,
      { id: current.length, role: 'user', text: trimmed },
    ]);

    try {
      const answer = await askAssistant(trimmed, {
        orders: props.orders,
        menu: props.menu,
      });
      setTurns((current) => [
        ...current,
        {
          id: current.length,
          role: 'assistant',
          text: answer.text,
          toolName: answer.toolName,
          grounded: answer.grounded,
        },
      ]);
    } catch (cause) {
      setError(
        cause instanceof AssistantError
          ? cause.message
          : ASSISTANT_ERROR_MESSAGE.unknown,
      );
    } finally {
      setBusy(false);
    }
  };

  return (
    <section>
      <h2 className="text-lg font-semibold">Sales assistant</h2>
      <p className="mt-1 text-xs" style={{ color: 'var(--text-muted)' }}>
        Ask about sales in plain English or Bangla. Every figure is computed
        by {TOOLS.length} local functions over the {props.orders.length} stored
        orders — the model only phrases the result and never sees the orders.
      </p>

      <ul className="mt-3 space-y-2" aria-live="polite">
        {turns.map((turn) => (
          <li
            key={turn.id}
            className="rounded-lg px-3 py-2 text-sm"
            style={{
              background:
                turn.role === 'user' ? 'var(--surface-muted)' : 'transparent',
              borderLeft:
                turn.role === 'assistant' ? '2px solid var(--accent)' : undefined,
            }}
          >
            <p>{turn.text}</p>
            {turn.role === 'assistant' && (
              <p className="mt-1 text-xs" style={{ color: 'var(--text-muted)' }}>
                {turn.grounded === true
                  ? `computed by ${turn.toolName}()`
                  : 'no tool could answer this — no figure was taken from the model'}
              </p>
            )}
          </li>
        ))}
        {busy && (
          <li className="text-sm" style={{ color: 'var(--text-muted)' }}>
            Thinking…
          </li>
        )}
      </ul>

      {error !== null && (
        <p
          className="mt-3 rounded-lg px-3 py-2 text-sm"
          style={{ background: 'var(--surface-muted)', color: 'var(--danger)' }}
          role="alert"
        >
          {error}
        </p>
      )}

      <form
        className="mt-3 flex gap-2"
        onSubmit={(event) => {
          event.preventDefault();
          void ask(question);
        }}
      >
        <input
          value={question}
          onChange={(event) => setQuestion(event.target.value)}
          placeholder="How many orders today?"
          aria-label="Ask the sales assistant"
          className="flex-1 rounded-lg border px-3 py-2 text-sm"
          style={{ borderColor: 'var(--border)', background: 'var(--surface)' }}
        />
        <button
          type="submit"
          disabled={busy || question.trim().length === 0}
          className="rounded-lg px-4 py-2 text-sm font-medium disabled:opacity-50"
          style={{ background: 'var(--accent)', color: 'var(--surface)' }}
        >
          Ask
        </button>
      </form>

      <div className="mt-3 flex flex-wrap gap-1.5">
        {SUGGESTIONS.map((suggestion) => (
          <button
            key={suggestion}
            type="button"
            disabled={busy}
            onClick={() => void ask(suggestion)}
            className="rounded-full border px-2.5 py-1 text-xs disabled:opacity-50"
            style={{ borderColor: 'var(--border)', color: 'var(--text-muted)' }}
          >
            {suggestion}
          </button>
        ))}
      </div>
    </section>
  );
}
