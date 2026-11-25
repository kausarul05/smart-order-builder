import { useState } from 'react';

import type { CartItemView } from '@/api/client';
import { formatBdt } from '@/domain/money';
import { priceCart } from '@/domain/pricing/priceCart';
import { PAYMENT_METHODS } from '@/domain/types';
import type { Menu, PaymentMethod, StoredOrder } from '@/domain/types';

/**
 * Checkout. The breakdown shown here is the client's own run of the SAME
 * `priceCart` the server uses, against the locked unit prices - so what the
 * customer sees and what the server charges cannot disagree (D2).
 *
 * `onPay` is idempotent on the server: the key belongs to the checkout
 * intent, so a double click produces one order (TC-16). The disabled button
 * is only a courtesy on top of that.
 */
export function CheckoutPanel(props: {
  readonly menu: Menu;
  readonly items: readonly CartItemView[];
  readonly now: Date;
  readonly busy: boolean;
  readonly couponCode: string;
  readonly lastOrder: StoredOrder | null;
  onCouponChange(code: string): void;
  onPay(method: PaymentMethod): void;
  onDownload(): void;
  readonly orderCount: number;
}) {
  const { menu, items, now, busy, couponCode, lastOrder } = props;
  const [method, setMethod] = useState<PaymentMethod>('card');

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
    <section>
      <h2 className="text-lg font-semibold">Checkout</h2>

      <label className="mt-3 block text-sm">
        <span style={{ color: 'var(--text-muted)' }}>Coupon</span>
        <input
          value={couponCode}
          onChange={(event) => props.onCouponChange(event.target.value)}
          placeholder="MORNING15"
          className="mt-1 w-full rounded-lg border px-3 py-2 text-sm"
          style={{ borderColor: 'var(--border)', background: 'var(--surface)' }}
        />
      </label>

      {breakdown !== null && (
        <dl className="mt-4 space-y-1 text-sm tnum">
          <Row label="Subtotal" value={formatBdt(breakdown.subtotal)} />
          {breakdown.candidates.map((candidate) => (
            <Row
              key={candidate.id}
              label={`${candidate.id}${candidate.code === null ? '' : ` · ${candidate.code}`}`}
              value={
                candidate.id === breakdown.discount?.id
                  ? `−${formatBdt(candidate.amount)}`
                  : (candidate.reason ?? 'not applied')
              }
              muted={candidate.id !== breakdown.discount?.id}
            />
          ))}
          <Row label={`VAT ${menu.promotions.vatPercent}%`} value={formatBdt(breakdown.vat)} />
          <div
            className="flex justify-between gap-4 border-t pt-2 text-base font-semibold"
            style={{ borderColor: 'var(--border)' }}
          >
            <dt>Payable</dt>
            <dd>{formatBdt(breakdown.payable)}</dd>
          </div>
        </dl>
      )}

      <fieldset className="mt-4">
        <legend className="text-xs" style={{ color: 'var(--text-muted)' }}>
          Payment method — a label only, no payment data is collected
        </legend>
        <div className="mt-2 flex flex-wrap gap-3">
          {PAYMENT_METHODS.map((candidate) => (
            <label key={candidate} className="flex items-center gap-1.5 text-sm">
              <input
                type="radio"
                name="payment-method"
                value={candidate}
                checked={method === candidate}
                onChange={() => setMethod(candidate)}
                disabled={busy}
              />
              {candidate}
            </label>
          ))}
        </div>
      </fieldset>

      <div className="mt-4 flex flex-wrap gap-2">
        <button
          type="button"
          disabled={busy || active.length === 0}
          onClick={() => props.onPay(method)}
          className="rounded-lg px-4 py-2 text-sm font-medium disabled:opacity-50"
          style={{ background: 'var(--accent)', color: 'var(--surface)' }}
        >
          {busy ? 'Paying…' : 'Pay'}
        </button>
        <button
          type="button"
          disabled={busy}
          onClick={props.onDownload}
          className="rounded-lg border px-4 py-2 text-sm disabled:opacity-50"
          style={{ borderColor: 'var(--border)' }}
        >
          Download orders.json
        </button>
      </div>

      <p className="mt-2 text-xs" style={{ color: 'var(--text-muted)' }}>
        {props.orderCount} order{props.orderCount === 1 ? '' : 's'} in the store —
        the six seed orders are priced by our own engine at their own time.
      </p>

      {lastOrder !== null && (
        <div
          className="mt-4 rounded-xl border p-4 text-sm"
          style={{ borderColor: 'var(--ok)' }}
          role="status"
        >
          <p className="font-medium">Order {lastOrder.id} placed</p>
          <p className="mt-1 tnum" style={{ color: 'var(--text-muted)' }}>
            {formatBdt(lastOrder.totals.payable)} · {lastOrder.paymentMethod} ·{' '}
            {lastOrder.createdAt}
          </p>
          {lastOrder.coupon.entered !== null && lastOrder.coupon.applied === null && (
            <p className="mt-1 text-xs" style={{ color: 'var(--danger)' }}>
              Coupon {lastOrder.coupon.entered} was not applied:{' '}
              {lastOrder.coupon.rejectedReason}
            </p>
          )}
        </div>
      )}
    </section>
  );
}

function Row(props: {
  readonly label: string;
  readonly value: string;
  readonly muted?: boolean;
}) {
  return (
    <div className="flex justify-between gap-4">
      <dt style={{ color: 'var(--text-muted)' }}>{props.label}</dt>
      <dd style={props.muted === true ? { color: 'var(--text-muted)' } : undefined}>
        {props.value}
      </dd>
    </div>
  );
}
