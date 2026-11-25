import { useEffect, useState } from 'react';

import { api } from './api/client';
import { downloadOrders } from './features/checkout/downloadOrders';
import { formatBdt } from './domain/money';
import { formatInZone } from './domain/time';
import { SERVER_TIME_ZONE } from './server/clock';
import type { IngredientId, Menu } from './domain/types';

interface Loaded {
  readonly menu: Menu;
  readonly available: Readonly<Record<IngredientId, number>>;
}

/**
 * Shell screen. It loads the menu and the stock over the mock API, which is
 * the proof that nothing is hardcoded in the UI: swap the fixture on the
 * server and this screen changes with it.
 *
 * The configurator, cart, checkout and assistant panels replace this as
 * Parts A to F land.
 */
export default function App() {
  const [loaded, setLoaded] = useState<Loaded | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [orderCount, setOrderCount] = useState<number | null>(null);
  const [exporting, setExporting] = useState(false);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const [{ menu }, { available }, { orders }] = await Promise.all([
          api.getMenu(),
          api.getStock(),
          api.getOrders(),
        ]);
        if (!cancelled) {
          setLoaded({ menu, available });
          setOrderCount(orders.length);
        }
      } catch (cause) {
        if (!cancelled) {
          setError(cause instanceof Error ? cause.message : 'Failed to load the menu');
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  if (error !== null) {
    return (
      <main className="mx-auto max-w-3xl p-4">
        <p style={{ color: 'var(--danger)' }}>{error}</p>
      </main>
    );
  }

  if (loaded === null) {
    return (
      <main className="mx-auto max-w-3xl p-4">
        <p style={{ color: 'var(--text-muted)' }}>Starting the mock server…</p>
      </main>
    );
  }

  const { menu, available } = loaded;

  return (
    <main className="mx-auto max-w-4xl px-4 py-8">
      <header className="mb-8">
        <p className="text-xs uppercase tracking-wide" style={{ color: 'var(--text-muted)' }}>
          Smart Order Builder · fixture {menu.version}
        </p>
        <h1 className="mt-1 text-2xl font-semibold">{menu.productName}</h1>
        <p className="mt-1 text-sm tnum" style={{ color: 'var(--text-muted)' }}>
          Base {formatBdt(menu.basePrice)} · server clock{' '}
          {formatInZone(api.serverNow(), SERVER_TIME_ZONE)} ({SERVER_TIME_ZONE})
        </p>
      </header>

      <section className="space-y-5">
        {menu.groups.map((group) => (
          <article
            key={group.id}
            className="rounded-xl border p-4"
            style={{ borderColor: 'var(--border)', background: 'var(--surface-muted)' }}
          >
            <div className="flex flex-wrap items-baseline justify-between gap-2">
              <h2 className="font-medium">{group.name}</h2>
              <p className="text-xs tnum" style={{ color: 'var(--text-muted)' }}>
                {describeLimits(group.limits)}
              </p>
            </div>
            <ul className="mt-3 grid gap-2 sm:grid-cols-2">
              {group.options.map((option) => (
                <li
                  key={option.id}
                  className="flex items-baseline justify-between gap-3 rounded-lg px-3 py-2 text-sm"
                  style={{ background: 'var(--surface)' }}
                >
                  <span>{option.name}</span>
                  <span className="tnum" style={{ color: 'var(--text-muted)' }}>
                    {formatBdt(option.price)} · {describeUses(option.uses, available)}
                  </span>
                </li>
              ))}
            </ul>
          </article>
        ))}
      </section>

      <section className="mt-10">
        <h2 className="text-sm font-medium uppercase tracking-wide" style={{ color: 'var(--text-muted)' }}>
          Orders
        </h2>
        <div className="mt-3 flex flex-wrap items-center gap-3">
          <p className="text-sm tnum" style={{ color: 'var(--text-muted)' }}>
            {orderCount === null
              ? 'Loading the order store…'
              : `${orderCount} order${orderCount === 1 ? '' : 's'} in the store (seed orders priced by our own engine)`}
          </p>
          <button
            type="button"
            disabled={exporting || orderCount === null}
            onClick={() => {
              setExporting(true);
              void downloadOrders()
                .catch((cause: unknown) =>
                  setError(
                    cause instanceof Error ? cause.message : 'Export failed',
                  ),
                )
                .finally(() => setExporting(false));
            }}
            className="rounded-lg px-3 py-1.5 text-sm font-medium disabled:opacity-50"
            style={{ background: 'var(--accent)', color: 'var(--surface)' }}
          >
            {exporting ? 'Preparing…' : 'Download orders.json'}
          </button>
        </div>
      </section>

      <section className="mt-10">
        <h2 className="text-sm font-medium uppercase tracking-wide" style={{ color: 'var(--text-muted)' }}>
          Build status
        </h2>
        <ul className="mt-3 space-y-1 text-sm">
          {BUILD_STATUS.map((entry) => (
            <li key={entry.part} className="flex gap-3">
              <span aria-hidden style={{ color: entry.done ? 'var(--ok)' : 'var(--text-muted)' }}>
                {entry.done ? '✓' : '○'}
              </span>
              <span>
                <strong className="font-medium">{entry.part}</strong> — {entry.label}
              </span>
            </li>
          ))}
        </ul>
      </section>
    </main>
  );
}

const BUILD_STATUS: readonly { part: string; label: string; done: boolean }[] = [
  { part: 'A', label: 'Rules engine, TC-01 to TC-04', done: true },
  { part: 'B', label: 'Shared stock and net-difference edits, TC-08 to TC-11', done: true },
  { part: 'C', label: 'Pricing engine, TC-05 to TC-07', done: true },
  { part: 'C', label: 'Async price preview, TC-12', done: false },
  { part: 'D', label: 'Cart and reservations, TC-13 to TC-15', done: true },
  { part: 'E', label: 'Checkout and orders JSON, TC-16 to TC-17', done: true },
  { part: 'F', label: 'Sales assistant, TC-18 to TC-20', done: false },
  { part: 'G', label: 'Bonus — only after A to F', done: false },
];

function describeLimits(limits: Menu['groups'][number]['limits']): string {
  const parts: string[] = [];
  if (limits.min !== undefined) parts.push(`min ${limits.min}`);
  if (limits.max !== undefined) parts.push(`max ${limits.max}`);
  if (limits.step !== undefined) parts.push(`step ${limits.step}`);
  if (limits.maxDistinct !== undefined) parts.push(`max ${limits.maxDistinct} distinct`);
  if (limits.maxPerOption !== undefined) parts.push(`max ${limits.maxPerOption} each`);
  return parts.join(' · ');
}

function describeUses(
  uses: Readonly<Record<IngredientId, number>>,
  available: Readonly<Record<IngredientId, number>>,
): string {
  const entries = Object.entries(uses);
  if (entries.length === 0) return 'no stock';
  return entries
    .map(([id, perUnit]) => `${perUnit} ${id} (${available[id] ?? 0} left)`)
    .join(', ');
}
