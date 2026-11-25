import { useEffect, useMemo, useState } from 'react';

import type { CartItemView } from '@/api/client';
import { formatBdt } from '@/domain/money';
import { validate } from '@/domain/rules/validate';
import { addUnits } from '@/domain/selection';
import { stockHeadroom } from '@/domain/stock/availability';
import type {
  IngredientId,
  Menu,
  MenuOption,
  Selection,
  Violation,
} from '@/domain/types';
import type { MutationError } from '@/features/orderBuilder/useOrderBuilder';
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
}

/** Limit codes that cap a group; min and step must stay reachable. */
const CAP_CODES = new Set(['max', 'maxDistinct', 'maxPerOption']);

export function Configurator(props: ConfiguratorProps) {
  const { menu, available, editingItem, busy, mutationError } = props;

  const [selection, setSelection] = useState<Selection>({});
  const [qty, setQty] = useState(menu.itemQty.min);

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

  /** Stock headroom and limit headroom, combined, per option. */
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
    const ok =
      editingItem === null
        ? await props.onAdd(selection, qty)
        : await props.onSave(selection, qty);
    if (ok && editingItem === null) reset();
  };

  return (
    <section>
      <header className="flex flex-wrap items-baseline justify-between gap-2">
        <h2 className="text-lg font-semibold">
          {editingItem === null ? menu.productName : 'Editing a cart item'}
        </h2>
        <p className="text-xs tnum" style={{ color: 'var(--text-muted)' }}>
          Base {formatBdt(menu.basePrice)} · fixture {menu.version}
        </p>
      </header>

      {editingItem !== null && (
        <p
          className="mt-3 rounded-lg px-3 py-2 text-sm"
          style={{ background: 'var(--surface-muted)' }}
        >
          This item already holds its ingredients, so they count as available
          to itself. Only the extra beyond what it holds has to be found in
          free stock.{' '}
          <button
            type="button"
            className="underline"
            onClick={props.onCancelEdit}
            disabled={busy}
          >
            Cancel edit
          </button>
        </p>
      )}

      <div className="mt-4 space-y-4">
        {menu.groups.map((group) => (
          <article
            key={group.id}
            className="rounded-xl border p-4"
            style={{ borderColor: 'var(--border)' }}
          >
            <div className="flex flex-wrap items-baseline justify-between gap-2">
              <h3 className="font-medium">{group.name}</h3>
              <p className="text-xs tnum" style={{ color: 'var(--text-muted)' }}>
                {describeLimits(group)}
              </p>
            </div>

            <ul className="mt-3 space-y-2">
              {group.options.map((option) => (
                <OptionRow
                  key={option.id}
                  option={option}
                  units={selection[option.id] ?? 0}
                  headroom={headroom[option.id] ?? 0}
                  disabled={busy}
                  onChange={(delta) =>
                    setSelection((current) => addUnits(current, option.id, delta))
                  }
                />
              ))}
            </ul>
          </article>
        ))}
      </div>

      <div className="mt-5 flex flex-wrap items-center gap-4">
        <label className="flex items-center gap-2 text-sm">
          <span>Quantity</span>
          <select
            value={qty}
            disabled={busy}
            onChange={(event) => setQty(Number(event.target.value))}
            className="rounded-lg border px-2 py-1 text-sm"
            style={{ borderColor: 'var(--border)', background: 'var(--surface)' }}
          >
            {quantities(menu).map((value) => (
              <option key={value} value={value}>
                {value}
              </option>
            ))}
          </select>
        </label>
        <p className="text-xs" style={{ color: 'var(--text-muted)' }}>
          Quantity multiplies ingredient usage.
        </p>
      </div>

      {/* Every violation, not just the first one. */}
      {violations.length > 0 && (
        <ul className="mt-4 space-y-1" aria-live="polite">
          {violations.map((violation, index) => (
            <li
              key={`${scopeId(violation)}-${violation.code}-${index}`}
              className="text-sm"
              style={{ color: 'var(--danger)' }}
            >
              {violation.message}
              <span className="ml-2 text-xs opacity-70">
                [{scopeId(violation)}
                {violation.viaOverride === undefined ? '' : ` via ${violation.viaOverride}`}]
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

      {mutationError !== null && (
        <div
          className="mt-4 rounded-lg px-3 py-2 text-sm"
          style={{ background: 'var(--surface-muted)', color: 'var(--danger)' }}
          role="alert"
        >
          <p className="font-medium">{mutationError.message}</p>
          {mutationError.shortages.length > 0 && (
            <ul className="mt-1 tnum">
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

      <div className="mt-5 flex flex-wrap gap-2">
        <button
          type="button"
          // Disabled while ANY violation exists.
          disabled={!isValid || busy}
          onClick={() => void submit()}
          className="rounded-lg px-4 py-2 text-sm font-medium disabled:opacity-50"
          style={{ background: 'var(--accent)', color: 'var(--surface)' }}
        >
          {busy
            ? 'Working…'
            : editingItem === null
              ? 'Add to Cart'
              : 'Save changes'}
        </button>
        <button
          type="button"
          disabled={busy}
          onClick={reset}
          className="rounded-lg border px-4 py-2 text-sm disabled:opacity-50"
          style={{ borderColor: 'var(--border)' }}
        >
          Clear
        </button>
      </div>
    </section>
  );
}

function OptionRow(props: {
  readonly option: MenuOption;
  readonly units: number;
  readonly headroom: number;
  readonly disabled: boolean;
  onChange(delta: number): void;
}) {
  const { option, units, headroom, disabled } = props;
  const soldOut = headroom <= 0;

  return (
    <li
      className="flex flex-wrap items-center justify-between gap-3 rounded-lg px-3 py-2 text-sm"
      style={{ background: 'var(--surface-muted)' }}
    >
      <span className="flex-1">
        {option.name}
        <span className="ml-2 tnum" style={{ color: 'var(--text-muted)' }}>
          {formatBdt(option.price)}
        </span>
      </span>

      <span className="tnum text-xs" style={{ color: 'var(--text-muted)' }}>
        {Number.isFinite(headroom)
          ? `${headroom} more can be added`
          : 'unlimited'}
      </span>

      <span className="flex items-center gap-1">
        <button
          type="button"
          aria-label={`Remove one ${option.name}`}
          disabled={disabled || units === 0}
          onClick={() => props.onChange(-1)}
          className="size-7 rounded-md border disabled:opacity-40"
          style={{ borderColor: 'var(--border)' }}
        >
          −
        </button>
        <span className="w-6 text-center tnum">{units}</span>
        <button
          type="button"
          aria-label={`Add one ${option.name}`}
          // Disabled at 0 headroom, whether that is stock or a group limit.
          disabled={disabled || soldOut}
          onClick={() => props.onChange(1)}
          className="size-7 rounded-md border disabled:opacity-40"
          style={{ borderColor: 'var(--border)' }}
        >
          +
        </button>
      </span>
    </li>
  );
}

function countCaps(violations: readonly Violation[]): number {
  return violations.filter((violation) => CAP_CODES.has(violation.code)).length;
}

function scopeId(violation: Violation): string {
  return violation.scope.kind === 'group'
    ? violation.scope.groupId
    : violation.scope.ruleId;
}

function quantities(menu: Menu): readonly number[] {
  const out: number[] = [];
  for (let value = menu.itemQty.min; value <= menu.itemQty.max; value += 1) {
    out.push(value);
  }
  return out;
}

function describeLimits(group: Menu['groups'][number]): string {
  const { limits } = group;
  const parts: string[] = [];
  if (limits.min !== undefined) parts.push(`min ${limits.min}`);
  if (limits.max !== undefined) parts.push(`max ${limits.max}`);
  if (limits.step !== undefined) parts.push(`step ${limits.step}`);
  if (limits.maxDistinct !== undefined) parts.push(`max ${limits.maxDistinct} distinct`);
  if (limits.maxPerOption !== undefined) parts.push(`max ${limits.maxPerOption} each`);
  return parts.join(' · ');
}
