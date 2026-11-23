// What registering a patient must answer. Mirrors REQUIRED_INTAKE_FIELDS in
// services/backend-api/src/patients/patients.service.ts: the server is the final
// authority, this lets the clinician see the gap before sending.
import type { PatientIntake } from "../api/patients";

export const REQUIRED_INTAKE_LABELS = {
  nationality: "Nationality",
  sexAtBirth: "Sex at birth",
  genderIdentity: "Gender identity",
  smoking: "Smoking history",
  alcohol: "Alcohol use",
} as const;

type RequiredKey = keyof typeof REQUIRED_INTAKE_LABELS;

export function missingRequiredAnswers(intake: PatientIntake | undefined): string[] {
  return (Object.keys(REQUIRED_INTAKE_LABELS) as RequiredKey[])
    .filter((key) => {
      const value = intake?.[key];
      return value === undefined || (typeof value === "string" && value.trim() === "");
    })
    .map((key) => REQUIRED_INTAKE_LABELS[key]);
}

/** "Please answer: Nationality, Sex at birth" - or null when everything is answered. */
export function requiredAnswersMessage(intake: PatientIntake | undefined): string | null {
  const missing = missingRequiredAnswers(intake);
  return missing.length === 0 ? null : `Please answer: ${missing.join(", ")}.`;
}
