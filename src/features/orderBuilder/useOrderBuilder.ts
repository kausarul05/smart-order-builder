/**
 * One hook holding everything the screen needs: the menu, live stock, the
 * cart and the order store. The components below it are presentational.
 *
 * The server is the source of truth for all of it, so every mutation is
 * followed by a refetch of the cart and the stock rather than by patching
 * local state optimistically. That is what keeps a second tab honest.
 */

import { useCallback, useEffect, useMemo, useState } from 'react';

import { ApiError, api, newIdempotencyKey, type CartItemView } from '@/api/client';
import { lineAllocation } from '@/domain/stock/availability';
import { addUsage } from '@/domain/stock/ingredients';
import type {
  IngredientId,
  Menu,
  PaymentMethod,
  Selection,
  Shortage,
  StoredOrder,
  Usage,
} from '@/domain/types';

export interface Editing {
  readonly itemId: string;
  readonly version: number;
}

export interface MutationError {
  readonly message: string;
  readonly shortages: readonly Shortage[];
  readonly retryable: boolean;
}

export interface OrderBuilder {
  readonly menu: Menu | null;
  readonly available: Readonly<Record<IngredientId, number>>;
  readonly items: readonly CartItemView[];
  readonly orders: readonly StoredOrder[];
  readonly loadError: string | null;
  readonly busy: boolean;
  readonly mutationError: MutationError | null;
  readonly editing: Editing | null;
  /** Stock as the configurator should see it, net of the item being edited. */
  readonly availableForDraft: Readonly<Record<IngredientId, number>>;
  clearMutationError(): void;
  addToCart(selection: Selection, qty: number): Promise<boolean>;
  saveEdit(selection: Selection, qty: number): Promise<boolean>;
  beginEdit(item: CartItemView): void;
  cancelEdit(): void;
  changeQty(item: CartItemView, qty: number): Promise<boolean>;
  remove(itemId: string): Promise<boolean>;
  pay(paymentMethod: PaymentMethod, couponCode: string | null): Promise<StoredOrder | null>;
  refresh(): Promise<void>;
}

export function useOrderBuilder(): OrderBuilder {
  const [menu, setMenu] = useState<Menu | null>(null);
  const [available, setAvailable] = useState<Readonly<Record<IngredientId, number>>>({});
  const [items, setItems] = useState<readonly CartItemView[]>([]);
  const [orders, setOrders] = useState<readonly StoredOrder[]>([]);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [mutationError, setMutationError] = useState<MutationError | null>(null);
  const [editing, setEditing] = useState<Editing | null>(null);

  /**
   * One key per user INTENT. It is reused while an add keeps failing, so a
   * Retry cannot create a second item, and replaced after a success so the
   * next add is a new intent (TC-13).
   */
  const [addKey, setAddKey] = useState(() => newIdempotencyKey());
  const [payKey, setPayKey] = useState(() => newIdempotencyKey());

  const refresh = useCallback(async (): Promise<void> => {
    try {
      const [{ available: stock }, cart, { orders: stored }] = await Promise.all([
        api.getStock(),
        api.getCart(),
        api.getOrders(),
      ]);
      setAvailable(stock);
      setItems(cart.items);
      setOrders(stored);
      setLoadError(null);
    } catch (cause) {
      setLoadError(describe(cause));
    }
  }, []);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const { menu: loaded } = await api.getMenu();
        if (cancelled) return;
        setMenu(loaded);
        await refresh();
      } catch (cause) {
        if (!cancelled) setLoadError(describe(cause));
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [refresh]);

  /**
   * Reservations expire on their own, so the cart has to be re-read
   * periodically or an expired hold would keep looking alive.
   */
  useEffect(() => {
    const timer = setInterval(() => void refresh(), 5000);
    return () => clearInterval(timer);
  }, [refresh]);

  /**
   * Part B's net-difference rule, applied to the headroom display: while an
   * item is being edited its own allocation counts as available to itself.
   */
  const availableForDraft = useMemo(() => {
    if (menu === null || editing === null) return available;
    const item = items.find((candidate) => candidate.id === editing.itemId);
    if (item === undefined) return available;
    const own: Usage = lineAllocation(item.selection, menu.groups, item.qty);
    const combined = addUsage(available, own);
    return combined as Readonly<Record<IngredientId, number>>;
  }, [available, editing, items, menu]);

  const run = useCallback(
    async <T,>(action: () => Promise<T>): Promise<T | null> => {
      setBusy(true);
      setMutationError(null);
      try {
        return await action();
      } catch (cause) {
        setMutationError(toMutationError(cause));
        return null;
      } finally {
        setBusy(false);
      }
    },
    [],
  );

  const addToCart = useCallback(
    async (selection: Selection, qty: number): Promise<boolean> => {
      const result = await run(() => api.addToCart({ selection, qty }, addKey));
      if (result === null) return false;
      setAddKey(newIdempotencyKey());
      await refresh();
      return true;
    },
    [addKey, refresh, run],
  );

  const saveEdit = useCallback(
    async (selection: Selection, qty: number): Promise<boolean> => {
      if (editing === null) return false;
      const result = await run(() =>
        api.editCartItem(editing.itemId, {
          selection,
          qty,
          expectedVersion: editing.version,
        }),
      );
      if (result === null) return false;
      setEditing(null);
      await refresh();
      return true;
    },
    [editing, refresh, run],
  );

  const changeQty = useCallback(
    async (item: CartItemView, qty: number): Promise<boolean> => {
      const result = await run(() =>
        api.editCartItem(item.id, {
          selection: item.selection,
          qty,
          expectedVersion: item.version,
        }),
      );
      if (result === null) return false;
      await refresh();
      return true;
    },
    [refresh, run],
  );

  const remove = useCallback(
    async (itemId: string): Promise<boolean> => {
      const result = await run(() => api.removeCartItem(itemId));
      if (result === null) return false;
      if (editing?.itemId === itemId) setEditing(null);
      await refresh();
      return true;
    },
    [editing, refresh, run],
  );

  const pay = useCallback(
    async (
      paymentMethod: PaymentMethod,
      couponCode: string | null,
    ): Promise<StoredOrder | null> => {
      const result = await run(() =>
        api.checkout({ paymentMethod, couponCode }, payKey),
      );
      if (result === null) return null;
      setPayKey(newIdempotencyKey());
      await refresh();
      return result.order;
    },
    [payKey, refresh, run],
  );

  const beginEdit = useCallback((item: CartItemView): void => {
    setMutationError(null);
    setEditing({ itemId: item.id, version: item.version });
  }, []);

  const cancelEdit = useCallback((): void => setEditing(null), []);
  const clearMutationError = useCallback((): void => setMutationError(null), []);

  return {
    menu,
    available,
    availableForDraft,
    items,
    orders,
    loadError,
    busy,
    mutationError,
    editing,
    clearMutationError,
    addToCart,
    saveEdit,
    beginEdit,
    cancelEdit,
    changeQty,
    remove,
    pay,
    refresh,
  };
}

function describe(cause: unknown): string {
  return cause instanceof Error ? cause.message : 'Something went wrong';
}

function toMutationError(cause: unknown): MutationError {
  if (cause instanceof ApiError) {
    return {
      message: cause.message,
      shortages: cause.shortages,
      // 409 means "well formed, but not right now" - keep the draft, retry.
      retryable: cause.status === 409 || cause.status === 0,
    };
  }
  return { message: describe(cause), shortages: [], retryable: true };
}
