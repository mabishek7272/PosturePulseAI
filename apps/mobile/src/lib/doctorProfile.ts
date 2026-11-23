import type { ClinicianProfile, ClinicianProfileInput } from "../api/clinician";
import { buildSignaturePayload } from "./signaturePayload";
import { hasMinimumInk, type Stroke } from "./signature";

export interface ProfileDraft {
  fullName: string;
  specialty: string;
  licenceNumber: string;
  qualifications: string;
  licensingAuthority: string;
  clinic: string;
  professionalContact: string;
}

export const EMPTY_DRAFT: ProfileDraft = {
  fullName: "", specialty: "", licenceNumber: "", qualifications: "", licensingAuthority: "", clinic: "", professionalContact: "",
};

export function draftFromProfile(profile: ClinicianProfile | null): ProfileDraft {
  if (!profile) return EMPTY_DRAFT;
  return {
    fullName: profile.fullName ?? "",
    specialty: profile.specialty ?? "",
    licenceNumber: profile.licenceNumber ?? "",
    qualifications: profile.qualifications ?? "",
    licensingAuthority: profile.licensingAuthority ?? "",
    clinic: profile.clinic ?? "",
    professionalContact: profile.professionalContact ?? "",
  };
}

/** What still blocks a save. Empty when it can be sent. */
export function profileProblems(draft: ProfileDraft, hasSignatureOnFile: boolean, strokes: Stroke[]): string[] {
  const problems: string[] = [];
  if (!draft.fullName.trim()) problems.push("Full name is required.");
  if (!draft.specialty.trim()) problems.push("Specialty is required.");
  if (!draft.licenceNumber.trim()) problems.push("Licence / registration number is required.");
  if (strokes.length > 0 && !hasMinimumInk(strokes)) problems.push("The signature is too short; draw it again.");
  if (strokes.length === 0 && !hasSignatureOnFile) problems.push("Draw your signature.");
  return problems;
}

/**
 * The PUT body. Optional fields are sent as null when cleared so they really are cleared;
 * the signature is sent only when a new one was drawn (otherwise the stored one is kept).
 */
export function buildProfileInput(draft: ProfileDraft, strokes: Stroke[], padWidth: number, padHeight: number): ClinicianProfileInput {
  const text = (v: string) => (v.trim() ? v.trim() : null);
  const input: ClinicianProfileInput = {
    fullName: draft.fullName.trim(),
    specialty: draft.specialty.trim(),
    licenceNumber: draft.licenceNumber.trim(),
    qualifications: text(draft.qualifications),
    licensingAuthority: text(draft.licensingAuthority),
    clinic: text(draft.clinic),
    professionalContact: text(draft.professionalContact),
  };
  if (strokes.length > 0) {
    const signature = buildSignaturePayload(strokes, padWidth, padHeight);
    if (signature) input.signature = signature;
  }
  return input;
}
