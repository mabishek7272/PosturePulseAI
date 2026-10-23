import {
  BadRequestException,
  Body,
  Controller,
  HttpCode,
  Param,
  Put,
  UploadedFiles,
  UseGuards,
  UseInterceptors,
} from "@nestjs/common";
import { FileFieldsInterceptor } from "@nestjs/platform-express";
import { JwtAuthGuard } from "../auth/jwt-auth.guard";
import { SessionOwnershipGuard } from "../auth/session-ownership.guard";
import { ClipUploadStorage } from "./clip-storage";
import { ClipUploadStateGuard } from "./clip-upload-state.guard";
import { ClipsService, MAX_CLIP_BYTES, type UploadedClipFile } from "./clips.service";

interface UploadedParts {
  clip?: UploadedClipFile[];
  sidecar?: Array<{ buffer?: Buffer }>;
}

@Controller("sessions")
export class ClipsController {
  constructor(private readonly clips: ClipsService) {}

  /**
   * Multipart: `clip` (video/mp4 or quicktime, up to 100 MB) and `sidecar`
   * (ClipCapture JSON, as a text field or a JSON file part).
   */
  @UseGuards(JwtAuthGuard, SessionOwnershipGuard, ClipUploadStateGuard)
  @UseInterceptors(
    FileFieldsInterceptor(
      [
        { name: "clip", maxCount: 1 },
        { name: "sidecar", maxCount: 1 },
      ],
      { storage: new ClipUploadStorage(), limits: { fileSize: MAX_CLIP_BYTES, fieldSize: 5 * 1024 * 1024, files: 2 } }
    )
  )
  @HttpCode(200)
  @Put(":id/clips/:stepId")
  upload(
    @Param("id") sessionId: string,
    @Param("stepId") stepId: string,
    @UploadedFiles() files: UploadedParts,
    @Body("sidecar") sidecarField?: string
  ) {
    const clip = files?.clip?.[0];
    if (!clip) throw new BadRequestException("The multipart file part 'clip' is required.");
    const sidecarPart = files?.sidecar?.[0]?.buffer;
    const sidecar = sidecarPart ? sidecarPart.toString("utf-8") : typeof sidecarField === "string" ? sidecarField : undefined;
    return this.clips.accept(sessionId, stepId, clip, sidecar);
  }
}
