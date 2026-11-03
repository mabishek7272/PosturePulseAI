import type { SessionSummary } from "../api/sessions-list";
import { cardTitle, dateChip, ordinalAt, protocolLabel, sessionCountLabel, shortSubjectId, sortNewestFirst, summaryLine } from "./historyData";

const now = new Date(2026, 10, 3, 12, 0, 0);
const s = (iso: string, state = "Observing", subjectPseudoId = "abc"): SessionSummary => ({ id: iso, state, createdAt: iso, protocolId: "p", subjectPseudoId });

describe("historyData", () => {
  it("sorts newest first and numbers newest highest", () => {
    const a = s(new Date(2026, 10, 1).toISOString());
    const b = s(new Date(2026, 10, 3).toISOString());
    const c = s(new Date(2026, 9, 20).toISOString());
    const sorted = sortNewestFirst([a, c, b]);
    expect(sorted).toEqual([b, a, c]);
    expect(sorted.map((_, i) => ordinalAt(i, sorted.length))).toEqual([3, 2, 1]);
  });
  it("labels protocols only when the id carries one", () => {
    expect(protocolLabel("bodyweight-squat")).toBe("Bodyweight squat");
    expect(protocolLabel("sit-to-stand.v0-draft")).toBe("Sit to stand");
    expect(protocolLabel("assessment-battery")).toBeNull();
    expect(cardTitle("assessment-battery")).toBe("Assessment");
    expect(cardTitle("bodyweight-squat")).toBe("Assessment · Bodyweight squat");
  });
  it("formats the date chip", () => {
    expect(dateChip(new Date(2026, 10, 3, 8).toISOString(), now)).toBe("Today");
    expect(dateChip(new Date(2026, 9, 6, 8).toISOString(), now)).toBe("6 Oct");
    expect(dateChip(new Date(2025, 9, 6, 8).toISOString(), now)).toBe("6 Oct 2025");
    expect(dateChip("nope", now)).toBe("Unknown date");
  });
  it("builds the summary from real fields", () => {
    expect(shortSubjectId("0123456789abcdef")).toBe("01234567…");
    expect(summaryLine(s("x", "ClinicianReview", "pseudo-1"))).toBe("Needs review · Subject pseudo-1");
  });
  it("words the session count", () => {
    expect(sessionCountLabel(1, false)).toBe("1 session");
    expect(sessionCountLabel(12, false)).toBe("12 sessions");
    expect(sessionCountLabel(500, true)).toBe("500+ sessions");
  });
});
