import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';

import {
  ToastContext,
  type Toast,
  type ToastApi,
  type ToastKind,
} from './toastContext';

/**
 * Toasts, hand-rolled rather than pulled in as a dependency: the whole
 * thing is one context, one reducer-free state array and a timer.
 *
 * Accessibility matters more than the animation here. The region is an
 * `aria-live` log, an error is `role="alert"` so a screen reader announces
 * it immediately, and an error toast does NOT auto-dismiss - a shortage
 * message is something the user has to read.
 */


/**
 * Every toast goes on its own. An error gets much longer than the rest -
 * "Short: 2 egg, 2 cheese" has to be readable - but it does not sit there
 * forever, because the same message is also inline next to the draft,
 * where it belongs. A toast that never leaves just becomes furniture.
 *
 * The countdown pauses while the pointer or the keyboard is on the toast,
 * so reading it cannot time out underneath you.
 */
const AUTO_DISMISS_MS: Record<ToastKind, number | null> = {
  success: 3200,
  info: 3200,
  error: 8000,
};

export function ToastProvider(props: {
  readonly children: ReactNode;
  /**
   * Overrides how long a self-dismissing toast lives. Only the tests pass
   * it, so they do not have to wait out the real 3.2 seconds; an error is
   * still never dismissed on its own.
   */
  readonly autoDismissMs?: number;
}) {
  const [toasts, setToasts] = useState<readonly Toast[]>([]);
  const nextId = useRef(0);
  const timers = useRef(new Map<number, ReturnType<typeof setTimeout>>());
  /** How long each toast still has, so a pause can resume accurately. */
  const remaining = useRef(new Map<number, { left: number; startedAt: number }>());

  const dismiss = useCallback((id: number): void => {
    const timer = timers.current.get(id);
    if (timer !== undefined) {
      clearTimeout(timer);
      timers.current.delete(id);
    }
    remaining.current.delete(id);
    setToasts((current) => current.filter((toast) => toast.id !== id));
  }, []);

  const arm = useCallback(
    (id: number, ms: number): void => {
      remaining.current.set(id, { left: ms, startedAt: Date.now() });
      timers.current.set(
        id,
        setTimeout(() => dismiss(id), ms),
      );
    },
    [dismiss],
  );

  /** Pointer or focus on a toast freezes its countdown. */
  const hold = useCallback((id: number): void => {
    const timer = timers.current.get(id);
    const state = remaining.current.get(id);
    if (timer === undefined || state === undefined) return;
    clearTimeout(timer);
    timers.current.delete(id);
    remaining.current.set(id, {
      left: Math.max(600, state.left - (Date.now() - state.startedAt)),
      startedAt: Date.now(),
    });
  }, []);

  const release = useCallback(
    (id: number): void => {
      const state = remaining.current.get(id);
      if (state === undefined || timers.current.has(id)) return;
      arm(id, state.left);
    },
    [arm],
  );

  const push = useCallback(
    (toast: Omit<Toast, 'id'>): void => {
      const id = nextId.current++;
      setToasts((current) => [...current.slice(-3), { ...toast, id }]);
      const base = AUTO_DISMISS_MS[toast.kind];
      const ms = base === null ? null : (props.autoDismissMs ?? base);
      if (ms !== null) arm(id, ms);
    },
    [arm, props.autoDismissMs],
  );

  useEffect(
    () => () => {
      for (const timer of timers.current.values()) clearTimeout(timer);
      timers.current.clear();
      remaining.current.clear();
    },
    [],
  );

  const api = useMemo<ToastApi>(
    () => ({
      success: (title, detail) =>
        push(detail === undefined ? { kind: 'success', title } : { kind: 'success', title, detail }),
      error: (title, options) =>
        push({
          kind: 'error',
          title,
          ...(options?.detail === undefined ? {} : { detail: options.detail }),
          ...(options?.lines === undefined ? {} : { lines: options.lines }),
        }),
      info: (title, detail) =>
        push(detail === undefined ? { kind: 'info', title } : { kind: 'info', title, detail }),
      dismiss,
    }),
    [dismiss, push],
  );

  const viewport = { toasts, onDismiss: dismiss, onHold: hold, onRelease: release };

  return (
    <ToastContext.Provider value={api}>
      {props.children}
      <ToastViewport {...viewport} />
    </ToastContext.Provider>
  );
}

const ACCENT: Record<ToastKind, string> = {
  success: 'var(--ok)',
  error: 'var(--danger)',
  info: 'var(--accent)',
};

const GLYPH: Record<ToastKind, string> = {
  success: '✓',
  error: '!',
  info: 'i',
};

function ToastViewport(props: {
  readonly toasts: readonly Toast[];
  onDismiss(id: number): void;
  onHold(id: number): void;
  onRelease(id: number): void;
}) {
  return (
    <div
      // Full width above the sticky bar on a phone, a stack in the corner
      // from tablet up.
      // Stacked clear of the sticky order bar on a phone and of the
      // assistant launcher on every size.
      className="pointer-events-none fixed inset-x-3 bottom-[9.5rem] z-50 flex flex-col gap-2 sm:inset-x-auto sm:bottom-40 sm:right-4 sm:w-96 lg:bottom-24"
      aria-live="polite"
      aria-relevant="additions"
    >
      {props.toasts.map((toast) => (
        <div
          key={toast.id}
          role={toast.kind === 'error' ? 'alert' : 'status'}
          onMouseEnter={() => props.onHold(toast.id)}
          onMouseLeave={() => props.onRelease(toast.id)}
          onFocusCapture={() => props.onHold(toast.id)}
          onBlurCapture={() => props.onRelease(toast.id)}
          className="toast-in pointer-events-auto flex items-start gap-3 rounded-xl border p-3 shadow-lg backdrop-blur"
          style={{
            borderColor: 'var(--border)',
            background: 'var(--surface-raised)',
            borderLeft: `3px solid ${ACCENT[toast.kind]}`,
          }}
        >
          <span
            aria-hidden
            className="mt-0.5 grid size-5 shrink-0 place-items-center rounded-full text-xs font-bold"
            style={{ background: ACCENT[toast.kind], color: 'var(--surface)' }}
          >
            {GLYPH[toast.kind]}
          </span>

          <div className="min-w-0 flex-1">
            <p className="text-sm font-medium">{toast.title}</p>
            {toast.detail !== undefined && (
              <p className="mt-0.5 text-xs" style={{ color: 'var(--text-muted)' }}>
                {toast.detail}
              </p>
            )}
            {toast.lines !== undefined && toast.lines.length > 0 && (
              <ul className="mt-1 space-y-0.5 text-xs tnum" style={{ color: 'var(--text-muted)' }}>
                {toast.lines.map((line) => (
                  <li key={line}>{line}</li>
                ))}
              </ul>
            )}
          </div>

          <button
            type="button"
            aria-label="Dismiss notification"
            onClick={() => props.onDismiss(toast.id)}
            className="shrink-0 rounded-md px-1.5 text-sm leading-none opacity-60 hover:opacity-100"
            style={{ color: 'var(--text-muted)' }}
          >
            ×
          </button>
        </div>
      ))}
    </div>
  );
}
