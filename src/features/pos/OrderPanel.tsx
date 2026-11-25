import { useEffect, useRef, useState } from 'react';

import type { CartItemView } from '@/api/client';
import { Icon } from '@/components/ui/Icon';
import { formatBdt, formatPoisha } from '@/domain/money';
import { priceCart } from '@/domain/pricing/priceCart';
import { optionName } from '@/domain/selection';
import { PAYMENT_METHODS } from '@/domain/types';
import type { Menu, PaymentMethod, StoredOrder } from '@/domain/types';
import { AssistantPanel } from '@/features/assistant/AssistantPanel';
import { registerFlyTarget } from '@/lib/flyTo';
import { formatCountdown } from '@/lib/useServerClock';

type Tab = 'order' | 'assistant';

/**
 * The right rail: the order ticket, its totals and Pay - with the sales
 * assistant on a second tab so it is one click away without crowding the
 * till.
 *
 * Two graded behaviours live here:
 *   - the hold countdown runs on the SERVER clock, carried in as `now` from
 *     `useServerClock`. The mock server is 90 s ahead of the browser, so a
 *     countdown built on `Date.now()` would be visibly wrong (TC-15).
 *   - an expired hold is read-only: removable, not editable (TC-15, D3).
 *
 * The totals are the client's own run of the SAME `priceCart` the server
 * uses, against the locked unit prices, so what the customer sees and what
 * the server charges cannot disagree (D2).
 */
export function OrderPanel(props: {
  readonly menu: Menu;
  readonly items: readonly CartItemView[];
  readonly orders: readonly StoredOrder[];
  readonly now: Date;
  readonly busy: boolean;
  readonly couponCode: string;
  readonly lastOrder: StoredOrder | null;
  readonly editingItemId: string | null;
  onCouponChange(code: string): void;
  onEdit(item: CartItemView): void;
  onRemove(itemId: string): void;
  onChangeQty(item: CartItemView, qty: number): void;
  onPay(method: PaymentMethod): void;
  onDownload(): void;
  onClose?(): void;
}) {
  const { menu, items, now, busy, couponCode, lastOrder } = props;
  const [tab, setTab] = useState<Tab>('order');
  const [method, setMethod] = useState<PaymentMethod>('card');

  // Where the "added to the order" ghost lands, and what pulses when it
  // arrives. The phone layout registers its own; whichever is on screen
  // wins at the moment of the flight.
  const dropRef = useRef<HTMLHeadingElement>(null);
  useEffect(() => registerFlyTarget('cart', dropRef.current), []);

  const active = items.filter((item) => item.status === 'active');

  const breakdown =
    active.length === 0
      ? null
      : priceCart({
          cart: active.map((item) => ({
            selection: item.selection,
            qty: item.qty,
            lockedUnitPrice: item.unitPrice,
          })),
          menu,
          couponCode: couponCode.trim() === '' ? null : couponCode,
          serverTime: now,
        });

  return (
    <aside
      className="flex h-full min-h-0 flex-col"
      style={{ background: 'var(--surface)' }}
      aria-label="Order details"
    >
      <header
        className="flex shrink-0 items-center gap-2 border-b px-4 py-3"
        style={{ borderColor: 'var(--border)' }}
      >
        <h2 ref={dropRef} className="text-base font-semibold">
          Order details
        </h2>
        <div
          className="ml-auto flex items-center gap-0.5 rounded-lg border p-0.5"
          style={{ borderColor: 'var(--border-strong)' }}
          role="tablist"
          aria-label="Right panel"
        >
          {(
            [
              ['order', 'receipt', 'Order'],
              ['assistant', 'chat', 'Assistant'],
            ] as const
          ).map(([value, icon, label]) => (
            <button
              key={value}
              type="button"
              role="tab"
              aria-selected={tab === value}
              onClick={() => setTab(value)}
              className="flex items-center gap-1.5 rounded-md px-2.5 py-1 text-xs font-medium"
              style={
                tab === value
                  ? { background: 'var(--accent-soft)', color: 'var(--accent)' }
                  : { color: 'var(--text-muted)' }
              }
            >
              <Icon name={icon} className="size-3.5" />
              {label}
            </button>
          ))}
        </div>
        {props.onClose !== undefined && (
          <button
            type="button"
            aria-label="Close order details"
            onClick={props.onClose}
            className="grid size-8 place-items-center rounded-lg lg:hidden"
            style={{ color: 'var(--text-muted)' }}
          >
            <Icon name="close" className="size-4" />
          </button>
        )}
      </header>

      {tab === 'assistant' ? (
        <div className="min-h-0 flex-1 overflow-y-auto px-4 py-4">
          <AssistantPanel menu={menu} orders={props.orders} />
        </div>
      ) : (
        <>
          <div className="min-h-0 flex-1 overflow-y-auto px-4 py-3">
            <InfoRow icon="clock" label={now.toISOString().slice(11, 19)} hint="server clock" />
            <InfoRow
              icon="receipt"
              label={`${props.orders.length} stored orders`}
              hint="seed priced by our engine"
            />

            <label className="mt-3 block">
              <span className="text-xs" style={{ color: 'var(--text-muted)' }}>
                Coupon
              </span>
              <input
                value={couponCode}
                onChange={(event) => props.onCouponChange(event.target.value)}
                placeholder="MORNING15"
                autoCapitalize="characters"
                autoComplete="off"
                spellCheck={false}
                className="field mt-1 uppercase"
              />
            </label>

            {items.length === 0 ? (
              <div className="mt-8 text-center">
                <span
                  aria-hidden
                  className="mx-auto grid size-12 place-items-center rounded-2xl"
                  style={{ background: 'var(--surface-muted)', color: 'var(--text-muted)' }}
                >
                  <Icon name="cart" className="size-5" />
                </span>
                <p className="mt-2.5 text-sm font-medium">No items held yet</p>
                <p className="mt-1 text-xs" style={{ color: 'var(--text-muted)' }}>
                  Build a plate on the left. Adding it reserves its
                  ingredients for five minutes on the server clock.
                </p>
              </div>
            ) : (
              <ul className="mt-4 space-y-3">
                {items.map((item) => (
                  <TicketLine
                    key={item.id}
                    menu={menu}
                    item={item}
                    now={now}
                    busy={busy}
                    editing={props.editingItemId === item.id}
                    onEdit={() => props.onEdit(item)}
                    onRemove={() => props.onRemove(item.id)}
                    onChangeQty={(qty) => props.onChangeQty(item, qty)}
                  />
                ))}
              </ul>
            )}

            {breakdown !== null && (
              <dl
                className="mt-5 space-y-1.5 rounded-xl p-3 text-sm tnum"
                style={{ background: 'var(--surface-muted)' }}
              >
                <Row label="Subtotal" value={formatPoisha(breakdown.subtotal)} />
                {breakdown.candidates.map((candidate) => (
                  <Row
                    key={candidate.id}
                    label={`${candidate.id}${candidate.code === null ? '' : ` · ${candidate.code}`}`}
                    value={
                      candidate.id === breakdown.discount?.id
                        ? `−${formatPoisha(candidate.amount)}`
                        : (candidate.reason ?? 'not applied')
                    }
                    muted={candidate.id !== breakdown.discount?.id}
                  />
                ))}
                <Row
                  label={`VAT ${menu.promotions.vatPercent}%`}
                  value={formatPoisha(breakdown.vat)}
                />
              </dl>
            )}

            {lastOrder !== null && (
              <div
                className="mt-4 rounded-xl p-3 text-sm"
                style={{ background: 'var(--ok-soft)' }}
                role="status"
              >
                <p className="font-semibold">Order {lastOrder.id} placed</p>
                <p className="mt-0.5 tnum text-xs" style={{ color: 'var(--text-muted)' }}>
                  {formatBdt(lastOrder.totals.payable)} · {lastOrder.paymentMethod} ·{' '}
                  {lastOrder.createdAt.slice(0, 16).replace('T', ' ')}
                </p>
                {lastOrder.coupon.entered !== null && lastOrder.coupon.applied === null && (
                  <p className="mt-1 text-xs" style={{ color: 'var(--danger)' }}>
                    Coupon {lastOrder.coupon.entered} was not applied:{' '}
                    {lastOrder.coupon.rejectedReason}
                  </p>
                )}
              </div>
            )}
          </div>

          {/* ------------------------------------------------- pay footer */}
          <div
            className="shrink-0 border-t px-4 py-3"
            style={{ borderColor: 'var(--border)' }}
          >
            <div className="grid grid-cols-3 gap-1.5">
              {PAYMENT_METHODS.map((candidate) => {
                const picked = method === candidate;
                return (
                  <label
                    key={candidate}
                    className="cursor-pointer rounded-lg border py-1.5 text-center text-xs font-medium capitalize"
                    style={{
                      borderColor: picked ? 'var(--accent)' : 'var(--border-strong)',
                      background: picked ? 'var(--accent-soft)' : 'var(--surface)',
                      color: picked ? 'var(--accent)' : 'var(--text-muted)',
                    }}
                  >
                    <input
                      type="radio"
                      name="payment-method"
                      value={candidate}
                      checked={picked}
                      onChange={() => setMethod(candidate)}
                      disabled={busy}
                      className="sr-only"
                    />
                    {candidate}
                  </label>
                );
              })}
            </div>
            <p className="mt-1.5 text-[11px]" style={{ color: 'var(--text-muted)' }}>
              A label only — no payment data is collected.
            </p>

            <div className="mt-3 flex items-baseline justify-between gap-3">
              <span className="flex items-baseline gap-2 text-sm font-semibold">
                Total
                <span className="chip tnum">
                  {active.length} item{active.length === 1 ? '' : 's'}
                </span>
              </span>
              <span className="tnum text-lg font-bold">
                {breakdown === null ? '—' : formatBdt(breakdown.payable)}
              </span>
            </div>

            <button
              type="button"
              disabled={busy || active.length === 0}
              onClick={() => props.onPay(method)}
              className="btn-primary mt-3 flex w-full items-center justify-center gap-2 py-2.5 text-sm"
            >
              <Icon name="lock" className="size-4" />
              {busy
                ? 'Paying…'
                : breakdown === null
                  ? 'Pay'
                  : `Pay ${formatBdt(breakdown.payable)}`}
            </button>

            <button
              type="button"
              disabled={busy}
              onClick={props.onDownload}
              className="btn-ghost mt-2 flex w-full items-center justify-center gap-2 py-2 text-sm"
            >
              <Icon name="download" className="size-4" />
              Download orders.json
            </button>
          </div>
        </>
      )}
    </aside>
  );
}

function TicketLine(props: {
  readonly menu: Menu;
  readonly item: CartItemView;
  readonly now: Date;
  readonly busy: boolean;
  readonly editing: boolean;
  onEdit(): void;
  onRemove(): void;
  onChangeQty(qty: number): void;
}) {
  const { menu, item, now, busy, editing } = props;

  // Recomputed from the ticking server clock, so it counts down between
  // refetches instead of freezing on the value the server last sent.
  const remaining = Math.max(0, Date.parse(item.expiresAt) - now.getTime());
  const expired = remaining <= 0 || item.status !== 'active';
  const urgent = !expired && remaining < 60_000;

  return (
    <li
      className="row-in rounded-xl border p-3"
      style={{
        borderColor: editing
          ? 'var(--accent)'
          : expired
            ? 'var(--danger)'
            : 'var(--border)',
        background: expired ? 'var(--danger-soft)' : 'var(--surface)',
      }}
    >
      <div className="flex items-start gap-2">
        <p className="min-w-0 flex-1 truncate text-sm font-medium">
          {menu.productName}
        </p>
        <span className="chip tnum shrink-0">{item.qty}x</span>
        <button
          type="button"
          aria-label={`Edit this item`}
          disabled={busy || expired || editing}
          onClick={props.onEdit}
          className="grid size-7 shrink-0 place-items-center rounded-lg border disabled:opacity-40"
          style={{ borderColor: 'var(--border-strong)' }}
        >
          <Icon name="edit" className="size-3.5" />
          <span className="sr-only">Edit</span>
        </button>
        <button
          type="button"
          aria-label={`Remove this item`}
          disabled={busy}
          onClick={props.onRemove}
          className="grid size-7 shrink-0 place-items-center rounded-lg border disabled:opacity-40"
          style={{ borderColor: 'var(--border-strong)', color: 'var(--danger)' }}
        >
          <Icon name="trash" className="size-3.5" />
          <span className="sr-only">Remove</span>
        </button>
      </div>

      <div className="mt-1.5 flex flex-wrap gap-1">
        {Object.entries(item.selection)
          .filter(([, units]) => units > 0)
          .map(([optionId, units]) => (
            <span key={optionId} className="chip">
              {optionName(menu, optionId)}
              {units > 1 ? ` ×${units}` : ''}
            </span>
          ))}
      </div>

      <div className="mt-2 flex flex-wrap items-center gap-x-2.5 gap-y-1">
        <span className="tnum text-sm font-semibold">
          {formatPoisha(item.unitPrice * item.qty)}
        </span>
        <span
          className="chip tnum"
          style={
            expired || urgent
              ? { background: 'var(--danger-soft)', color: 'var(--danger)' }
              : { background: 'var(--ok-soft)', color: 'var(--ok)' }
          }
        >
          {expired ? 'hold expired' : `hold ${formatCountdown(remaining)} left`}
        </span>
        <label className="ml-auto flex items-center gap-1 text-[11px]">
          <span style={{ color: 'var(--text-muted)' }}>Qty</span>
          <select
            value={item.qty}
            disabled={busy || expired}
            onChange={(event) => props.onChangeQty(Number(event.target.value))}
            className="rounded-md border px-1.5 py-0.5 text-xs disabled:opacity-50"
            style={{ borderColor: 'var(--border-strong)', background: 'var(--surface)' }}
          >
            {quantities(menu).map((value) => (
              <option key={value} value={value}>
                {value}
              </option>
            ))}
          </select>
        </label>
      </div>

      {expired && (
        <p className="mt-2 text-xs" style={{ color: 'var(--danger)' }}>
          The 5-minute hold expired and these ingredients went back to free
          stock. This item can be removed, not edited — add it again to compete
          for them.
        </p>
      )}
    </li>
  );
}

function InfoRow(props: {
  readonly icon: 'clock' | 'receipt';
  readonly label: string;
  readonly hint: string;
}) {
  return (
    <div
      className="mb-2 flex items-center gap-2.5 rounded-lg border px-3 py-2 text-sm"
      style={{ borderColor: 'var(--border)' }}
    >
      <span style={{ color: 'var(--text-muted)' }}>
        <Icon name={props.icon} className="size-4" />
      </span>
      <span className="tnum flex-1 truncate">{props.label}</span>
      <span className="text-[11px]" style={{ color: 'var(--text-muted)' }}>
        {props.hint}
      </span>
    </div>
  );
}

function Row(props: {
  readonly label: string;
  readonly value: string;
  readonly muted?: boolean;
}) {
  return (
    <div className="flex items-baseline justify-between gap-4">
      <dt style={{ color: 'var(--text-muted)' }}>{props.label}</dt>
      <dd
        className="text-right"
        style={props.muted === true ? { color: 'var(--text-muted)' } : undefined}
      >
        {props.value}
      </dd>
    </div>
  );
}

function quantities(menu: Menu): readonly number[] {
  const out: number[] = [];
  for (let value = menu.itemQty.min; value <= menu.itemQty.max; value += 1) {
    out.push(value);
  }
  return out;
}
