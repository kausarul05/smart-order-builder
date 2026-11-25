import { useEffect, useMemo, useRef, useState } from 'react';

import type { CartItemView } from '@/api/client';
import { Icon } from '@/components/ui/Icon';
import { useToast } from '@/components/ui/toastContext';
import { formatBdt } from '@/domain/money';
import { validate } from '@/domain/rules/validate';
import { addUnits } from '@/domain/selection';
import { stockHeadroom } from '@/domain/stock/availability';
import type { IngredientId, Menu, Selection, Violation } from '@/domain/types';
import type { MutationError } from '@/features/orderBuilder/useOrderBuilder';
import { ProductGrid, type GridDensity } from '@/features/pos/ProductGrid';
import { flyTo, registerFlyTarget } from '@/lib/flyTo';
import { PriceBreakdownPanel } from './PriceBreakdownPanel';
import { usePricePreview } from './usePricePreview';

export interface ConfiguratorProps {
  readonly menu: Menu;
  /** Stock as the draft may see it: net of the edited item's own holding. */
  readonly available: Readonly<Record<IngredientId, number>>;
  readonly editingItem: CartItemView | null;
  readonly busy: boolean;
  readonly mutationError: MutationError | null;
  readonly couponCode: string | null;
  onAdd(selection: Selection, qty: number): Promise<boolean>;
  onSave(selection: Selection, qty: number): Promise<boolean>;
  onCancelEdit(): void;
  onSelectionChange?(
    selection: Selection,
    violationGroupIds: ReadonlySet<string>,
    issueCount: number,
  ): void;
}

/** Limit codes that cap a group; min and step must stay reachable. */
const CAP_CODES = new Set(['max', 'maxDistinct', 'maxPerOption']);

export function Configurator(props: ConfiguratorProps) {
  const { menu, available, editingItem, busy, mutationError } = props;
  const toast = useToast();

  const [selection, setSelection] = useState<Selection>({});
  const [qty, setQty] = useState(menu.itemQty.min);
  const [query, setQuery] = useState('');
  const [density, setDensity] = useState<GridDensity>('grid');

  // Picking an option flies a ghost into this button; pressing it flies
  // one on into the order rail.
  const addButtonRef = useRef<HTMLButtonElement>(null);
  useEffect(() => registerFlyTarget('draft', addButtonRef.current), []);

  // Entering edit mode seeds the draft from the item being edited.
  useEffect(() => {
    if (editingItem === null) return;
    setSelection(editingItem.selection);
    setQty(editingItem.qty);
  }, [editingItem]);

  const violations = useMemo(
    () => validate({ productId: menu.productId, selection }, menu.groups, menu.rules),
    [menu, selection],
  );
  const isValid = violations.length === 0;

  const preview = usePricePreview({
    selection,
    qty,
    couponCode: props.couponCode,
    enabled: isValid,
  });

  const capCount = useMemo(() => countCaps(violations), [violations]);

  const violationGroupIds = useMemo(() => {
    const ids = new Set<string>();
    for (const violation of violations) {
      if (violation.scope.kind === 'group') ids.add(violation.scope.groupId);
    }
    return ids;
  }, [violations]);

  const { onSelectionChange } = props;
  useEffect(() => {
    onSelectionChange?.(selection, violationGroupIds, violations.length);
  }, [onSelectionChange, selection, violationGroupIds, violations.length]);

  /** Stock headroom and group-limit headroom, combined, per option. */
  const headroom = useMemo(() => {
    const out: Record<string, number> = {};
    for (const group of menu.groups) {
      for (const option of group.options) {
        const byStock = stockHeadroom(option, available, qty);
        const next = addUnits(selection, option.id, 1);
        const wouldCap =
          countCaps(
            validate({ productId: menu.productId, selection: next }, menu.groups, menu.rules),
          ) > capCount;
        out[option.id] = wouldCap ? 0 : byStock;
      }
    }
    return out;
  }, [available, capCount, menu, qty, selection]);

  const reset = (): void => {
    setSelection({});
    setQty(menu.itemQty.min);
  };

  const submit = async (): Promise<void> => {
    const editing = editingItem !== null;
    const source = addButtonRef.current;

    const ok = editing
      ? await props.onSave(selection, qty)
      : await props.onAdd(selection, qty);

    if (!ok) return; // the error toast is raised by the owner of the request

    if (!editing && source !== null) {
      flyTo('cart', source, { imageSrc: leadImage(menu, selection), size: 60 });
    }

    if (editing) {
      toast.success('Item updated', 'The swap was served from what it already held.');
    } else {
      toast.success(
        'Added to the order',
        `${qty} × ${menu.productName} — ingredients held for 5 minutes.`,
      );
      reset();
    }
  };

  const payable = preview.breakdown?.payable;

  return (
    <div className="flex h-full min-h-0 flex-col">
      {/* ---------------------------------------------------------- header */}
      <header
        className="shrink-0 border-b px-4 py-3 sm:px-6"
        style={{ background: 'var(--surface)', borderColor: 'var(--border)' }}
      >
        <div className="flex flex-wrap items-center gap-3">
          <h2 className="text-lg font-semibold">
            {editingItem === null ? menu.productName : 'Editing a held item'}
          </h2>

          <label className="relative ml-auto min-w-0 flex-1 sm:max-w-xs">
            <span className="sr-only">Search the menu</span>
            <span
              className="pointer-events-none absolute inset-y-0 left-3 grid place-items-center"
              style={{ color: 'var(--text-muted)' }}
            >
              <Icon name="search" className="size-4" />
            </span>
            <input
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder="Search"
              className="field pl-9"
              type="search"
            />
          </label>

          <div
            className="hidden items-center gap-0.5 rounded-lg border p-0.5 sm:flex"
            style={{ borderColor: 'var(--border-strong)' }}
            role="group"
            aria-label="Layout"
          >
            {(['grid', 'list'] as const).map((value) => (
              <button
                key={value}
                type="button"
                aria-label={`${value} layout`}
                aria-pressed={density === value}
                onClick={() => setDensity(value)}
                className="grid size-7 place-items-center rounded-md"
                style={
                  density === value
                    ? { background: 'var(--accent-soft)', color: 'var(--accent)' }
                    : { color: 'var(--text-muted)' }
                }
              >
                <Icon name={value} className="size-4" />
              </button>
            ))}
          </div>

          <label className="flex items-center gap-2 text-sm">
            <span style={{ color: 'var(--text-muted)' }}>Quantity</span>
            <select
              value={qty}
              disabled={busy}
              onChange={(event) => setQty(Number(event.target.value))}
              className="field w-auto py-1.5"
            >
              {quantities(menu).map((value) => (
                <option key={value} value={value}>
                  {value}
                </option>
              ))}
            </select>
          </label>
        </div>

        <p className="mt-1 text-xs tnum" style={{ color: 'var(--text-muted)' }}>
          Base {formatBdt(menu.basePrice)} · fixture {menu.version} · quantity
          multiplies ingredient usage
        </p>

        {editingItem !== null && (
          <p
            className="mt-2.5 rounded-lg px-3 py-2 text-xs"
            style={{ background: 'var(--accent-soft)' }}
          >
            This item already holds its ingredients, so they count as available
            to itself — only the extra beyond what it holds has to be found in
            free stock.{' '}
            <button
              type="button"
              className="font-medium underline"
              onClick={props.onCancelEdit}
              disabled={busy}
            >
              Cancel edit
            </button>
          </p>
        )}
      </header>

      {/* ------------------------------------------------------ scroll area */}
      <div className="min-h-0 flex-1 overflow-y-auto px-4 py-4 sm:px-6">
        <ProductGrid
          menu={menu}
          selection={selection}
          headroom={headroom}
          density={density}
          query={query}
          disabled={busy}
          onChange={(optionId, delta) =>
            setSelection((current) => addUnits(current, optionId, delta))
          }
        />

        {/* Every violation, never just the first. */}
        {violations.length > 0 && (
          <ul className="mt-6 space-y-1.5" aria-live="polite">
            {violations.map((violation, index) => (
              <li
                key={`${scopeId(violation)}-${violation.code}-${index}`}
                className="flex items-start gap-2 rounded-lg px-3 py-2 text-sm"
                style={{ background: 'var(--danger-soft)', color: 'var(--danger)' }}
              >
                <span aria-hidden className="font-bold">
                  !
                </span>
                <span className="flex-1">
                  {violation.message}
                  <span className="ml-1.5 text-xs opacity-70">
                    [{scopeId(violation)}
                    {violation.viaOverride === undefined
                      ? ''
                      : ` via ${violation.viaOverride}`}
                    ]
                  </span>
                </span>
              </li>
            ))}
          </ul>
        )}

        <PriceBreakdownPanel
          preview={preview}
          qty={qty}
          enabled={isValid}
          vatPercent={menu.promotions.vatPercent}
        />

        {/* Kept inline as well as in a toast: a shortage is worth re-reading. */}
        {mutationError !== null && (
          <div
            className="mt-4 rounded-xl px-3 py-2.5 text-sm"
            style={{ background: 'var(--danger-soft)' }}
            role="alert"
          >
            <p className="font-medium" style={{ color: 'var(--danger)' }}>
              {mutationError.message}
            </p>
            {mutationError.shortages.length > 0 && (
              <ul className="mt-1 tnum text-xs" style={{ color: 'var(--danger)' }}>
                {mutationError.shortages.map((shortage) => (
                  <li key={shortage.ingredientId}>
                    {shortage.missing} {shortage.name} short
                  </li>
                ))}
              </ul>
            )}
            {mutationError.retryable && (
              <p className="mt-1 text-xs" style={{ color: 'var(--text-muted)' }}>
                Your configuration is kept — press the button again to retry.
              </p>
            )}
          </div>
        )}
      </div>

      {/* ------------------------------------------------------ action bar */}
      <div
        className="shrink-0 border-t px-4 py-3 sm:px-6"
        style={{ background: 'var(--surface)', borderColor: 'var(--border)' }}
      >
        <div className="flex items-center gap-3">
          <div className="min-w-0 flex-1">
            <p className="text-[11px]" style={{ color: 'var(--text-muted)' }}>
              {isValid ? 'This item' : `${violations.length} to fix`}
            </p>
            <p className="tnum truncate text-sm font-semibold">
              {isValid && payable !== undefined
                ? formatBdt(payable)
                : isValid
                  ? 'pricing…'
                  : 'not ready'}
            </p>
          </div>

          <button
            type="button"
            disabled={busy}
            onClick={reset}
            className="btn-ghost px-3 py-2.5 text-sm"
          >
            Clear
          </button>
          <button
            ref={addButtonRef}
            type="button"
            // Disabled while ANY violation exists.
            disabled={!isValid || busy}
            onClick={() => void submit()}
            className="btn-primary flex items-center gap-2 px-4 py-2.5 text-sm"
          >
            <Icon name="cart" className="size-4" />
            {busy ? 'Working…' : editingItem === null ? 'Add to Cart' : 'Save changes'}
          </button>
        </div>
      </div>
    </div>
  );
}

/** The artwork of the first selected option, for the ghost that flies. */
function leadImage(menu: Menu, selection: Selection): string | undefined {
  for (const group of menu.groups) {
    for (const option of group.options) {
      if ((selection[option.id] ?? 0) > 0 && option.image !== undefined) {
        return option.image;
      }
    }
  }
  return undefined;
}

function countCaps(violations: readonly Violation[]): number {
  return violations.filter((violation) => CAP_CODES.has(violation.code)).length;
}

function scopeId(violation: Violation): string {
  return violation.scope.kind === 'group' ? violation.scope.groupId : violation.scope.ruleId;
}

function quantities(menu: Menu): readonly number[] {
  const out: number[] = [];
  for (let value = menu.itemQty.min; value <= menu.itemQty.max; value += 1) {
    out.push(value);
  }
  return out;
}
