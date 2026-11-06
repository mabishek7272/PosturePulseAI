import type { PatientIntake } from "../api/patients";

const SMOKING: Record<string, string> = { never: "Never smoked", former: "Former smoker", current: "Smokes" };
const ALCOHOL: Record<string, string> = { never: "No alcohol", occasional: "Occasional alcohol", regular: "Regular alcohol" };
const ACTIVITY: Record<string, string> = {
  sedentary: "Sedentary", light: "Lightly active", moderate: "Moderately active", active: "Active",
};

/**
 * The intake facts the clinician entered, as short labelled lines, in a fixed
 * order. Only fields actually present are listed; nothing is inferred, and the
 * app draws no conclusion from them (they are documentary context only).
 */
export function intakeLines(intake: PatientIntake | null | undefined): { label: string; value: string }[] {
  if (!intake) return [];
  const out: { label: string; value: string }[] = [];
  if (typeof intake.heightCm === "number") out.push({ label: "Height", value: `${intake.heightCm} cm` });
  if (typeof intake.weightKg === "number") out.push({ label: "Weight", value: `${intake.weightKg} kg` });
  if (intake.physicalActivityLevel) out.push({ label: "Activity", value: ACTIVITY[intake.physicalActivityLevel] ?? intake.physicalActivityLevel });
  if (intake.smoking) out.push({ label: "Smoking", value: SMOKING[intake.smoking] ?? intake.smoking });
  if (intake.alcohol) out.push({ label: "Alcohol", value: ALCOHOL[intake.alcohol] ?? intake.alcohol });
  if (typeof intake.recentAccident === "boolean") {
    const detail = intake.recentAccident && intake.recentAccidentDetails ? ` (${intake.recentAccidentDetails})` : "";
    out.push({ label: "Recent accident", value: `${intake.recentAccident ? "Yes" : "No"}${detail}` });
  }
  if (intake.physicalProblems) out.push({ label: "Noted problems", value: intake.physicalProblems });
  return out;
}

export function scanCountLabel(n: number): string {
  return n === 1 ? "1 scan" : `${n} scans`;
}
