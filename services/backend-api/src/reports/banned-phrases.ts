import { readFileSync } from "node:fs";
import path from "node:path";
import { DEFAULT_REFERENCES_DIR } from "../battery/battery.service";

/**
 * references/banned-phrases.json, the same list report-templates.spec.ts and
 * scripts/lint-claims.sh use. The report builder also applies it at runtime to
 * text that does not come from our own fixed templates (labels and reasons
 * supplied by ml-service), so a wording change over there cannot put banned
 * wording into a clinician- or patient-visible row.
 */
let cached: RegExp[] | null = null;

export function bannedPatterns(): RegExp[] {
  if (!cached) {
    const dir = process.env.REFERENCES_DIR ?? DEFAULT_REFERENCES_DIR;
    const parsed = JSON.parse(readFileSync(path.join(dir, "banned-phrases.json"), "utf-8")) as { patterns?: unknown };
    if (!Array.isArray(parsed.patterns) || parsed.patterns.length === 0) {
      throw new Error("banned-phrases.json has no patterns; refusing to build reports without it");
    }
    cached = (parsed.patterns as string[]).map((p) => new RegExp(p, "i"));
  }
  return cached;
}

/** The patterns (as source strings) that match `text`; empty when the text is clean. */
export function bannedHits(text: string): string[] {
  return bannedPatterns()
    .filter((re) => re.test(text))
    .map((re) => re.source);
}
