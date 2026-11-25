import { createContext, useContext } from 'react';

/**
 * The toast context and its hook live apart from the component that
 * provides them, so the provider file exports components only — which is
 * what React Fast Refresh needs to hot-swap it.
 */

export type ToastKind = 'success' | 'error' | 'info';

export interface Toast {
  readonly id: number;
  readonly kind: ToastKind;
  readonly title: string;
  readonly detail?: string;
  /** Extra lines, e.g. one per short ingredient. */
  readonly lines?: readonly string[];
}

export interface ToastApi {
  success(title: string, detail?: string): void;
  error(title: string, options?: { detail?: string; lines?: readonly string[] }): void;
  info(title: string, detail?: string): void;
  dismiss(id: number): void;
}

export const ToastContext = createContext<ToastApi | null>(null);

export function useToast(): ToastApi {
  const api = useContext(ToastContext);
  if (api === null) throw new Error('useToast must be used inside <ToastProvider>');
  return api;
}
