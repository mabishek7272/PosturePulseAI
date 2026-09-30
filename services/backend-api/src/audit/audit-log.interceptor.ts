import { CallHandler, ExecutionContext, Injectable, NestInterceptor } from "@nestjs/common";
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
