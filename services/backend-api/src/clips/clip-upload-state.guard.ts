import { CanActivate, ExecutionContext, Injectable } from "@nestjs/common";
import { SafetyService } from "../safety/safety.service";
import { assertUploadAllowed } from "./clips.service";

/**
 * Runs before the multipart body is read, so a paused session does not even
 * receive a 100 MB upload. ClipsService re-checks after the upload, because a
 * symptom report may arrive while the bytes are in flight. Read-only: the
 * safety state machine is never driven from here.
 */
@Injectable()
export class ClipUploadStateGuard implements CanActivate {
  constructor(private readonly safety: SafetyService) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const sessionId: string = context.switchToHttp().getRequest().params.id;
    assertUploadAllowed(await this.safety.getState(sessionId));
    return true;
  }
}
