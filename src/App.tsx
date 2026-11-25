import { useCallback, useEffect, useRef, useState } from 'react';

import { Icon } from './components/ui/Icon';
import { useToast } from './components/ui/toastContext';
import { formatBdt } from './domain/money';
import { priceCart } from './domain/pricing/priceCart';
import type { PaymentMethod, Selection, StoredOrder } from './domain/types';
import { Configurator } from './features/configurator/Configurator';
import { downloadOrders } from './features/checkout/downloadOrders';
import {
  useOrderBuilder,
  type MutationError,
} from './features/orderBuilder/useOrderBuilder';
import { OrderPanel } from './features/pos/OrderPanel';
import { Sidebar } from './features/pos/Sidebar';
import { registerFlyTarget } from './lib/flyTo';
import { useServerClock } from './lib/useServerClock';

/**
 * While MSW starts and the first menu request lands, the layout is already
 * on screen in outline - which reads as fast, and stops the page jumping
 * when the real cards arrive.
 */
function BootSkeleton() {
  return (
    <div className="flex h-dvh overflow-hidden" style={{ background: 'var(--page)' }}>
      <div
        className="hidden w-60 shrink-0 lg:block"
        style={{ background: 'var(--nav)' }}
        aria-hidden
      />
      <div className="flex min-w-0 flex-1 flex-col">
        <div
          className="h-14 shrink-0 border-b"
          style={{ background: 'var(--surface)', borderColor: 'var(--border)' }}
        />
        <div
          className="grid min-h-0 flex-1 grid-cols-2 content-start gap-3 overflow-hidden p-4 sm:p-6 lg:grid-cols-3 2xl:grid-cols-4"
          role="status"
          aria-label="Loading the menu"
        >
          {Array.from({ length: 9 }, (_, index) => (
            <div key={index} className="card overflow-hidden" aria-hidden>
              <div className="skeleton aspect-[4/3] w-full" />
              <div className="space-y-2 p-3">
                <div className="skeleton h-3.5 w-3/4 rounded" />
                <div className="skeleton h-3 w-1/2 rounded" />
              </div>
            </div>
          ))}
        </div>
      </div>
      <div
        className="hidden w-[23rem] shrink-0 lg:block xl:w-[25rem]"
        style={{ background: 'var(--surface)', borderLeft: '1px solid var(--border)' }}
        aria-hidden
      />
    </div>
  );
}

/**
 * The till. Three columns on a wide screen - category rail, product grid,
 * order rail - collapsing to one column with a drawer and a bottom sheet on
 * a phone, which is the shape a counter tablet and a phone both need.
 */
export default function App() {
  const builder = useOrderBuilder();
  const now = useServerClock();
  const toast = useToast();

  const [couponCode, setCouponCode] = useState('');
  const [lastOrder, setLastOrder] = useState<StoredOrder | null>(null);
  const [draft, setDraft] = useState<{
    selection: Selection;
    violationGroupIds: ReadonlySet<string>;
    issueCount: number;
  }>({ selection: {}, violationGroupIds: new Set(), issueCount: 0 });
  const [activeGroupId, setActiveGroupId] = useState<string | null>(null);
  const [navOpen, setNavOpen] = useState(false);
  const [orderOpen, setOrderOpen] = useState(false);

  // On a phone the order rail is hidden, so the sticky summary bar is
  // where an added item flies to.
  const phoneDropRef = useRef<HTMLButtonElement>(null);
  useEffect(() => registerFlyTarget('cart', phoneDropRef.current), []);

  const { menu, items, editing, mutationError } = builder;
  const editingItem =
    editing === null ? null : (items.find((item) => item.id === editing.itemId) ?? null);

  /**
   * One place raises the error toast: whatever failed, the owner of the
   * request put the reason here. The inline banner stays as well, because a
   * shortage list is worth re-reading once the toast is gone.
   */
  const reported = useRef<MutationError | null>(null);
  useEffect(() => {
    if (mutationError === null || mutationError === reported.current) return;
    reported.current = mutationError;
    toast.error(mutationError.message, {
      ...(mutationError.retryable
        ? { detail: 'Nothing was changed and your draft is intact — try again.' }
        : {}),
      ...(mutationError.shortages.length > 0
        ? {
            lines: mutationError.shortages.map(
              (shortage) => `${shortage.missing} ${shortage.name} short`,
            ),
          }
        : {}),
    });
  }, [mutationError, toast]);

  const onSelectionChange = useCallback(
    (
      selection: Selection,
      violationGroupIds: ReadonlySet<string>,
      issueCount: number,
    ) => {
      setDraft({ selection, violationGroupIds, issueCount });
    },
    [],
  );

  const jumpToGroup = useCallback((groupId: string): void => {
    setActiveGroupId(groupId);
    setNavOpen(false);
    document
      .getElementById(`group-${groupId}`)
      ?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }, []);

  if (builder.loadError !== null) {
    // A stale service worker is the usual cause, and a reload is the fix,
    // so offer that rather than a retry that would fail the same way.
    const stale = builder.loadErrorCode === 'mock_server_missing';
    return (
      <main className="mx-auto max-w-md px-4 py-16 text-center">
        <p role="alert" className="text-sm" style={{ color: 'var(--danger)' }}>
          {builder.loadError}
        </p>
        {stale && (
          <p className="mt-2 text-xs" style={{ color: 'var(--text-muted)' }}>
            MSW is the backend for this app and it installs a service worker.
            A tab left open across a rebuild can keep the old one.
          </p>
        )}
        <button
          type="button"
          onClick={() => (stale ? window.location.reload() : void builder.refresh())}
          className="btn-primary mt-4 px-4 py-2.5 text-sm"
        >
          {stale ? 'Reload page' : 'Try again'}
        </button>
      </main>
    );
  }

  if (menu === null) return <BootSkeleton />;

  const active = items.filter((item) => item.status === 'active');
  const cartTotal =
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
        }).payable;

  const pay = (method: PaymentMethod): void => {
    void builder.pay(method, couponCode.trim() === '' ? null : couponCode).then((order) => {
      if (order === null) return;
      setLastOrder(order);
      setCouponCode('');
      toast.success(
        `Order ${order.id} placed`,
        `${formatBdt(order.totals.payable)} · ${order.paymentMethod}`,
      );
      if (order.coupon.entered !== null && order.coupon.applied === null) {
        toast.info(
          `Coupon ${order.coupon.entered} was not applied`,
          order.coupon.rejectedReason ?? undefined,
        );
      }
    });
  };

  const remove = (itemId: string): void => {
    void builder.remove(itemId).then((ok) => {
      if (ok) toast.success('Item removed', 'Its ingredients went back to free stock.');
    });
  };

  const beginEdit = (item: Parameters<typeof builder.beginEdit>[0]): void => {
    builder.beginEdit(item);
    setOrderOpen(false);
  };

  const download = (): void => {
    void downloadOrders()
      .then((file) =>
        toast.success(
          'orders.json downloaded',
          `${file.orders.length} orders · amounts in ${file.moneyUnit}`,
        ),
      )
      .catch((cause: unknown) =>
        toast.error(cause instanceof Error ? cause.message : 'Export failed'),
      );
  };

  const sidebar = (
    <Sidebar
      menu={menu}
      selection={draft.selection}
      activeGroupId={activeGroupId}
      violationGroupIds={draft.violationGroupIds}
      available={builder.available}
      now={now}
      issueCount={draft.issueCount}
      onJump={jumpToGroup}
    />
  );

  const orderPanel = (
    <OrderPanel
      menu={menu}
      items={items}
      orders={builder.orders}
      now={now}
      busy={builder.busy}
      couponCode={couponCode}
      lastOrder={lastOrder}
      editingItemId={editing?.itemId ?? null}
      onCouponChange={setCouponCode}
      onEdit={beginEdit}
      onRemove={remove}
      onChangeQty={(item, qty) => void builder.changeQty(item, qty)}
      onPay={pay}
      onDownload={download}
      onClose={() => setOrderOpen(false)}
    />
  );

  return (
    <div className="flex h-dvh overflow-hidden" style={{ background: 'var(--page)' }}>
      {/* -------------------------------------------- sidebar (lg and up) */}
      <div
        className="hidden w-60 shrink-0 lg:block"
        style={{ borderRight: '1px solid var(--nav-border)' }}
      >
        {sidebar}
      </div>

      {/* ----------------------------------------- sidebar drawer (phone) */}
      {navOpen && (
        <div className="fixed inset-0 z-40 lg:hidden">
          <button
            type="button"
            aria-label="Close categories"
            className="absolute inset-0 bg-black/50"
            onClick={() => setNavOpen(false)}
          />
          <div className="sheet-in absolute inset-y-0 left-0 w-64 max-w-[80vw]">
            {sidebar}
          </div>
        </div>
      )}

      {/* -------------------------------------------------- centre column */}
      <div className="flex min-w-0 flex-1 flex-col">
        <div
          className="flex shrink-0 items-center gap-2 border-b px-3 py-2 lg:hidden"
          style={{ background: 'var(--surface)', borderColor: 'var(--border)' }}
        >
          <button
            type="button"
            aria-label="Open categories"
            onClick={() => setNavOpen(true)}
            className="btn-ghost grid size-9 place-items-center"
          >
            <Icon name="list" className="size-4" />
          </button>
          <p className="truncate text-sm font-semibold">Smart Order</p>
          <span className="chip tnum ml-auto">{items.length} held</span>
        </div>

        <div className="min-h-0 flex-1">
          <Configurator
            menu={menu}
            available={builder.availableForDraft}
            editingItem={editingItem}
            busy={builder.busy}
            mutationError={mutationError}
            couponCode={couponCode.trim() === '' ? null : couponCode}
            onAdd={builder.addToCart}
            onSave={builder.saveEdit}
            onCancelEdit={builder.cancelEdit}
            onSelectionChange={onSelectionChange}
          />
        </div>

        {/* Sticky summary that opens the order sheet on a phone. */}
        <button
          ref={phoneDropRef}
          type="button"
          onClick={() => setOrderOpen(true)}
          className="btn-primary flex shrink-0 items-center justify-center gap-2 py-3 text-sm lg:hidden"
          style={{ borderRadius: 0 }}
        >
          <Icon name="receipt" className="size-4" />
          View order · {active.length} item{active.length === 1 ? '' : 's'}
          {cartTotal !== null && <span className="tnum">· {formatBdt(cartTotal)}</span>}
        </button>
      </div>

      {/* --------------------------------------------- order rail (lg up) */}
      <div
        className="hidden w-[23rem] shrink-0 lg:block xl:w-[25rem]"
        style={{ borderLeft: '1px solid var(--border)' }}
      >
        {orderPanel}
      </div>

      {/* -------------------------------------------- order sheet (phone) */}
      {orderOpen && (
        <div className="fixed inset-0 z-40 lg:hidden">
          <button
            type="button"
            aria-label="Close order details"
            className="absolute inset-0 bg-black/50"
            onClick={() => setOrderOpen(false)}
          />
          <div className="sheet-in absolute inset-x-0 bottom-0 top-10 overflow-hidden rounded-t-2xl">
            {orderPanel}
          </div>
        </div>
      )}
    </div>
  );
}
