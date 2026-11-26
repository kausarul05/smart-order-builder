import { useEffect, useRef, useState } from 'react';

import { Icon } from '@/components/ui/Icon';
import type { Menu, StoredOrder } from '@/domain/types';
import { AssistantPanel } from './AssistantPanel';

/**
 * The sales assistant as a floating launcher - the convention every
 * support widget uses, and the reason is that a chat nobody can find is a
 * chat nobody uses. It was behind a tab in the order rail before, which
 * hid it behind the till.
 *
 * Desktop: a card anchored above the button. Phone: a full-height sheet,
 * because a 380 px card on a 390 px screen is just a worse sheet.
 *
 * Escape closes it, focus moves into the panel on open and back to the
 * button on close, and the button carries an unread-style dot while the
 * panel is shut so it reads as live rather than decorative.
 */
export function AssistantLauncher(props: {
  readonly menu: Menu;
  readonly orders: readonly StoredOrder[];
}) {
  const [open, setOpen] = useState(false);
  const buttonRef = useRef<HTMLButtonElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onKey = (event: KeyboardEvent): void => {
      if (event.key !== 'Escape') return;
      setOpen(false);
      // Escape must land focus back on the button, not nowhere.
      buttonRef.current?.focus();
    };
    document.addEventListener('keydown', onKey);
    // Move focus into the panel so a keyboard user is not left behind it.
    panelRef.current?.querySelector('input')?.focus();
    return () => document.removeEventListener('keydown', onKey);
  }, [open]);

  const close = (): void => {
    setOpen(false);
    buttonRef.current?.focus();
  };

  return (
    <>
      {open && (
        <>
          {/* Phone only: a scrim, so tapping away closes the sheet. */}
          <button
            type="button"
            aria-label="Close the sales assistant"
            onClick={close}
            className="fixed inset-0 z-40 bg-black/40 sm:hidden"
          />

          <div
            ref={panelRef}
            role="dialog"
            aria-label="Sales assistant"
            className="sheet-in fixed inset-x-0 bottom-0 top-12 z-50 flex flex-col overflow-hidden rounded-t-2xl border sm:inset-auto sm:bottom-20 sm:right-4 sm:top-auto sm:h-[32rem] sm:w-[23rem] sm:rounded-2xl"
            style={{
              background: 'var(--surface)',
              borderColor: 'var(--border)',
              boxShadow: 'var(--shadow-pop)',
            }}
          >
            <header
              className="flex shrink-0 items-center gap-2.5 border-b px-4 py-3"
              style={{ borderColor: 'var(--border)' }}
            >
              <span
                aria-hidden
                className="grid size-8 shrink-0 place-items-center rounded-lg"
                style={{ background: 'var(--accent-soft)', color: 'var(--accent)' }}
              >
                <Icon name="chat" className="size-4" />
              </span>
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-semibold">Sales assistant</p>
                <p className="truncate text-[11px]" style={{ color: 'var(--text-muted)' }}>
                  {props.orders.length} orders · answers from your own data
                </p>
              </div>
              <button
                type="button"
                aria-label="Close the sales assistant"
                onClick={close}
                className="grid size-8 place-items-center rounded-lg"
                style={{ color: 'var(--text-muted)' }}
              >
                <Icon name="close" className="size-4" />
              </button>
            </header>

            <div className="min-h-0 flex-1 overflow-y-auto px-4 py-3">
              <AssistantPanel menu={props.menu} orders={props.orders} />
            </div>
          </div>
        </>
      )}

      <button
        ref={buttonRef}
        type="button"
        aria-label={open ? 'Close the sales assistant' : 'Open the sales assistant'}
        aria-expanded={open}
        onClick={() => (open ? close() : setOpen(true))}
        className="btn-primary fixed bottom-20 right-4 z-50 grid size-14 place-items-center !rounded-full shadow-lg transition-transform hover:scale-105 motion-reduce:transition-none motion-reduce:hover:scale-100 lg:bottom-5"
        style={{ boxShadow: 'var(--shadow-pop)' }}
      >
        <Icon name={open ? 'close' : 'chat'} className="size-6" />
        {!open && (
          <span
            aria-hidden
            className="absolute right-3.5 top-3.5 size-2 rounded-full ring-2"
            style={{ background: 'var(--ok)', '--tw-ring-color': 'var(--accent)' } as React.CSSProperties}
          />
        )}
      </button>
    </>
  );
}
