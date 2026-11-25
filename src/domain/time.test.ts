import { describe, expect, it } from 'vitest';

import {
  isStrictlyBefore,
  isoDateIn,
  minutesOfDayIn,
  parseHhMm,
  toIsoWithOffset,
} from './time';

const DHAKA = 'Asia/Dhaka';

describe('parseHhMm', () => {
  it('parses an "HH:mm" string', () => {
    expect(parseHhMm('11:00')).toBe(660);
    expect(parseHhMm('00:00')).toBe(0);
    expect(parseHhMm('9:05')).toBe(545);
  });

  it('rejects anything else', () => {
    expect(() => parseHhMm('11')).toThrow();
    expect(() => parseHhMm('25:00')).toThrow();
  });
});

describe('minutesOfDayIn', () => {
  it('reads the wall clock in Asia/Dhaka, not the host zone', () => {
    expect(minutesOfDayIn(new Date('2026-11-25T10:59:59+06:00'), DHAKA)).toBe(659);
    expect(minutesOfDayIn(new Date('2026-11-25T11:00:00+06:00'), DHAKA)).toBe(660);
  });

  it('converts an instant given in another zone', () => {
    // 05:00 UTC is 11:00 in Dhaka.
    expect(minutesOfDayIn(new Date('2026-11-25T05:00:00Z'), DHAKA)).toBe(660);
  });

  it('handles midnight and the last minute of the day', () => {
    expect(minutesOfDayIn(new Date('2026-11-25T00:00:00+06:00'), DHAKA)).toBe(0);
    expect(minutesOfDayIn(new Date('2026-11-25T23:59:00+06:00'), DHAKA)).toBe(1439);
  });
});

describe('isStrictlyBefore - the MORNING15 window', () => {
  it('is true at 10:59:59', () => {
    expect(isStrictlyBefore(new Date('2026-11-25T10:59:59+06:00'), '11:00', DHAKA)).toBe(
      true,
    );
  });

  it('is false at exactly 11:00:00', () => {
    expect(isStrictlyBefore(new Date('2026-11-25T11:00:00+06:00'), '11:00', DHAKA)).toBe(
      false,
    );
  });

  it('is false after 11:00', () => {
    expect(isStrictlyBefore(new Date('2026-11-25T13:10:00+06:00'), '11:00', DHAKA)).toBe(
      false,
    );
  });

  it('judges the Dhaka clock even for an instant expressed in UTC', () => {
    // 04:59 UTC = 10:59 Dhaka -> inside the window.
    expect(isStrictlyBefore(new Date('2026-11-25T04:59:00Z'), '11:00', DHAKA)).toBe(true);
    // 05:00 UTC = 11:00 Dhaka -> outside it.
    expect(isStrictlyBefore(new Date('2026-11-25T05:00:00Z'), '11:00', DHAKA)).toBe(false);
  });
});

describe('isoDateIn', () => {
  it('gives the Dhaka calendar date', () => {
    expect(isoDateIn(new Date('2026-11-20T09:15:00+06:00'), DHAKA)).toBe('2026-11-20');
  });

  it('does not slip a day for a late-evening order', () => {
    // 19:30 Dhaka is 13:30 UTC; the date must stay the 21st.
    expect(isoDateIn(new Date('2026-11-21T19:30:00+06:00'), DHAKA)).toBe('2026-11-21');
  });

  it('rolls over correctly just after Dhaka midnight', () => {
    // 2026-11-25T18:30:00Z is 2026-11-26T00:30 in Dhaka.
    expect(isoDateIn(new Date('2026-11-25T18:30:00Z'), DHAKA)).toBe('2026-11-26');
  });
});

describe('toIsoWithOffset', () => {
  it('writes the Dhaka wall clock with its +06:00 offset', () => {
    expect(toIsoWithOffset(new Date('2026-11-20T09:15:00+06:00'), DHAKA)).toBe(
      '2026-11-20T09:15:00+06:00',
    );
  });

  it('round-trips to the same instant', () => {
    const original = new Date('2026-11-22T13:10:00+06:00');
    expect(Date.parse(toIsoWithOffset(original, DHAKA))).toBe(original.getTime());
  });

  it('converts an instant given in UTC', () => {
    expect(toIsoWithOffset(new Date('2026-11-25T05:00:00Z'), DHAKA)).toBe(
      '2026-11-25T11:00:00+06:00',
    );
  });
});
