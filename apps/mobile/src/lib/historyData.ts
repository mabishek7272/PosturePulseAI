import type { SessionSummary } from "../api/sessions-list";
import { daysAgo } from "./homeData";

export const STATE_LABEL: Record<string, string> = {
  Setup: "Setting up",
  Observing: "In progress",
  Pause: "Paused",
  ClinicianReview: "Needs review",
};

const MONTHS_SHORT = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

/** Plain-words state; unknown states are shown as the server sent them. */
export function stateLabel(state: string): string {
  return STATE_LABEL[state] ?? state;
}

/** Newest first, so list position maps directly to the ordinal. Invalid dates sort last. */
export function sortNewestFirst(sessions: SessionSummary[]): SessionSummary[] {
  const t = (s: SessionSummary) => {
    const n = new Date(s.createdAt).getTime();
    return Number.isNaN(n) ? Number.NEGATIVE_INFINITY : n;
  };
  return [...sessions].sort((a, b) => t(b) - t(a));
}

/** Ordinal for the item at `index` of a newest-first list: the newest gets the highest number. */
export function ordinalAt(index: number, total: number): number {
  return total - index;
}

/**
 * Human label from a protocol id ("bodyweight-squat" -> "Bodyweight squat").
 * Null when the id carries no label of its own (the generic "assessment-..." ids).
 */
export function protocolLabel(protocolId: string): string | null {
  const base = protocolId.trim().replace(/\.v\d.*$/i, "");
  const words = base.split(/[-_\s]+/).filter(Boolean);
  const [first] = words;
  if (!first || first.toLowerCase() === "assessment") return null;
  const text = words.join(" ").toLowerCase();
  return text.charAt(0).toUpperCase() + text.slice(1);
}

export function cardTitle(protocolId: string): string {
  const label = protocolLabel(protocolId);
  return label ? `Assessment · ${label}` : "Assessment";
}

/** "Today", else "6 Oct" (with the year when it is not the current one). */
export function dateChip(iso: string, now: Date): string {
  const n = daysAgo(iso, now);
  if (Number.isNaN(n)) return "Unknown date";
  if (n === 0) return "Today";
  const d = new Date(iso);
  const base = `${d.getDate()} ${MONTHS_SHORT[d.getMonth()]}`;
  return d.getFullYear() === now.getFullYear() ? base : `${base} ${d.getFullYear()}`;
}

/** Short form of a pseudonymous subject id. */
export function shortSubjectId(id: string): string {
  return id.length > 12 ? `${id.slice(0, 8)}…` : id;
}

/** Real facts only: state in plain words, then the subject's short pseudonymous id. */
export function summaryLine(s: SessionSummary): string {
  return `${stateLabel(s.state)} · Subject ${shortSubjectId(s.subjectPseudoId)}`;
}

export function sessionCountLabel(count: number, truncated: boolean): string {
  return `${count}${truncated ? "+" : ""} ${count === 1 && !truncated ? "session" : "sessions"}`;
}
