import "reflect-metadata";
import { GUARDS_METADATA } from "@nestjs/common/constants";
import { JwtAuthGuard } from "../auth/jwt-auth.guard";
import { SessionOwnershipGuard } from "../auth/session-ownership.guard";
import { StepsController } from "./steps.controller";

describe("GET /sessions/:id/steps", () => {
  it("requires a subject token for the same session", () => {
    expect(Reflect.getMetadata(GUARDS_METADATA, StepsController.prototype.list)).toEqual([JwtAuthGuard, SessionOwnershipGuard]);
  });

  it("returns the service's per-step status for the route's session", async () => {
    const statusFor = jest.fn().mockResolvedValue([{ stepId: "static.anterior", status: "missing", usable: false, reasons: [] }]);
    const controller = new StepsController({ statusFor } as never);
    await expect(controller.list("s1")).resolves.toHaveLength(1);
    expect(statusFor).toHaveBeenCalledWith("s1");
  });
});
