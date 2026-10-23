import { canonicalJson, reportContentSha256 } from "./canonical-json";

describe("canonicalJson", () => {
  it("sorts object keys at every depth and keeps array order", () => {
    expect(canonicalJson({ b: 1, a: { d: [3, 1], c: null } })).toBe('{"a":{"c":null,"d":[3,1]},"b":1}');
  });

  it("is independent of key insertion order", () => {
    expect(canonicalJson({ x: 1, y: 2 })).toBe(canonicalJson({ y: 2, x: 1 }));
  });

  it("drops undefined members like JSON.stringify", () => {
    expect(canonicalJson({ a: undefined, b: 1 })).toBe('{"b":1}');
  });
});

describe("reportContentSha256", () => {
  const body = {
    reportId: "r1",
    status: "released",
    rows: [{ metricKey: "k", estimate: { value: 1, uncertainty: 0.5 } }],
    signOff: { clinicianId: "c1", signedAt: "2026-10-23T10:00:00.000Z" },
  };

  it("is a 64-character hex digest", () => {
    expect(reportContentSha256(body)).toMatch(/^[0-9a-f]{64}$/);
  });

  it("ignores the contentSha256 stored inside signOff, so a released body can be re-verified", () => {
    const hash = reportContentSha256(body);
    const released = { ...body, signOff: { ...body.signOff, contentSha256: hash } };
    expect(reportContentSha256(released)).toBe(hash);
  });

  it("changes when any other part of the body changes", () => {
    const hash = reportContentSha256(body);
    expect(reportContentSha256({ ...body, rows: [] })).not.toBe(hash);
    expect(reportContentSha256({ ...body, signOff: { ...body.signOff, signedAt: "2026-10-23T10:00:01.000Z" } })).not.toBe(hash);
  });
});
