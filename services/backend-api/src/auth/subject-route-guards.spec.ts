import "reflect-metadata";
import { GUARDS_METADATA } from "@nestjs/common/constants";
import { DetectObjectsController } from "../ml-integration/detect-objects.controller";
import { FramesController } from "../ml-integration/frames.controller";
import { SensorsController } from "../sensors/sensors.controller";
import { SessionsController } from "../sessions/sessions.controller";
import { JwtAuthGuard } from "./jwt-auth.guard";
import { SessionOwnershipGuard } from "./session-ownership.guard";

// POST /symptom-reports is deliberately absent - see symptoms.controller.ts and docs/adr/012.
// eslint-disable-next-line @typescript-eslint/ban-types
const SUBJECT_ROUTES: Array<[string, Function, string]> = [
  ["POST /sessions/:id/calibrate", SessionsController, "calibrate"],
  ["POST /sessions/:id/setup-unavailable", SessionsController, "setupUnavailable"],
  ["POST /sessions/:id/height", SessionsController, "setHeight"],
  ["POST /sessions/:id/scale-calibration", SessionsController, "calibrateScaleFromFrame"],
  ["POST /sessions/:id/camera-poses", SessionsController, "submitCameraPose"],
  ["POST /sessions/:sessionId/frames", FramesController, "submit"],
  ["POST /sessions/:sessionId/detect-objects", DetectObjectsController, "submit"],
  ["POST /sensor-readings", SensorsController, "submit"],
];

describe("subject-facing routes", () => {
  it.each(SUBJECT_ROUTES)("%s requires a subject token for the same session", (_name, controller, method) => {
    const handler = (controller.prototype as Record<string, object>)[method];
    const guards = Reflect.getMetadata(GUARDS_METADATA, handler) ?? [];
    expect(guards).toEqual([JwtAuthGuard, SessionOwnershipGuard]);
  });
});
