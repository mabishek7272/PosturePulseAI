import { buildReportHtml, escapeHtml, pathViewBox, PDF_DISCLAIMER, signatureSvg, type ReportPdfInput } from "./reportHtml";

const base: ReportPdfInput = {
  patientName: "Ada <Example>",
  sessionId: "3de068be-08f2-4989-b8ad-b2b427b90e4d",
  scannedAt: "2026-11-06T10:00:00Z",
  producedAt: "2026-11-06T11:00:00Z",
  appVersion: "1.0.0",
  results: [
    { metricKey: "static.shoulder_line_tilt", label: "Shoulder line tilt", unit: "deg", tier: "proxy", estimate: { value: 1.2, uncertainty: 0.5 }, position: "indeterminate", reference: { label: "0°", value: 0 } },
    { metricKey: "static.plumb_offset_ear", label: "Plumb offset ear", unit: "percent_stature", estimate: { value: 2, uncertainty: 1 }, position: "no_reference", reference: null },
    { metricKey: "static.hip_line_tilt", label: "Hip line tilt", unsupported: { reasons: ["subject_moving"] } },
  ],
  signatures: { subject: { svgPath: "M10 10L40 30", signedAt: "2026-11-06T09:59:00Z" }, clinician: { svgPath: "M5 5Q8 8 12 6L20 9", signedAt: "2026-11-06T09:59:00Z" } },
};

describe("buildReportHtml", () => {
  const html = buildReportHtml(base);

  it("escapes every piece of text", () => {
    expect(html).toContain("Ada &lt;Example&gt;");
    expect(html).not.toContain("<Example>");
  });

  it("shows value with uncertainty, the reference only where one exists, and the reason when not measured", () => {
    expect(html).toContain("+1.2°");
    expect(html).toContain("±0.5");
    expect(html).toContain("Overlaps the reference");
    expect(html).toContain("No reference value is set for this measurement");
    expect(html).toContain("the person moved during the hold");
    expect(html).toContain("% of height");
  });

  it("embeds both signatures and the disclaimer, and makes no score or diagnosis claim", () => {
    expect((html.match(/<svg class="sig"/g) ?? []).length).toBe(2);
    expect(html).toContain(escapeHtml(PDF_DISCLAIMER));
    expect(html.toLowerCase()).not.toMatch(/\bscore:|diagnos(is|ed) of|normal range|abnormal/);
  });

  it("says plainly when a scan has no signatures", () => {
    expect(buildReportHtml({ ...base, signatures: null })).toContain("No consent signatures are on record");
  });
});

describe("signatures", () => {
  it("computes a viewBox around the strokes", () => {
    expect(pathViewBox("M10 10L40 30", 0)).toBe("10.0 10.0 30.0 20.0");
    expect(pathViewBox("")).toBeNull();
  });
  it("refuses anything that is not plain path data", () => {
    expect(signatureSvg('M1 1"/><script>alert(1)</script>')).toContain("Signature unavailable");
  });
});
