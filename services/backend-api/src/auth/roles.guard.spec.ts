import { ExecutionContext } from "@nestjs/common";
import { Reflector } from "@nestjs/core";
import { RolesGuard } from "./roles.guard";
import type { Role } from "./roles.decorator";

function buildContext(requiredRoles: Role[] | undefined, userRole: string | undefined) {
  const reflector = { getAllAndOverride: jest.fn().mockReturnValue(requiredRoles) };
  const context = {
    getHandler: () => undefined,
    getClass: () => undefined,
    switchToHttp: () => ({ getRequest: () => ({ user: userRole ? { role: userRole } : undefined }) }),
  } as unknown as ExecutionContext;
  return { context, reflector: reflector as unknown as Reflector };
}

describe("RolesGuard", () => {
  it("allows any request when the route declares no required roles", () => {
    const { context, reflector } = buildContext(undefined, undefined);
    expect(new RolesGuard(reflector).canActivate(context)).toBe(true);
  });

  it("denies a request with no verified user (JwtAuthGuard didn't run or failed)", () => {
    const { context, reflector } = buildContext(["clinician"], undefined);
    expect(new RolesGuard(reflector).canActivate(context)).toBe(false);
  });

  it("denies a verified user whose role isn't in the required set", () => {
    const { context, reflector } = buildContext(["clinician"], "subject");
    expect(new RolesGuard(reflector).canActivate(context)).toBe(false);
  });

  it("allows a verified user whose role matches", () => {
    const { context, reflector } = buildContext(["clinician"], "clinician");
    expect(new RolesGuard(reflector).canActivate(context)).toBe(true);
  });
});
