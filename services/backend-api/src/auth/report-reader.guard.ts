import { CanActivate, ExecutionContext, ForbiddenException, Injectable, UnauthorizedException } from "@nestjs/common";
import { JwtService } from "@nestjs/jwt";
import type { AccessClaims } from "./subject-auth.service";

/**
 * For GET /sessions/:id/released-report: passes the report-access token of
 * that session, or the subject's own session token. Anything else (another
 * session, a clinician token) is refused; clinicians read reports through the
 * /reports routes.
 */
@Injectable()
export class ReportReaderGuard implements CanActivate {
  constructor(private readonly jwt: JwtService) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest();
    const header: string | undefined = request.headers["authorization"];
    const token = header?.startsWith("Bearer ") ? header.slice("Bearer ".length) : undefined;
    if (!token) throw new UnauthorizedException("Missing bearer token");

    let claims: AccessClaims;
    try {
      claims = await this.jwt.verifyAsync<AccessClaims>(token);
    } catch {
      throw new UnauthorizedException("Invalid or expired token");
    }
    const sessionId = request.params?.id;
    const allowedRole = claims.role === "report_reader" || claims.role === "subject";
    if (!allowedRole || !("sessionId" in claims) || claims.sessionId !== sessionId) {
      throw new ForbiddenException("Token is not valid for this session's report.");
    }
    request.user = claims;
    return true;
  }
}
