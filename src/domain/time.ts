/**
 * Time-zone helpers. Every caller passes a server-supplied `Date`; nothing
 * in the domain ever reads `Date.now()`.
 */

/** Minutes since midnight in `timeZone`, e.g. 10:59 -> 659. */
export function minutesOfDayIn(date: Date, timeZone: string): number {
  const parts = new Intl.DateTimeFormat('en-GB', {
    timeZone,
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  }).formatToParts(date);
  const hour = Number(parts.find((part) => part.type === 'hour')?.value ?? '0');
  const minute = Number(parts.find((part) => part.type === 'minute')?.value ?? '0');
  return hour * 60 + minute;
}

/** Parses "11:00" into minutes since midnight. */
export function parseHhMm(value: string): number {
  const match = /^(\d{1,2}):(\d{2})$/.exec(value.trim());
  if (!match) throw new Error(`Expected "HH:mm", got "${value}"`);
  const hour = Number(match[1]);
  const minute = Number(match[2]);
  if (hour > 23 || minute > 59) throw new Error(`Not a valid time: "${value}"`);
  return hour * 60 + minute;
}

/** True while the local clock in `timeZone` is STRICTLY before "HH:mm". */
export function isStrictlyBefore(
  date: Date,
  hhmm: string,
  timeZone: string,
): boolean {
  return minutesOfDayIn(date, timeZone) < parseHhMm(hhmm);
}

/** Calendar date in `timeZone` as "YYYY-MM-DD". */
export function isoDateIn(date: Date, timeZone: string): string {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(date);
  const year = parts.find((part) => part.type === 'year')?.value ?? '0000';
  const month = parts.find((part) => part.type === 'month')?.value ?? '01';
  const day = parts.find((part) => part.type === 'day')?.value ?? '01';
  return `${year}-${month}-${day}`;
}

/** "25 November 2026, 10:59 pm" - for the UI only. */
export function formatInZone(date: Date, timeZone: string): string {
  return date.toLocaleString('en-GB', {
    timeZone,
    day: 'numeric',
    month: 'long',
    year: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
    hour12: true,
  });
}

/**
 * ISO 8601 carrying the zone's own offset, e.g.
 * "2026-11-25T22:42:00+06:00". Stored order timestamps use this so the
 * Bangladesh wall-clock time is readable without converting anything.
 */
export function toIsoWithOffset(date: Date, timeZone: string): string {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hourCycle: 'h23',
  }).formatToParts(date);
  const pick = (type: Intl.DateTimeFormatPartTypes, fallback: string): string =>
    parts.find((part) => part.type === type)?.value ?? fallback;

  const stamp = `${pick('year', '0000')}-${pick('month', '01')}-${pick('day', '01')}T${pick('hour', '00')}:${pick('minute', '00')}:${pick('second', '00')}`;
  const offsetMinutes = Math.round((Date.parse(`${stamp}Z`) - date.getTime()) / 60000);
  const sign = offsetMinutes >= 0 ? '+' : '-';
  const abs = Math.abs(offsetMinutes);
  const hh = String(Math.floor(abs / 60)).padStart(2, '0');
  const mm = String(abs % 60).padStart(2, '0');
  return `${stamp}${sign}${hh}:${mm}`;
}
