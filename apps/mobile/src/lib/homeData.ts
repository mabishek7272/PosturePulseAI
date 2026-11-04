import type { SessionSummary } from "../api/sessions-list";

/** Decode the JWT payload's `username` claim (display only - never trusted for auth). */
export function usernameFromToken(token: string | null): string | null {
  if (!token) return null;
  const part = token.split(".")[1];
  if (!part) return null;
  try {
    const b64 = part.replace(/-/g, "+").replace(/_/g, "/");
    const padded = b64 + "=".repeat((4 - (b64.length % 4)) % 4);
    const payload = JSON.parse(decodeURIComponent(escape(atob(padded)))) as { username?: unknown };
    return typeof payload.username === "string" && payload.username.trim() ? payload.username.trim() : null;
  } catch {
    return null;
  }
}

/** Up to two uppercase initials: first letters of two words, else the first two letters. */
export function initialsOf(name: string): string {
  const words = name.trim().split(/[\s._-]+/).filter(Boolean);
  const [first, second] = words;
  if (!first) return "?"; // no words
  if (!second) return first.slice(0, 2).toUpperCase();
  // `charAt(0)` rather than `[0]`: same character, typed `string` not `string | undefined`.
  return (first.charAt(0) + second.charAt(0)).toUpperCase();
}

const MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
const DAYS = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];

/** "Tuesday, 3 November" (device-local date). */
export function formatLongDate(now: Date): string {
  return `${DAYS[now.getDay()]}, ${now.getDate()} ${MONTHS[now.getMonth()]}`;
}

function startOfDay(d: Date): number {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
}

/** Whole local calendar days between `iso` and `now` (0 = today). */
export function daysAgo(iso: string, now: Date): number {
  const t = new Date(iso);
  if (Number.isNaN(t.getTime())) return Number.NaN;
  return Math.round((startOfDay(now) - startOfDay(t)) / 86_400_000);
}

export function relativeDate(iso: string, now: Date): string {
  const n = daysAgo(iso, now);
  if (Number.isNaN(n)) return "Unknown date";
  if (n <= 0) return "Today";
  if (n === 1) return "Yesterday";
  if (n < 7) return `${n} days ago`;
  return new Date(iso).toLocaleDateString();
}

/** Session counts for the last `days` local days, oldest first, last entry = today. */
export function dayCounts(sessions: SessionSummary[], now: Date, days: number): number[] {
  const out = new Array<number>(days).fill(0);
  for (const s of sessions) {
    const n = daysAgo(s.createdAt, now);
    if (n >= 0 && n < days) {
      // `daysAgo` rounds, so n is an integer and the slot is in range.
      const slot = days - 1 - n;
      out[slot] = (out[slot] ?? 0) + 1;
    }
  }
  return out;
}

export interface HomeStats {
  today: number;
  /** Today's sessions that have moved past Setup (observation began). */
  todayStarted: number;
  week: number;
  /** Last 5 days, oldest first. */
  bars: number[];
}

export function homeStats(sessions: SessionSummary[], now: Date): HomeStats {
  const todays = sessions.filter((s) => daysAgo(s.createdAt, now) === 0);
  return {
    today: todays.length,
    todayStarted: todays.filter((s) => s.state !== "Setup").length,
    week: dayCounts(sessions, now, 7).reduce((a, b) => a + b, 0),
    bars: dayCounts(sessions, now, 5),
  };
}

/** Bar heights as 0..1 of the tallest day; empty days get no height. */
export function barFractions(counts: number[]): number[] {
  const max = Math.max(0, ...counts);
  return counts.map((c) => (max === 0 ? 0 : c / max));
}

/** Row meta line from real fields only: completed years from an ISO date of birth, then the date itself. */
export function patientMeta(dateOfBirth: string, now: Date): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(dateOfBirth);
  if (!m) return dateOfBirth;
  const [y, mo, d] = [Number(m[1]), Number(m[2]), Number(m[3])];
  let age = now.getFullYear() - y;
  if (now.getMonth() + 1 < mo || (now.getMonth() + 1 === mo && now.getDate() < d)) age -= 1;
  return age >= 0 ? `${age}y · ${dateOfBirth}` : dateOfBirth;
}
