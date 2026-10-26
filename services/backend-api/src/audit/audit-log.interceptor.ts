import { CallHandler, ExecutionContext, Injectable, Logger, NestInterceptor } from "@nestjs/common";
import { Reflector } from "@nestjs/core";
import { Observable, tap } from "rxjs";
import type { JwtPayload } from "../auth/auth.service";
import { AUDIT_ACTION_KEY } from "./audit-action.decorator";
import { AuditLogService } from "./audit-log.service";

/**
 * Records who read what, only after a successful response - a failed or
 * unauthorized request (JwtAuthGuard/RolesGuard already ran and rejected
 * it before this interceptor's handler even executes) is not logged as an
 * access. Only fires on routes carrying @AuditAction - see its own comment
 * for why an unlabeled route is silently skipped rather than guessed at.
 */
@Injectable()
export class AuditLogInterceptor implements NestInterceptor {
  private readonly logger = new Logger(AuditLogInterceptor.name);

  constructor(
    private readonly reflector: Reflector,
    private readonly auditLog: AuditLogService
  ) {}

  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    const action = this.reflector.getAllAndOverride<string | undefined>(AUDIT_ACTION_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (!action) return next.handle();

    const request = context.switchToHttp().getRequest();
    const user: JwtPayload | undefined = request.user;
    const sessionId: string | undefined = request.params?.sessionId ?? request.params?.id;

    return next.handle().pipe(
      tap(() => {
        if (!user) return; // Shouldn't happen behind JwtAuthGuard, but never audit-log a phantom actor.
        // Every route behind @AuditAction is @Roles("clinician")-gated, so `username`
        // is always set on tokens that reach here today. If that ever stops being
        // true (a guard misconfigured, a new role added to an audited route), a
        // corrupted/ambiguous audit row is worse than a loud failure - skip the
        // write and log it, the same way a missing `user` is skipped above, rather
        // than silently recording a placeholder actor.
        if (!user.username) {
          this.logger.error(
            `Audit action "${action}" reached with no username on the token (sub=${user.sub}, role=${user.role}) - skipping the write.`
          );
          return;
        }
        void this.auditLog.record({
          clinicianId: user.sub,
          clinicianUsername: user.username,
          action,
          sessionId: sessionId ?? null,
        });
      })
    );
  }
}
