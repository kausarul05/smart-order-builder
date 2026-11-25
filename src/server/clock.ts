/**
 * The mock server's clock. It deliberately runs 90 seconds AHEAD of the
 * browser, so any countdown or expiry computed from `Date.now()` is wrong
 * by a minute and a half and TC-15 catches it.
 *
 * Every server response carries `serverTime`; the client derives an offset
 * from it (see `src/api/client.ts`) and never reads the wall clock itself.
 */

export const SERVER_CLOCK_SKEW_MS = 90_000;

/** Reservation lifetime, on the server clock. */
export const RESERVATION_TTL_MS = 5 * 60_000;

export const SERVER_TIME_ZONE = 'Asia/Dhaka';

export interface Clock {
  now(): Date;
}

/** The browser's own clock. */
export const systemClock: Clock = { now: () => new Date() };

/** A clock shifted by a fixed number of milliseconds. */
export function shiftedClock(base: Clock, skewMs: number): Clock {
  return { now: () => new Date(base.now().getTime() + skewMs) };
}

/**
 * A clock the tests drive by hand, so TC-15 can step past 5:00 without
 * waiting five real minutes.
 */
export function manualClock(start: Date): Clock & {
  advance(ms: number): void;
  set(at: Date): void;
} {
  let current = start.getTime();
  return {
    now: () => new Date(current),
    advance(ms: number) {
      current += ms;
    },
    set(at: Date) {
      current = at.getTime();
    },
  };
}

let active: Clock = shiftedClock(systemClock, SERVER_CLOCK_SKEW_MS);

/** The clock the mock server answers with. */
export function serverClock(): Clock {
  return active;
}

export function serverNow(): Date {
  return active.now();
}

/** Tests swap in a manual clock; `resetServerClock` puts the skew back. */
export function setServerClock(clock: Clock): void {
  active = clock;
}

export function resetServerClock(): void {
  active = shiftedClock(systemClock, SERVER_CLOCK_SKEW_MS);
}
