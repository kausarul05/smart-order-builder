import type { CartItemView } from '@/api/client';
import { formatBdt } from '@/domain/money';
import { optionName } from '@/domain/selection';
import type { Menu } from '@/domain/types';
import { formatCountdown } from '@/lib/useServerClock';

/**
 * The cart. Two things here are graded:
 *
 *   - the countdown runs on the SERVER clock, which `now` carries in from
 *     `useServerClock`. The mock server is 90 s ahead of the browser, so a
 *     countdown built on `Date.now()` would be visibly wrong (TC-15).
 *   - once a hold expires the item is read-only: it can be removed, not
 *     edited (TC-15, D3).
 */
export function CartPanel(props: {
  readonly menu: Menu;
  readonly items: readonly CartItemView[];
  readonly now: Date;
  readonly busy: boolean;
  readonly editingItemId: string | null;
  onEdit(item: CartItemView): void;
  onRemove(itemId: string): void;
  onChangeQty(item: CartItemView, qty: number): void;
}) {
  const { menu, items, now, busy } = props;

  if (items.length === 0) {
    return (
      <section>
        <h2 className="text-lg font-semibold">Cart</h2>
        <p className="mt-2 text-sm" style={{ color: 'var(--text-muted)' }}>
          Nothing held yet. Each item reserves its ingredients for 5 minutes.
        </p>
      </section>
    );
  }

  return (
    <section>
      <h2 className="text-lg font-semibold">Cart</h2>
      <ul className="mt-3 space-y-3">
        {items.map((item) => {
          // Recomputed from the ticking server clock, not from the value the
          // server sent, so it counts down between refetches.
          const remaining = Math.max(0, Date.parse(item.expiresAt) - now.getTime());
          const expired = remaining <= 0 || item.status !== 'active';
          const editing = props.editingItemId === item.id;

          return (
            <li
              key={item.id}
              className="rounded-xl border p-4"
              style={{
                borderColor: editing ? 'var(--accent)' : 'var(--border)',
                opacity: expired ? 0.7 : 1,
              }}
            >
              <div className="flex flex-wrap items-baseline justify-between gap-2">
                <p className="text-sm">{describeSelection(menu, item)}</p>
                <p className="tnum text-sm font-medium">
                  {formatBdt(item.unitPrice * item.qty)}
                </p>
              </div>

              <div
                className="mt-2 flex flex-wrap items-center gap-3 text-xs"
                style={{ color: 'var(--text-muted)' }}
              >
                <span className="tnum">
                  {formatBdt(item.unitPrice)} each · locked at{' '}
                  {item.pricedAt.slice(11, 19)}
                </span>
                <span className="tnum" aria-live="off">
                  {expired ? (
                    <strong style={{ color: 'var(--danger)' }}>hold expired</strong>
                  ) : (
                    <>hold {formatCountdown(remaining)} left</>
                  )}
                </span>
                <span>v{item.version}</span>
              </div>

              {expired && (
                <p className="mt-2 text-xs" style={{ color: 'var(--danger)' }}>
                  The 5-minute hold expired and these ingredients went back to
                  free stock. This item can be removed, not edited — add it
                  again to compete for them.
                </p>
              )}

              <div className="mt-3 flex flex-wrap items-center gap-2">
                <label className="flex items-center gap-1 text-xs">
                  <span style={{ color: 'var(--text-muted)' }}>Qty</span>
                  <select
                    value={item.qty}
                    disabled={busy || expired}
                    onChange={(event) =>
                      props.onChangeQty(item, Number(event.target.value))
                    }
                    className="rounded-md border px-2 py-1 text-xs disabled:opacity-50"
                    style={{ borderColor: 'var(--border)', background: 'var(--surface)' }}
                  >
                    {quantities(menu).map((value) => (
                      <option key={value} value={value}>
                        {value}
                      </option>
                    ))}
                  </select>
                </label>

                <button
                  type="button"
                  disabled={busy || expired || editing}
                  onClick={() => props.onEdit(item)}
                  className="rounded-md border px-3 py-1 text-xs disabled:opacity-50"
                  style={{ borderColor: 'var(--border)' }}
                >
                  {editing ? 'Editing…' : 'Edit'}
                </button>

                <button
                  type="button"
                  disabled={busy}
                  onClick={() => props.onRemove(item.id)}
                  className="rounded-md border px-3 py-1 text-xs disabled:opacity-50"
                  style={{ borderColor: 'var(--border)', color: 'var(--danger)' }}
                >
                  Remove
                </button>
              </div>
            </li>
          );
        })}
      </ul>
    </section>
  );
}

function describeSelection(menu: Menu, item: CartItemView): string {
  const parts = Object.entries(item.selection)
    .filter(([, units]) => units > 0)
    .map(([optionId, units]) =>
      units === 1 ? optionName(menu, optionId) : `${optionName(menu, optionId)} ×${units}`,
    );
  return `${item.qty} × [${parts.join(', ')}]`;
}

function quantities(menu: Menu): readonly number[] {
  const out: number[] = [];
  for (let value = menu.itemQty.min; value <= menu.itemQty.max; value += 1) {
    out.push(value);
  }
  return out;
}
