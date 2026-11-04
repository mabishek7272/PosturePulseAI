import type { SessionSummary } from "../api/sessions-list";
import { areaPath, axisLabels, chartPoints, countInWindow, deltaCaption, linePath, rangeWeeks, weeklyCounts } from "./trendsData";

const now = new Date(2026, 10, 3, 12, 0, 0);
const at = (daysBack: number) => new Date(2026, 10, 3 - daysBack, 9, 0, 0).toISOString();
const s = (iso: string): SessionSummary => ({ id: iso, state: "Observing", createdAt: iso, protocolId: "p", subjectPseudoId: "x" });

describe("trendsData", () => {
  const sessions = [0, 1, 6, 7, 13, 14, 90, 400].map((d) => s(at(d)));
  it("buckets by rolling 7-day weeks, oldest first", () => {
    expect(weeklyCounts(sessions, now, 3)).toEqual([1, 2, 3]);
    expect(weeklyCounts(sessions, now, 1)).toEqual([3]);
    expect(weeklyCounts([s("bad"), s(at(-2))], now, 2)).toEqual([0, 0]);
  });
  it("sizes ranges", () => {
    expect(rangeWeeks("12w", sessions, now)).toBe(12);
    expect(rangeWeeks("6m", sessions, now)).toBe(26);
    expect(rangeWeeks("all", sessions, now)).toBe(58);
    expect(rangeWeeks("all", [], now)).toBe(2);
  });
  it("counts windows", () => {
    expect(countInWindow(sessions, now, 0, 7)).toBe(3);
    expect(countInWindow(sessions, now, 7, 14)).toBe(2);
    expect(countInWindow(sessions, now, 0, 28)).toBe(6);
  });
  it("words deltas neutrally", () => {
    expect(deltaCaption(5, 3, "last week")).toEqual({ direction: "up", text: "2 more than last week" });
    expect(deltaCaption(1, 2, "last week")).toEqual({ direction: "down", text: "1 fewer than last week" });
    expect(deltaCaption(0, 0, "last week")).toEqual({ direction: "flat", text: "Same as last week" });
  });
  it("maps counts to chart geometry", () => {
    const pts = chartPoints([0, 2, 4]);
    expect(pts[0]).toEqual({ x: 8, y: 90 });
    expect(pts[2]).toEqual({ x: 292, y: 30 });
    expect(linePath(pts)).toBe("M8 90 L150 60 L292 30");
    expect(areaPath(pts)).toBe("M8 90 L150 60 L292 30 L292 120 L8 120 Z");
    expect(chartPoints([0, 0])[1]!.y).toBe(90);
  });
  it("labels the axis", () => {
    expect(axisLabels(12)).toEqual(["11w ago", "7w ago", "4w ago", "This week"]);
    expect(axisLabels(2)).toEqual(["1w ago", "This week"]);
  });
});
