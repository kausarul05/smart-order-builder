import { useEffect, useState } from 'react';

import { api } from '@/api/client';

/**
 * A ticking clock that reads the SERVER's time, not the browser's.
 *
 * `api.serverNow()` is `Date.now()` plus the offset learned from the last
 * response's `serverTime`. The mock server runs 90 seconds ahead on
 * purpose, so a countdown built on `Date.now()` would be a minute and a
 * half wrong and TC-15 would fail.
 */
export function useServerClock(intervalMs = 250): Date {
  const [now, setNow] = useState(() => api.serverNow());

  useEffect(() => {
    const tick = (): void => setNow(api.serverNow());
    tick();
    const timer = setInterval(tick, intervalMs);
    // A backgrounded tab throttles timers, so resync when it comes back.
    const onVisible = (): void => {
      if (document.visibilityState === 'visible') tick();
    };
    document.addEventListener('visibilitychange', onVisible);
    return () => {
      clearInterval(timer);
      document.removeEventListener('visibilitychange', onVisible);
    };
  }, [intervalMs]);

  return now;
}

/** "4:37" — a countdown, floored to the second. */
export function formatCountdown(ms: number): string {
  const total = Math.max(0, Math.floor(ms / 1000));
  const minutes = Math.floor(total / 60);
  const seconds = total % 60;
  return `${minutes}:${String(seconds).padStart(2, '0')}`;
}
