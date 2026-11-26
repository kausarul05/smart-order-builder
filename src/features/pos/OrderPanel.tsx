import { useEffect, useRef, useState } from 'react';

import type { CartItemView } from '@/api/client';
import { Icon } from '@/components/ui/Icon';
import { formatBdt, formatPoisha } from '@/domain/money';
import { priceCart } from '@/domain/pricing/priceCart';
import { indexOptions, optionName } from '@/domain/selection';
import { PAYMENT_METHODS } from '@/domain/types';
import type { Menu, PaymentMethod, Selection, StoredOrder } from '@/domain/types';
import { registerFlyTarget } from '@/lib/flyTo';
import { collapseAway, useFlipList } from '@/lib/motion';
import { formatCountdown } from '@/lib/useServerClock';
import { RESERVATION_TTL_MS, SERVER_TIME_ZONE } from '@/server/clock';

/**
 * The till's right rail: what is held, what it costs, and Pay.
 *
 * Two graded behaviours live here:
 *   - the hold countdown runs on the SERVER clock, carried in as `now`
 *     from `useServerClock`. The mock server is 90 s ahead of the browser,
 *     so a countdown built on `Date.now()` would be visibly wrong (TC-15).
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
  const [method, setMethod] = useState<PaymentMethod>('card');

  // Where the "added to the order" ghost lands, and what pulses when it
  // arrives. The phone layout registers its own target too; whichever is
  // on screen wins at the moment of the flight.
  const dropRef = useRef<HTMLSpanElement>(null);
  useEffect(() => registerFlyTarget('cart', dropRef.current), []);

  // Rows slide to their new places when one leaves, rather than snapping.
  const listRef = useFlipList<HTMLUListElement>(items.map((item) => item.id).join('|'));

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

  const coupon = breakdown?.candidates.find((candidate) => candidate.kind === 'coupon');
  const couponApplied = coupon !== undefined && coupon.id === breakdown?.discount?.id;

  return (
    <aside
      className="flex h-full min-h-0 flex-col"
      style={{ background: 'var(--surface)' }}
      aria-label="Order details"
    >
      {/* ------------------------------------------------------- header */}
      <header
        className="flex shrink-0 items-center gap-2.5 border-b px-4 py-3.5"
        style={{ borderColor: 'var(--border)' }}
      >
        <span
          ref={dropRef}
          aria-hidden
          className="grid size-9 shrink-0 place-items-center rounded-xl"
          style={{ background: 'var(--accent-soft)', color: 'var(--accent)' }}
        >
          <Icon name="receipt" className="size-[18px]" />
        </span>
        <div className="min-w-0 flex-1">
          <h2 className="text-base font-semibold leading-tight">Order details</h2>
          <p className="tnum truncate text-[11px]" style={{ color: 'var(--text-muted)' }}>
            {active.length} held · {props.orders.length} stored ·{' '}
            {now.toLocaleTimeString('en-GB', {
              timeZone: SERVER_TIME_ZONE,
              hour: '2-digit',
              minute: '2-digit',
            })}{' '}
            server
          </p>
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

      {/* -------------------------------------------------------- items */}
      <div className="min-h-0 flex-1 overflow-y-auto px-4 py-3">
        {items.length === 0 ? (
          <EmptyTicket />
        ) : (
          <ul ref={listRef} className="space-y-2.5">
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

        {lastOrder !== null && (
          <div
            className="mt-4 rounded-xl p-3 text-sm"
            style={{ background: 'var(--ok-soft)' }}
            role="status"
          >
            <p className="flex items-center gap-1.5 font-semibold">
              <Icon name="receipt" className="size-4" />
              Order {lastOrder.id} placed
            </p>
            <p className="mt-0.5 tnum text-xs" style={{ color: 'var(--text-muted)' }}>
              {formatBdt(lastOrder.totals.payable)} · {lastOrder.paymentMethod} ·{' '}
              {lastOrder.createdAt.slice(11, 16)}
            </p>
            {lastOrder.coupon.entered !== null && lastOrder.coupon.applied === null && (
              <p className="mt-1 text-xs" style={{ color: 'var(--danger)' }}>
                {lastOrder.coupon.entered} was not applied:{' '}
                {lastOrder.coupon.rejectedReason}
              </p>
            )}
          </div>
        )}
      </div>

      {/* ------------------------------------------------------ checkout */}
      <div className="shrink-0 border-t" style={{ borderColor: 'var(--border)' }}>
        <div className="space-y-3 px-4 py-3">
          {/* Coupon, with its verdict inline rather than buried in totals. */}
          <div>
            <label className="relative block">
              <span className="sr-only">Coupon code</span>
              <input
                value={couponCode}
                onChange={(event) => props.onCouponChange(event.target.value)}
                placeholder="Coupon code"
                autoCapitalize="characters"
                autoComplete="off"
                spellCheck={false}
                className="field pr-20 uppercase"
              />
              {couponCode.trim() !== '' && breakdown !== null && (
                <span
                  className="chip absolute right-2 top-1/2 -translate-y-1/2"
                  style={
                    couponApplied
                      ? { background: 'var(--ok-soft)', color: 'var(--ok)' }
                      : { background: 'var(--danger-soft)', color: 'var(--danger)' }
                  }
                >
                  {couponApplied ? `−${formatPoisha(coupon.amount)}` : 'not applied'}
                </span>
              )}
            </label>
            {couponCode.trim() !== '' && !couponApplied && coupon?.reason != null && (
              <p className="mt-1 text-[11px]" style={{ color: 'var(--text-muted)' }}>
                {coupon.reason}
              </p>
            )}
          </div>

          {/* Totals. The line that is actually charged is the loud one. */}
          {breakdown !== null && (
            <dl className="space-y-1 text-sm tnum">
              <Row label="Subtotal" value={formatPoisha(breakdown.subtotal)} />
              {breakdown.discount !== null && (
                <Row
                  label={`Discount · ${breakdown.discount.id}`}
                  value={`−${formatPoisha(breakdown.discount.amount)}`}
                  tone="ok"
                />
              )}
              {breakdown.candidates
                .filter((candidate) => candidate.id !== breakdown.discount?.id)
                .map((candidate) => (
                  <Row
                    key={candidate.id}
                    label={candidate.id}
                    value={candidate.reason ?? 'not applied'}
                    muted
                  />
                ))}
              <Row
                label={`VAT ${menu.promotions.vatPercent}%`}
                value={formatPoisha(breakdown.vat)}
              />
            </dl>
          )}

          <div
            className="flex items-baseline justify-between gap-3 rounded-xl px-3 py-2.5"
            style={{ background: 'var(--surface-muted)' }}
          >
            <span className="flex items-baseline gap-2 text-sm font-semibold">
              Total
              <span className="chip tnum">
                {active.length} item{active.length === 1 ? '' : 's'}
              </span>
            </span>
            <span className="tnum text-xl font-bold">
              {breakdown === null ? '—' : formatBdt(breakdown.payable)}
            </span>
          </div>

          {/* Payment method: a label only, so it is a segmented control. */}
          <fieldset>
            <legend className="sr-only">Payment method</legend>
            <div
              className="grid grid-cols-3 gap-0.5 rounded-xl p-0.5"
              style={{ background: 'var(--surface-muted)' }}
            >
              {PAYMENT_METHODS.map((candidate) => {
                const picked = method === candidate;
                return (
                  <label
                    key={candidate}
                    className="cursor-pointer rounded-lg py-1.5 text-center text-xs font-medium capitalize transition-colors motion-reduce:transition-none"
                    style={
                      picked
                        ? {
                            background: 'var(--surface)',
                            color: 'var(--accent)',
                            boxShadow: 'var(--shadow-card)',
                          }
                        : { color: 'var(--text-muted)' }
                    }
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
            <p className="mt-1 text-[11px]" style={{ color: 'var(--text-muted)' }}>
              A label only — no payment data is collected.
            </p>
          </fieldset>

          <button
            type="button"
            disabled={busy || active.length === 0}
            onClick={() => props.onPay(method)}
            className="btn-primary flex w-full items-center justify-center gap-2 py-3 text-sm"
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
            className="flex w-full items-center justify-center gap-1.5 py-1 text-xs font-medium disabled:opacity-50"
            style={{ color: 'var(--text-muted)' }}
          >
            <Icon name="download" className="size-3.5" />
            Download orders.json
          </button>
        </div>
      </div>
    </aside>
  );
}

function EmptyTicket() {
  return (
    <div className="py-10 text-center">
      <span
        aria-hidden
        className="mx-auto grid size-14 place-items-center rounded-2xl"
        style={{ background: 'var(--surface-muted)', color: 'var(--text-muted)' }}
      >
        <Icon name="cart" className="size-6" />
      </span>
      <p className="mt-3 text-sm font-medium">No items held yet</p>
      <p
        className="mx-auto mt-1 max-w-[16rem] text-xs leading-relaxed"
        style={{ color: 'var(--text-muted)' }}
      >
        Build a plate on the left. Adding it reserves its ingredients for five
        minutes on the server clock.
      </p>
    </div>
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
  const rowRef = useRef<HTMLLIElement>(null);
  const [leaving, setLeaving] = useState(false);

  // Recomputed from the ticking server clock, so it counts down between
  // refetches instead of freezing on the value the server last sent.
  const remaining = Math.max(0, Date.parse(item.expiresAt) - now.getTime());
  const expired = remaining <= 0 || item.status !== 'active';
  const urgent = !expired && remaining < 60_000;

  /** Animate the row away first, then let React unmount it. */
  const remove = (): void => {
    if (leaving) return;
    setLeaving(true);
    void collapseAway(rowRef.current).then(props.onRemove);
  };

  return (
    <li
      ref={rowRef}
      data-flip-key={item.id}
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
      <div className="flex items-start gap-2.5">
        <HoldRing remaining={remaining} expired={expired} />

        <div className="min-w-0 flex-1">
          <p className="truncate text-sm font-semibold">
            {item.qty} × {menu.productName}
          </p>
          <p className="tnum mt-0.5 text-[11px]" style={{ color: 'var(--text-muted)' }}>
            {formatPoisha(item.unitPrice)} each · locked {item.pricedAt.slice(11, 16)}
          </p>
        </div>

        <p className="tnum shrink-0 text-sm font-bold">
          {formatPoisha(item.unitPrice * item.qty)}
        </p>
      </div>

      <div className="mt-2 flex items-center gap-2">
        <Thumbnails menu={menu} selection={item.selection} />
        <span
          className="chip tnum ml-auto"
          style={
            expired || urgent
              ? { background: 'var(--danger-soft)', color: 'var(--danger)' }
              : { background: 'var(--ok-soft)', color: 'var(--ok)' }
          }
        >
          {expired ? 'hold expired' : `hold ${formatCountdown(remaining)} left`}
        </span>
      </div>

      <div className="mt-2 flex flex-wrap gap-1">
        {Object.entries(item.selection)
          .filter(([, units]) => units > 0)
          .map(([optionId, units]) => (
            <span key={optionId} className="chip">
              {optionName(menu, optionId)}
              {units > 1 ? ` ×${units}` : ''}
            </span>
          ))}
      </div>

      {expired && (
        <p className="mt-2 text-xs" style={{ color: 'var(--danger)' }}>
          The 5-minute hold expired and these ingredients went back to free
          stock. This item can be removed, not edited — add it again to compete
          for them.
        </p>
      )}

      <div
        className="mt-2.5 flex items-center gap-1.5 border-t pt-2.5"
        style={{ borderColor: 'var(--border)' }}
      >
        <label className="flex items-center gap-1 text-[11px]">
          <span style={{ color: 'var(--text-muted)' }}>Qty</span>
          <select
            value={item.qty}
            disabled={busy || expired || leaving}
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

        <button
          type="button"
          aria-label="Edit this item"
          disabled={busy || expired || editing || leaving}
          onClick={props.onEdit}
          className="ml-auto flex items-center gap-1.5 rounded-lg border px-2.5 py-1 text-xs disabled:opacity-40"
          style={{ borderColor: 'var(--border-strong)' }}
        >
          <Icon name="edit" className="size-3.5" />
          {editing ? 'Editing' : 'Edit'}
        </button>
        <button
          type="button"
          aria-label="Remove this item"
          disabled={busy || leaving}
          onClick={remove}
          className="flex items-center gap-1.5 rounded-lg border px-2.5 py-1 text-xs disabled:opacity-40"
          style={{ borderColor: 'var(--border-strong)', color: 'var(--danger)' }}
        >
          <Icon name="trash" className="size-3.5" />
          Remove
        </button>
      </div>
    </li>
  );
}

/**
 * The five-minute hold as a ring. The words say how long is left; the ring
 * says how much of the hold has gone, which is what you read at a glance
 * across a counter.
 */
function HoldRing(props: { readonly remaining: number; readonly expired: boolean }) {
  const fraction = props.expired
    ? 0
    : Math.max(0, Math.min(1, props.remaining / RESERVATION_TTL_MS));
  const urgent = !props.expired && props.remaining < 60_000;
  const colour = props.expired || urgent ? 'var(--danger)' : 'var(--ok)';

  const radius = 15;
  const circumference = 2 * Math.PI * radius;

  return (
    <span
      aria-hidden
      className="relative grid size-9 shrink-0 place-items-center"
      title={props.expired ? 'hold expired' : 'time left on this hold'}
    >
      <svg viewBox="0 0 36 36" className="absolute size-9 -rotate-90">
        <circle cx="18" cy="18" r={radius} fill="none" stroke="var(--border)" strokeWidth="3" />
        <circle
          cx="18"
          cy="18"
          r={radius}
          fill="none"
          stroke={colour}
          strokeWidth="3"
          strokeLinecap="round"
          strokeDasharray={circumference}
          strokeDashoffset={circumference * (1 - fraction)}
          style={{ transition: 'stroke-dashoffset 400ms linear' }}
        />
      </svg>
      <span style={{ color: colour }}>
        <Icon name={props.expired ? 'close' : 'clock'} className="size-3.5" />
      </span>
    </span>
  );
}

/** The artwork of what is on this plate, stacked. */
function Thumbnails(props: { readonly menu: Menu; readonly selection: Selection }) {
  const index = indexOptions(props.menu.groups);
  const images = Object.keys(props.selection)
    .map((optionId) => index.get(optionId)?.option.image)
    .filter((image): image is string => image !== undefined)
    .slice(0, 4);

  if (images.length === 0) return null;

  return (
    <span aria-hidden className="flex -space-x-2">
      {images.map((image) => (
        <img
          key={image}
          src={image}
          alt=""
          width={28}
          height={28}
          loading="lazy"
          decoding="async"
          className="size-7 rounded-full border-2 object-cover"
          style={{ borderColor: 'var(--surface)', background: 'var(--surface-muted)' }}
        />
      ))}
    </span>
  );
}

function Row(props: {
  readonly label: string;
  readonly value: string;
  readonly muted?: boolean;
  readonly tone?: 'ok';
}) {
  return (
    <div className="flex items-baseline justify-between gap-4">
      <dt style={{ color: 'var(--text-muted)' }}>{props.label}</dt>
      <dd
        className="truncate text-right"
        style={
          props.tone === 'ok'
            ? { color: 'var(--ok)' }
            : props.muted === true
              ? { color: 'var(--text-muted)' }
              : undefined
        }
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
