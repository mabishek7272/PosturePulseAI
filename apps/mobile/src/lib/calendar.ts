// Pure calendar helpers for the date-of-birth picker. No React, no Date-locale
// surprises: every date is handled as year / month (1-12) / day, and dates are
// ISO "YYYY-MM-DD" strings, the same format the server validates.

export const MONTH_NAMES = [
  "January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December",
];
export const WEEKDAY_LABELS = ["Mo", "Tu", "We", "Th", "Fr", "Sa", "Su"];

export interface YMD {
  year: number;
  month: number; // 1-12
  day: number;
}

export function isLeapYear(year: number): boolean {
  return (year % 4 === 0 && year % 100 !== 0) || year % 400 === 0;
}

export function daysInMonth(year: number, month: number): number {
  if (month === 2) return isLeapYear(year) ? 29 : 28;
  return [4, 6, 9, 11].includes(month) ? 30 : 31;
}

const pad = (n: number, width: number) => String(n).padStart(width, "0");

export function toIsoDate({ year, month, day }: YMD): string {
  return `${pad(year, 4)}-${pad(month, 2)}-${pad(day, 2)}`;
}

/** null for anything that is not a real calendar date (30 Feb, month 13, free text). */
export function parseIsoDate(value: string): YMD | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (!m) return null;
  const year = Number(m[1]);
  const month = Number(m[2]);
  const day = Number(m[3]);
  if (month < 1 || month > 12 || day < 1 || day > daysInMonth(year, month)) return null;
  return { year, month, day };
}

export function todayYmd(now: Date = new Date()): YMD {
  return { year: now.getFullYear(), month: now.getMonth() + 1, day: now.getDate() };
}

/** Negative when a is before b, 0 when equal, positive when after. */
export function compareYmd(a: YMD, b: YMD): number {
  return a.year - b.year || a.month - b.month || a.day - b.day;
}

/** A birth date cannot be in the future (the server refuses it too). */
export function isFutureDate(date: YMD, now: Date = new Date()): boolean {
  return compareYmd(date, todayYmd(now)) > 0;
}

/** Weekday of the 1st, Monday = 0 ... Sunday = 6. Zeller-free: uses the platform Date for the one fact it is good at. */
export function firstWeekdayMondayFirst(year: number, month: number): number {
  const sundayFirst = new Date(Date.UTC(year, month - 1, 1)).getUTCDay();
  return (sundayFirst + 6) % 7;
}

/**
 * The month as weeks of 7 cells, Monday first. A cell is a day number or null
 * for the padding before the 1st and after the last day.
 */
export function monthGrid(year: number, month: number): Array<Array<number | null>> {
  const lead = firstWeekdayMondayFirst(year, month);
  const total = daysInMonth(year, month);
  const cells: Array<number | null> = [...Array(lead).fill(null), ...Array.from({ length: total }, (_, i) => i + 1)];
  while (cells.length % 7 !== 0) cells.push(null);
  const weeks: Array<Array<number | null>> = [];
  for (let i = 0; i < cells.length; i += 7) weeks.push(cells.slice(i, i + 7));
  return weeks;
}

/** Step the visible month by delta, rolling the year. */
export function shiftMonth(year: number, month: number, delta: number): { year: number; month: number } {
  const index = year * 12 + (month - 1) + delta;
  return { year: Math.floor(index / 12), month: (index % 12) + 1 };
}

/** The year list for a birth date, newest first. */
export function birthYears(now: Date = new Date(), span = 110): number[] {
  const current = now.getFullYear();
  return Array.from({ length: span + 1 }, (_, i) => current - i);
}

/** "12 March 1984" for display; the ISO value stays the stored one. */
export function formatLongDate(value: string): string {
  const d = parseIsoDate(value);
  return d ? `${d.day} ${MONTH_NAMES[d.month - 1]} ${d.year}` : value;
}
