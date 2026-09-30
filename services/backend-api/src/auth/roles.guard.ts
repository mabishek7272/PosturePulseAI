import { CanActivate, ExecutionContext, Injectable } from "@nestjs/common";
import { Reflector } from "@nestjs/core";
import { ROLES_KEY, Role } from "./roles.decorator";

/**
 * Checks `request.user.role` against `@Roles(...)` metadata. `request.user`
 * is only populated by JwtAuthGuard verifying a real signed token - this
 * guard has nothing trustworthy to check unless JwtAuthGuard ran first
 * (`@UseGuards(JwtAuthGuard, RolesGuard)`, in that order). This replaces the
 * Phase 0 scaffold that trusted a client-supplied `x-role` header -
 * see docs/adr/010-clinician-authentication.md.
 *
 * Full least-privilege/tenant-isolation role modeling (PRD 2.4,
 * worker-population manager/clinician separation - see
 * docs/consent-and-retention.md) is still not built: today there is exactly
 * one non-subject role (`clinician`), assigned at account creation with no
 * per-tenant scoping.
 */
@Injectable()
export class RolesGuard implements CanActivate {
  constructor(private readonly reflector: Reflector) {}

  canActivate(context: ExecutionContext): boolean {
    const requiredRoles = this.reflector.getAllAndOverride<Role[] | undefined>(ROLES_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (!requiredRoles || requiredRoles.length === 0) return true;

    const request = context.switchToHttp().getRequest();
    const role: string | undefined = request.user?.role;
    return !!role && requiredRoles.includes(role as Role);
  }
}
