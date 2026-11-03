import { effectiveQuery, patientListView, sortRecentFirst } from "./patientList";

const p = (id: string, createdAt?: string) => ({ id, name: id, dateOfBirth: "1990-01-01", createdAt });

describe("patientList", () => {
  it("only sends searches of two or more characters", () => {
    expect(effectiveQuery("  a ")).toBeUndefined();
    expect(effectiveQuery(" ab ")).toBe("ab");
  });
  it("sorts newest first, keeping order when dates are missing", () => {
    expect(sortRecentFirst([p("a", "2026-01-01T00:00:00Z"), p("b", "2026-03-01T00:00:00Z")]).map((x) => x.id)).toEqual(["b", "a"]);
    expect(sortRecentFirst([p("x"), p("y")]).map((x) => x.id)).toEqual(["x", "y"]);
  });
  it("chooses the right body", () => {
    expect(patientListView({ loading: true, error: null, count: 0, query: "" })).toBe("loading");
    expect(patientListView({ loading: false, error: "boom", count: 0, query: "" })).toBe("error");
    expect(patientListView({ loading: false, error: null, count: 0, query: "" })).toBe("empty");
    expect(patientListView({ loading: false, error: null, count: 0, query: "zz" })).toBe("noMatches");
    expect(patientListView({ loading: false, error: null, count: 2, query: "zz" })).toBe("list");
  });
});
