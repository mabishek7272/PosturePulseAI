import { CallHandler, ExecutionContext } from "@nestjs/common";
import { Reflector } from "@nestjs/core";
import { lastValueFrom, of } from "rxjs";
import { AuditLogInterceptor } from "./audit-log.interceptor";

function buildContext(user: unknown, params: Record<string, string>) {
  return {
    getHandler: () => undefined,
    getClass: () => undefined,
    switchToHttp: () => ({ getRequest: () => ({ user, params }) }),
  } as unknown as ExecutionContext;
}

function handlerReturning(value: unknown): CallHandler {
  return { handle: () => of(value) };
}

describe("AuditLogInterceptor", () => {
  it("does nothing when the route carries no @AuditAction", async () => {
    const reflector = { getAllAndOverride: jest.fn().mockReturnValue(undefined) };
    const auditLog = { record: jest.fn() };
    const interceptor = new AuditLogInterceptor(reflector as unknown as Reflector, auditLog as never);

    const result = await lastValueFrom(
      interceptor.intercept(buildContext({ sub: "c1", username: "drchen" }, {}), handlerReturning({ ok: true }))
    );

    expect(result).toEqual({ ok: true });
    expect(auditLog.record).not.toHaveBeenCalled();
  });

  it("records the access, using params.sessionId, after a labeled route succeeds", async () => {
    const reflector = { getAllAndOverride: jest.fn().mockReturnValue("view_events") };
    const auditLog = { record: jest.fn() };
    const interceptor = new AuditLogInterceptor(reflector as unknown as Reflector, auditLog as never);

    await lastValueFrom(
      interceptor.intercept(
        buildContext({ sub: "c1", username: "drchen" }, { sessionId: "s1" }),
        handlerReturning([])
      )
    );

    expect(auditLog.record).toHaveBeenCalledWith({
      clinicianId: "c1",
      clinicianUsername: "drchen",
      action: "view_events",
      sessionId: "s1",
    });
  });

  it("falls back to params.id when there is no sessionId (GET /sessions/:id)", async () => {
    const reflector = { getAllAndOverride: jest.fn().mockReturnValue("view_session") };
    const auditLog = { record: jest.fn() };
    const interceptor = new AuditLogInterceptor(reflector as unknown as Reflector, auditLog as never);

    await lastValueFrom(
      interceptor.intercept(buildContext({ sub: "c1", username: "drchen" }, { id: "s1" }), handlerReturning({}))
    );

    expect(auditLog.record).toHaveBeenCalledWith(
      expect.objectContaining({ sessionId: "s1", action: "view_session" })
    );
  });

  it("never records a phantom actor when request.user is somehow missing", async () => {
    const reflector = { getAllAndOverride: jest.fn().mockReturnValue("list_sessions") };
    const auditLog = { record: jest.fn() };
    const interceptor = new AuditLogInterceptor(reflector as unknown as Reflector, auditLog as never);

    await lastValueFrom(interceptor.intercept(buildContext(undefined, {}), handlerReturning([])));

    expect(auditLog.record).not.toHaveBeenCalled();
  });
});
