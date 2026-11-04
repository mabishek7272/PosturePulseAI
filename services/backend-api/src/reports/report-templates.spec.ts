import bannedPhrases from "../../../../references/banned-phrases.json";
import type { QualityReason, Tier } from "../battery/types";
import type { Position } from "./report-position";
import {
  ALL_TEMPLATE_IDS,
  REASON_WORDS,
  formatReferenceLabel,
  formatValue,
  renderAnalysis,
  type TemplateInput,
} from "./report-templates";

const BANNED = (bannedPhrases as { patterns: string[] }).patterns.map((p) => new RegExp(p, "i"));

function bannedHits(text: string): string[] {
  return BANNED.filter((re) => re.test(text)).map((re) => re.source);
}

const UNITS = ["deg", "cm", "percent_stature", "s", "count", "per_min", "percent", "none"];
// "annotated" is deliberately NOT in this grid. It has its own payload and its
// own template, only ever renders with no reference comparison, and throws for
// anything else - so it is rendered explicitly below rather than being swept
// through positions it must refuse. It used to sit here, rendered as if it were
// an estimate, which was the masquerade the annotated schema branch removes.
const TIERS: Tier[] = ["estimate", "proxy", "entered"];
const POSITIONS_WITH_REFERENCE: Position[] = ["below", "within", "above", "indeterminate"];
const ALL_REASONS = Object.keys(REASON_WORDS) as QualityReason[];

function renderAll(): Array<{ templateId: string; text: string }> {
  const out: Array<{ templateId: string; text: string }> = [];
  for (const unit of UNITS) {
    for (const tier of TIERS) {
      for (const position of POSITIONS_WITH_REFERENCE) {
        out.push(
          renderAnalysis({
            tier,
            unit,
            position,
            estimate: { value: -3.25, uncertainty: 0.75 },
            reference: { lo: 0, hi: 5 },
          })
        );
      }
      out.push(renderAnalysis({ tier, unit, position: "no_reference", estimate: { value: 1.2, uncertainty: 0.4 }, reference: null }));
      out.push(renderAnalysis({ tier, unit, position: "not_applicable", estimate: null, reference: null, unsupportedReasons: ALL_REASONS }));
    }
  }
  for (const unit of UNITS) {
    for (const underlyingTier of [undefined, "estimate", "proxy"] as const) {
      out.push(
        renderAnalysis({
          tier: "annotated",
          underlyingTier,
          unit,
          position: "no_reference",
          estimate: { value: 1.2, uncertainty: 0.4 },
          reference: null,
        })
      );
    }
  }
  out.push(
    renderAnalysis({
      tier: "not_measurable",
      unit: "none",
      position: "not_applicable",
      estimate: null,
      reference: null,
      notMeasurableReason: "Needs a marker on the seventh cervical vertebra.",
    })
  );
  return out;
}

describe("banned-phrases list", () => {
  it("has patterns that compile", () => {
    expect(BANNED.length).toBeGreaterThan(10);
  });

  it.each([
    "Your posture is normal.",
    "An abnormal head position.",
    "Higher risk of pain.",
    "Posture score: 82",
    "Optimal alignment",
    "excellent",
    "Perfect posture",
    "textbook alignment",
    "poor posture",
    "bad posture",
    "good posture",
    "This indicates a problem.",
    "scoliosis",
    "forward head posture",
    "genu valgum",
  ])("catches %j", (text) => {
    expect(bannedHits(text)).not.toEqual([]);
  });

  it("catches the d-word (spelled in pieces so scripts/lint-claims.sh does not flag this test)", () => {
    expect(bannedHits(`A ${"diagno"}sis of the spine.`)).not.toEqual([]);
    expect(bannedHits(`${"Diagno"}stic finding`)).not.toEqual([]);
  });
});

describe("report templates", () => {
  it("never render a banned phrase, for every template, tier, unit and reason", () => {
    const rendered = renderAll();
    const seen = new Set(rendered.map((r) => r.templateId));
    expect([...seen].sort()).toEqual([...ALL_TEMPLATE_IDS].sort());
    for (const { templateId, text } of rendered) {
      expect({ templateId, text, hits: bannedHits(text) }).toEqual({ templateId, text, hits: [] });
    }
  });

  it("never leaves a placeholder unfilled", () => {
    for (const { text } of renderAll()) {
      expect(text).not.toMatch(/[{}]|undefined|NaN/);
    }
  });

  const cases: Array<[string, TemplateInput, string]> = [
    [
      "within, range reference",
      { tier: "estimate", unit: "deg", position: "within", estimate: { value: 2, uncertainty: 1 }, reference: { lo: 0, hi: 5 } },
      "2.0° ± 1.0°; within the 0° to 5° reference.",
    ],
    [
      "above, single-value reference: distance from the value to the bound",
      { tier: "estimate", unit: "deg", position: "above", estimate: { value: 3.04, uncertainty: 0.5 }, reference: { lo: 0, hi: 0 } },
      "3.0° ± 0.5°; above the 0° reference by about 3.0°.",
    ],
    [
      "below, range reference: distance to the lower bound",
      { tier: "estimate", unit: "percent_stature", position: "below", estimate: { value: -2.5, uncertainty: 0.5 }, reference: { lo: -1, hi: 1 } },
      "-2.5% of stature ± 0.5% of stature; below the -1% of stature to 1% of stature reference by about 1.5% of stature.",
    ],
    [
      "indeterminate",
      { tier: "estimate", unit: "deg", position: "indeterminate", estimate: { value: 0.4, uncertainty: 1.1 }, reference: { lo: 0, hi: 0 } },
      "0.4° ± 1.1°; the uncertainty overlaps the 0° reference.",
    ],
    [
      "no reference",
      { tier: "estimate", unit: "deg", position: "no_reference", estimate: { value: 12.25, uncertainty: 2 }, reference: null },
      "12.3° ± 2.0°. No reference value is set for this measurement.",
    ],
    [
      "proxy within",
      { tier: "proxy", unit: "deg", position: "within", estimate: { value: 0, uncertainty: 0 }, reference: { lo: 0, hi: 0 } },
      "0.0° ± 0.0°; within the 0° reference. Proxy measurement: describes landmark geometry only.",
    ],
    [
      "unsupported with two reasons",
      {
        tier: "proxy",
        unit: "deg",
        position: "not_applicable",
        estimate: null,
        reference: null,
        unsupportedReasons: ["camera_not_level", "out_of_frame"],
      },
      "Not measured: the camera was not level; part of the body was outside the picture.",
    ],
    [
      "not measurable",
      {
        tier: "not_measurable",
        unit: "none",
        position: "not_applicable",
        estimate: null,
        reference: null,
        notMeasurableReason: "Needs a skin marker.",
      },
      "Not measurable with this system: Needs a skin marker.",
    ],
  ];

  it.each(cases)("%s", (_name, input, expected) => {
    expect(renderAnalysis(input).text).toBe(expected);
  });

  it("never prints negative zero", () => {
    expect(formatValue(-0.04, "deg")).toBe("0.0°");
  });

  it("labels single-value and range references", () => {
    expect(formatReferenceLabel({ lo: 0, hi: 0 }, "deg")).toBe("0°");
    expect(formatReferenceLabel({ lo: -1.5, hi: 2 }, "cm")).toBe("-1.5 cm to 2 cm");
  });

  it("refuses to render a reference position without a reference", () => {
    expect(() =>
      renderAnalysis({ tier: "estimate", unit: "deg", position: "within", estimate: { value: 1, uncertainty: 1 }, reference: null })
    ).toThrow();
  });

  it("refuses to render not_applicable with neither unsupported reasons nor a not-measurable reason", () => {
    expect(() =>
      renderAnalysis({ tier: "estimate", unit: "deg", position: "not_applicable", estimate: null, reference: null })
    ).toThrow();
  });
});


describe("annotated rows", () => {
  const annotated = (overrides: Partial<TemplateInput> = {}): TemplateInput => ({
    tier: "annotated",
    unit: "deg",
    position: "no_reference",
    estimate: { value: 4.2, uncertainty: 1.1 },
    reference: null,
    ...overrides,
  });

  it("says a clinician adjusted the landmarks, and never that the value is verified", () => {
    const { templateId, text } = renderAnalysis(annotated());
    expect(templateId).toBe("annotated.no_reference");
    expect(text).toBe(
      "4.2° ± 1.1°. Landmark positions were adjusted by a clinician. No reference value is set for this measurement."
    );
    // "Verified" would claim the placement was checked and found right. Moving a
    // landmark corrects the pose model's misplacement of it; it cannot remove the
    // static landmark-to-bone and soft-tissue offsets that dominate the error.
    expect(text).not.toMatch(/verif|confirm|validated|accurate|correct/i);
  });

  it("keeps the proxy caveat: an annotation does not turn a proxy into an estimate", () => {
    const proxy = renderAnalysis(annotated({ underlyingTier: "proxy" })).text;
    const estimate = renderAnalysis(annotated({ underlyingTier: "estimate" })).text;
    expect(proxy).toMatch(/Proxy measurement: describes landmark geometry only\./);
    expect(estimate).not.toMatch(/Proxy/);
  });

  it.each(["below", "within", "above", "indeterminate"] as const)(
    "REFUSES a reference comparison (%s) for a clinician's placement",
    (position) => {
      // The reference ranges are written for the 2D image-plane method. A
      // clinician_annotated result is a non-default method, so report-builder
      // never supplies a reference; this asserts the renderer would not draw a
      // comparison even if a caller bypassed it.
      expect(() =>
        renderAnalysis(annotated({ position, reference: { lo: 0, hi: 5 } }))
      ).toThrow(/cannot carry position/);
    }
  );

  it("needs its value", () => {
    expect(() => renderAnalysis(annotated({ estimate: null }))).toThrow(/annotated value/);
  });
});
