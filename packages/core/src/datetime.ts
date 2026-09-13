/**
 * The date and time forms blendx accepts as input (docs/decisions.md D23). A date is
 * YYYY-MM-DD naming a real day. A timestamp is such a date, a `T` or a space, a time with
 * optional seconds and fraction, and an optional offset: ISO 8601, or the text form
 * PostgreSQL replies with. Anything else PostgreSQL would read (`yesterday`, `now`, other
 * orders) is refused, so what an input means never depends on the database's settings.
 */

const DATE = /^(\d{4})-(\d{2})-(\d{2})$/;
const TIMESTAMP =
  /^(\d{4})-(\d{2})-(\d{2})[T ](\d{2}):(\d{2})(?::(\d{2})(?:\.\d+)?)?(?:Z|[+-](\d{2})(?::?(\d{2}))?)?$/;

/** The shape of a timestamp, for JSON Schema; isTimestampText also checks the values. */
export const TIMESTAMP_PATTERN = TIMESTAMP.source;

/** PostgreSQL refuses a UTC offset beyond 15:59 (its MAX_TZDISP_HOUR). */
const MAX_OFFSET_HOURS = 15;

const DAYS_IN_MONTH = [31, 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];

const isLeapYear = (year: number) => (year % 4 === 0 && year % 100 !== 0) || year % 400 === 0;

/** Year 1 or later (PostgreSQL has no year 0), a month, and a day that month has. */
function isRealDay(year: number, month: number, day: number): boolean {
  if (year < 1 || month < 1 || month > 12 || day < 1) return false;
  const days = month === 2 && isLeapYear(year) ? 29 : (DAYS_IN_MONTH[month - 1] ?? 0);
  return day <= days;
}

/** YYYY-MM-DD naming a real day. */
export function isDateText(value: string): boolean {
  const match = DATE.exec(value);
  return match !== null && isRealDay(Number(match[1]), Number(match[2]), Number(match[3]));
}

/** A real day and time, in ISO 8601 or in PostgreSQL's text form. */
export function isTimestampText(value: string): boolean {
  const match = TIMESTAMP.exec(value);
  if (!match) return false;
  const [, year, month, day, hour, minute, second = '0', offsetHours = '0', offsetMinutes = '0'] =
    match;
  return (
    isRealDay(Number(year), Number(month), Number(day)) &&
    Number(hour) <= 23 &&
    Number(minute) <= 59 &&
    Number(second) <= 59 &&
    Number(offsetHours) <= MAX_OFFSET_HOURS &&
    Number(offsetMinutes) <= 59
  );
}
