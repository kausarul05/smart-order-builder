import { useState } from 'react';

import { formatInZone } from './domain/time';
import type { PaymentMethod, StoredOrder } from './domain/types';
import { CartPanel } from './features/cart/CartPanel';
import { Configurator } from './features/configurator/Configurator';
import { CheckoutPanel } from './features/checkout/CheckoutPanel';
import { downloadOrders } from './features/checkout/downloadOrders';
import { useOrderBuilder } from './features/orderBuilder/useOrderBuilder';
import { useServerClock } from './lib/useServerClock';
import { SERVER_TIME_ZONE } from './server/clock';

export default function App() {
  const builder = useOrderBuilder();
  const now = useServerClock();

  const [couponCode, setCouponCode] = useState('');
  const [lastOrder, setLastOrder] = useState<StoredOrder | null>(null);

  const { menu, items, editing } = builder;
  const editingItem =
    editing === null
      ? null
      : (items.find((item) => item.id === editing.itemId) ?? null);

  if (builder.loadError !== null) {
    return (
      <main className="mx-auto max-w-5xl px-4 py-10">
        <p role="alert" style={{ color: 'var(--danger)' }}>
          {builder.loadError}
        </p>
        <button
          type="button"
          onClick={() => void builder.refresh()}
          className="mt-3 rounded-lg border px-3 py-1.5 text-sm"
          style={{ borderColor: 'var(--border)' }}
        >
          Try again
        </button>
      </main>
    );
  }

  if (menu === null) {
    return (
      <main className="mx-auto max-w-5xl px-4 py-10">
        <p style={{ color: 'var(--text-muted)' }}>Starting the mock server…</p>
      </main>
    );
  }

  const pay = (method: PaymentMethod): void => {
    void builder.pay(method, couponCode.trim() === '' ? null : couponCode).then((order) => {
      if (order === null) return;
      setLastOrder(order);
      setCouponCode('');
    });
  };

  return (
    <main className="mx-auto max-w-6xl px-4 py-8">
      <header className="mb-8">
        <h1 className="text-xl font-semibold">Smart Order Builder</h1>
        <p className="mt-1 text-xs tnum" style={{ color: 'var(--text-muted)' }}>
          Server clock {formatInZone(now, SERVER_TIME_ZONE)} ({SERVER_TIME_ZONE}) ·
          every countdown and coupon window below is judged by this clock, not
          by the browser&rsquo;s
        </p>
      </header>

      <div className="grid gap-10 lg:grid-cols-[minmax(0,1.4fr)_minmax(0,1fr)]">
        <Configurator
          menu={menu}
          available={builder.availableForDraft}
          editingItem={editingItem}
          busy={builder.busy}
          mutationError={builder.mutationError}
          couponCode={couponCode.trim() === '' ? null : couponCode}
          onAdd={builder.addToCart}
          onSave={builder.saveEdit}
          onCancelEdit={builder.cancelEdit}
        />

        <div className="space-y-10">
          <CartPanel
            menu={menu}
            items={items}
            now={now}
            busy={builder.busy}
            editingItemId={editing?.itemId ?? null}
            onEdit={builder.beginEdit}
            onRemove={(itemId) => void builder.remove(itemId)}
            onChangeQty={(item, qty) => void builder.changeQty(item, qty)}
          />

          <CheckoutPanel
            menu={menu}
            items={items}
            now={now}
            busy={builder.busy}
            couponCode={couponCode}
            lastOrder={lastOrder}
            orderCount={builder.orders.length}
            onCouponChange={setCouponCode}
            onPay={pay}
            onDownload={() => void downloadOrders()}
          />

          <StockPanel
            available={builder.available}
            names={menu.ingredients}
          />
        </div>
      </div>
    </main>
  );
}

/** Live shared stock, so the reviewer can watch it move. */
function StockPanel(props: {
  readonly available: Readonly<Record<string, number>>;
  readonly names: readonly { readonly id: string; readonly name: string }[];
}) {
  return (
    <section>
      <h2 className="text-lg font-semibold">Shared stock</h2>
      <p className="mt-1 text-xs" style={{ color: 'var(--text-muted)' }}>
        Free units: on hand, minus everything reserved by the cart, minus
        everything already sold.
      </p>
      <ul className="mt-3 grid grid-cols-2 gap-1 text-sm sm:grid-cols-3">
        {props.names.map((ingredient) => {
          const left = props.available[ingredient.id] ?? 0;
          return (
            <li key={ingredient.id} className="flex justify-between gap-2 tnum">
              <span style={{ color: 'var(--text-muted)' }}>{ingredient.name}</span>
              <span style={{ color: left === 0 ? 'var(--danger)' : undefined }}>
                {left}
              </span>
            </li>
          );
        })}
      </ul>
    </section>
  );
}
