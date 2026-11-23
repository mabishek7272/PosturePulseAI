import { request } from "./http";
import type { SignaturePayload } from "../lib/signaturePayload";

/** GET/PUT /clinicians/me/profile. The drawing itself is never returned, only whether one is on file. */
export interface ClinicianProfile {
  fullName: string | null;
  specialty: string | null;
  licenceNumber: string | null;
  qualifications: string | null;
  licensingAuthority: string | null;
  clinic: string | null;
  professionalContact: string | null;
  hasSignature: boolean;
  /** Name, specialty, licence number and signature are all on file. */
  complete: boolean;
  updatedAt: string | null;
}

export interface ClinicianProfileInput {
  fullName?: string;
  specialty?: string;
  licenceNumber?: string;
  qualifications?: string | null;
  licensingAuthority?: string | null;
  clinic?: string | null;
  professionalContact?: string | null;
  signature?: SignaturePayload;
}

export function getClinicianProfile(token: string): Promise<ClinicianProfile> {
  return request<ClinicianProfile>("/clinicians/me/profile", { token });
}

export function saveClinicianProfile(input: ClinicianProfileInput, token: string): Promise<ClinicianProfile> {
  return request<ClinicianProfile>("/clinicians/me/profile", { method: "PUT", body: input, token });
}
