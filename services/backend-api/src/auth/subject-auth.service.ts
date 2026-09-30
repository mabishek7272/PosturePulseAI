import { Injectable } from "@nestjs/common";
import { JwtService } from "@nestjs/jwt";
import type { JwtPayload } from "./auth.service";

export const SUBJECT_TOKEN_TTL = "4h";

/** A subject's device token: valid for exactly one session (docs/adr/012). */
export interface SubjectJwtPayload {
  sub: string;
  sessionId: string;
  role: "subject";
}

export type AccessClaims = JwtPayload | SubjectJwtPayload;

@Injectable()
export class SubjectAuthService {
  constructor(private readonly jwt: JwtService) {}

  issueSessionToken(sessionId: string, subjectPseudoId: string): Promise<string> {
    const payload: SubjectJwtPayload = { sub: subjectPseudoId, sessionId, role: "subject" };
    return this.jwt.signAsync(payload, { expiresIn: SUBJECT_TOKEN_TTL });
  }

  /** Never throws - callers that must not reject (symptom reports, gateway) need a verdict, not an exception. */
  async verify(token: string | undefined): Promise<AccessClaims | null> {
    if (!token) return null;
    try {
      return await this.jwt.verifyAsync<AccessClaims>(token);
    } catch {
      return null;
    }
  }
}

export function isSubjectTokenFor(claims: AccessClaims | null, sessionId: string): boolean {
  return claims?.role === "subject" && "sessionId" in claims && claims.sessionId === sessionId;
}
