/**
 * TC-12 - "an older response must never replace a newer configuration's
 * price".
 *
 * Every call gets a monotonically rising ticket. A result is delivered only
 * if its ticket is still the newest one, and the superseded request is
 * aborted as well, so a slow 1500 ms response that lands after a fast
 * 200 ms one is dropped instead of overwriting it.
 */

export type LatestResult<T> =
  | { readonly fresh: true; readonly value: T }
  | { readonly fresh: false };

export class LatestOnly {
  private ticket = 0;
  private inFlight: AbortController | null = null;

  /**
   * Runs `task` as the newest request. Resolves `{ fresh: false }` when a
   * later call started before this one finished.
   */
  async run<T>(task: (signal: AbortSignal) => Promise<T>): Promise<LatestResult<T>> {
    this.inFlight?.abort();
    const controller = new AbortController();
    this.inFlight = controller;
    const mine = ++this.ticket;

    try {
      const value = await task(controller.signal);
      if (mine !== this.ticket) return { fresh: false };
      return { fresh: true, value };
    } finally {
      if (this.inFlight === controller) this.inFlight = null;
    }
  }

  /** Drops any in-flight request, e.g. when the panel closes. */
  cancel(): void {
    this.inFlight?.abort();
    this.inFlight = null;
    this.ticket += 1;
  }

  get isBusy(): boolean {
    return this.inFlight !== null;
  }
}

/**
 * Trailing-edge debounce. The price preview debounces configuration changes
 * by 300 ms before it calls `/price` at all.
 */
export function debounce<TArgs extends readonly unknown[]>(
  fn: (...args: TArgs) => void,
  waitMs: number,
): ((...args: TArgs) => void) & { cancel(): void } {
  let timer: ReturnType<typeof setTimeout> | null = null;
  const wrapped = (...args: TArgs): void => {
    if (timer !== null) clearTimeout(timer);
    timer = setTimeout(() => {
      timer = null;
      fn(...args);
    }, waitMs);
  };
  wrapped.cancel = (): void => {
    if (timer !== null) clearTimeout(timer);
    timer = null;
  };
  return wrapped;
}
