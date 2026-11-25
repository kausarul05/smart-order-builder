/**
 * TC-12 - the async price preview.
 *
 *   - configuration changes are debounced by 300 ms before `/price` is called
 *   - `/price` answers in 200-1500 ms and fails 15 % of the time
 *   - an older response must never replace a newer configuration's price
 *   - on failure the configuration is kept and Retry is offered
 *
 * Staleness is handled by `LatestOnly`, which hands every call a rising
 * ticket, aborts the superseded request and drops any result that is no
 * longer the newest. So a slow 1500 ms answer landing after a fast 200 ms
 * one is discarded rather than painted over the screen.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

import { api } from '@/api/client';
import { LatestOnly } from '@/lib/latestOnly';
import type { PriceBreakdown, Selection } from '@/domain/types';

export const PRICE_DEBOUNCE_MS = 300;

export interface PricePreview {
  readonly breakdown: PriceBreakdown | null;
  readonly loading: boolean;
  readonly error: string | null;
  /** Re-requests the CURRENT configuration after a failure. */
  retry(): void;
}

export interface PricePreviewInput {
  readonly selection: Selection;
  readonly qty: number;
  readonly couponCode?: string | null;
  /** Skip the request entirely while the configuration is invalid. */
  readonly enabled: boolean;
}

export function usePricePreview(input: PricePreviewInput): PricePreview {
  const { selection, qty, couponCode = null, enabled } = input;

  const [breakdown, setBreakdown] = useState<PriceBreakdown | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [attempt, setAttempt] = useState(0);

  const latest = useMemo(() => new LatestOnly(), []);
  const requestId = useRef(0);

  // The selection is an object, so a stable key keeps the effect from
  // firing on every render.
  const key = useMemo(
    () => JSON.stringify({ selection: sortedEntries(selection), qty, couponCode }),
    [selection, qty, couponCode],
  );

  useEffect(() => {
    if (!enabled) {
      latest.cancel();
      setBreakdown(null);
      setLoading(false);
      setError(null);
      return;
    }

    setLoading(true);
    setError(null);

    const timer = setTimeout(() => {
      requestId.current += 1;
      const id = String(requestId.current);

      void latest
        .run((signal) =>
          api.price({ cart: [{ selection, qty }], couponCode, requestId: id }, signal),
        )
        .then((result) => {
          // A superseded request resolves `fresh: false` and is ignored,
          // so the newer configuration's price stays on screen.
          if (!result.fresh) return;
          setBreakdown(result.value.breakdown);
          setLoading(false);
        })
        .catch((cause: unknown) => {
          if (cause instanceof DOMException && cause.name === 'AbortError') return;
          setError(cause instanceof Error ? cause.message : 'Could not get a price');
          setLoading(false);
        });
    }, PRICE_DEBOUNCE_MS);

    return () => clearTimeout(timer);
    // `key` stands in for selection/qty/couponCode by value.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key, enabled, attempt, latest]);

  useEffect(() => () => latest.cancel(), [latest]);

  const retry = useCallback(() => setAttempt((count) => count + 1), []);

  return { breakdown, loading, error, retry };
}

function sortedEntries(selection: Selection): readonly [string, number][] {
  return Object.entries(selection)
    .filter(([, units]) => units > 0)
    .sort(([a], [b]) => a.localeCompare(b));
}
