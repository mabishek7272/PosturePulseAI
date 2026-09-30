import { CanActivate, ExecutionContext, ForbiddenException, Injectable } from "@nestjs/common";

/**
 * Apply after JwtAuthGuard: `@UseGuards(JwtAuthGuard, SessionOwnershipGuard)`.
 * Passes only a subject token issued for the session this request targets
 * (route :id, route :sessionId, or body.sessionId) - docs/adr/012.
 */
@Injectable()
export class SessionOwnershipGuard implements CanActivate {
  canActivate(context: ExecutionContext): boolean {
    const request = context.switchToHttp().getRequest();
    const user = request.user as { role?: string; sessionId?: string } | undefined;
    const target: unknown = request.params?.id ?? request.params?.sessionId ?? request.body?.sessionId;
    if (user?.role !== "subject" || typeof target !== "string" || user.sessionId !== target) {
      throw new ForbiddenException("Token is not valid for this session.");
    }
    return true;
  }
}
