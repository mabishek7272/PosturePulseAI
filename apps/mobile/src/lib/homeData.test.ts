import type { SessionSummary } from "../api/sessions-list";
import { barFractions, dayCounts, daysAgo, formatLongDate, homeStats, patientMeta, initialsOf, relativeDate, usernameFromToken } from "./homeData";

const now = new Date(2026, 10, 3, 12, 0, 0);
const s = (iso: string, state = "Observing"): SessionSummary => ({ id: iso, state, createdAt: iso, protocolId: "p", subjectPseudoId: "x" });
const at = (daysBack: number) => new Date(2026, 10, 3 - daysBack, 9, 0, 0).toISOString();

describe("homeData", () => {
  it("decodes the username claim", () => {
    const payload = Buffer.from(JSON.stringify({ sub: "1", username: "drchen" })).toString("base64url");
    expect(usernameFromToken(`h.${payload}.s`)).toBe("drchen");
    expect(usernameFromToken("garbage")).toBeNull();
    expect(usernameFromToken(null)).toBeNull();
  });
  it("derives initials", () => {
    expect(initialsOf("drchen")).toBe("DR");
    expect(initialsOf("Amara Lindqvist")).toBe("AL");
    expect(initialsOf("a.b")).toBe("AB");
    expect(initialsOf("  ")).toBe("?");
  });
  it("formats the date", () => expect(formatLongDate(now)).toBe("Tuesday, 3 November"));
  it("computes relative dates", () => {
    expect(daysAgo(at(0), now)).toBe(0);
    expect(relativeDate(at(0), now)).toBe("Today");
    expect(relativeDate(at(1), now)).toBe("Yesterday");
    expect(relativeDate(at(3), now)).toBe("3 days ago");
    expect(relativeDate("nope", now)).toBe("Unknown date");
  });
  it("buckets by day and ignores older/future", () => {
    const list = [s(at(0)), s(at(0)), s(at(2)), s(at(4)), s(at(9))];
    expect(dayCounts(list, now, 5)).toEqual([1, 0, 1, 0, 2]);
  });
  it("computes stats", () => {
    const st = homeStats([s(at(0), "Setup"), s(at(0)), s(at(6)), s(at(7))], now);
    expect(st).toMatchObject({ today: 2, todayStarted: 1, week: 3 });
    expect(homeStats([], now)).toMatchObject({ today: 0, week: 0, bars: [0, 0, 0, 0, 0] });
  });
  it("normalises bars", () => {
    expect(barFractions([0, 2, 4])).toEqual([0, 0.5, 1]);
    expect(barFractions([0, 0])).toEqual([0, 0]);
  });
  it("builds patient meta from the DOB", () => {
    expect(patientMeta("1991-11-03", now)).toBe("35y · 1991-11-03");
    expect(patientMeta("1991-11-04", now)).toBe("34y · 1991-11-04");
    expect(patientMeta("bad", now)).toBe("bad");
  });
});
