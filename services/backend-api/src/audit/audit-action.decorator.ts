import { SetMetadata } from "@nestjs/common";

export const AUDIT_ACTION_KEY = "auditAction";

/**
 * Labels a route for AuditLogInterceptor - a short, stable action name
 * (e.g. "list_sessions", "view_session") recorded alongside who accessed
 * it and when. A route with no @AuditAction is not logged - the
 * interceptor never invents a label from the path/method.
 */
export const AuditAction = (action: string) => SetMetadata(AUDIT_ACTION_KEY, action);
