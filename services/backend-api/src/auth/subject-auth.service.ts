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

export const REPORT_ACCESS_TOKEN_TTL = "180d";

/**
 * Lets a patient's device read the released report of one session long after
 * the 4h session token has expired. It carries no other permission: it is not
 * a subject token (SessionOwnershipGuard and the symptom/WS checks reject it)
 * and not a clinician token.
 */
export interface ReportReaderJwtPayload {
  sub: string;
  sessionId: string;
  role: "report_reader";
}

export type AccessClaims = JwtPayload | SubjectJwtPayload | ReportReaderJwtPayload;

@Injectable()
export class SubjectAuthService {
  constructor(private readonly jwt: JwtService) {}

  issueSessionToken(sessionId: string, subjectPseudoId: string): Promise<string> {
    const payload: SubjectJwtPayload = { sub: subjectPseudoId, sessionId, role: "subject" };
    return this.jwt.signAsync(payload, { expiresIn: SUBJECT_TOKEN_TTL });
  }

  issueReportAccessToken(sessionId: string, subjectPseudoId: string): Promise<string> {
    const payload: ReportReaderJwtPayload = { sub: subjectPseudoId, sessionId, role: "report_reader" };
    return this.jwt.signAsync(payload, { expiresIn: REPORT_ACCESS_TOKEN_TTL });
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
