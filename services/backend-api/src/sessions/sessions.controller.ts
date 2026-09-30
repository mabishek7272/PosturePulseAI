import { BadRequestException, Body, Controller, Get, Param, Post, Query, UseGuards, UseInterceptors } from "@nestjs/common";
import { v4 as uuid } from "uuid";
import { AuditAction } from "../audit/audit-action.decorator";
import { AuditLogInterceptor } from "../audit/audit-log.interceptor";
import { JwtAuthGuard } from "../auth/jwt-auth.guard";
import { Roles } from "../auth/roles.decorator";
import { RolesGuard } from "../auth/roles.guard";
import { EventsService } from "../events/events.service";
import { MlClientService } from "../ml-integration/ml-client.service";
import { SafetyService } from "../safety/safety.service";
import { SessionGateway } from "../ws/session.gateway";
import { CreateSessionInput, SessionsService } from "./sessions.service";

@Controller("sessions")
export class SessionsController {
  constructor(
    private readonly sessions: SessionsService,
    private readonly safety: SafetyService,
    private readonly mlClient: MlClientService,
    private readonly events: EventsService,
    private readonly gateway: SessionGateway
  ) {}

  @Post()
  create(@Body() body: CreateSessionInput) {
    return this.sessions.create(body);
  }

  /**
   * Review queue for apps/clinician-web: ?state=Pause or ?state=ClinicianReview
   * surfaces sessions actually waiting on a clinician; omitted lists recent
   * sessions across all states. Clinician-only (docs/adr/010) - every session's
   * subjectPseudoId and safety state is real subject data.
   */
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles("clinician")
  @UseInterceptors(AuditLogInterceptor)
  @AuditAction("list_sessions")
  @Get()
  list(@Query("state") state?: string, @Query("limit") limit?: string) {
    const parsedLimit = limit ? Number(limit) : undefined;
    return this.sessions.list({
      state,
      limit: parsedLimit && Number.isFinite(parsedLimit) ? parsedLimit : undefined,
    });
  }

  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles("clinician")
  @UseInterceptors(AuditLogInterceptor)
  @AuditAction("view_session")
  @Get(":id")
  get(@Param("id") id: string) {
    return this.sessions.get(id);
  }

  /**
   * Setup -> Observing, once the client confirms calibration and consent are
   * in place (TRD 2.5). Kept as an explicit step rather than folding into
   * create() because a real client may need to run a calibration flow
   * (apps/ios-client CalibrationFlowView) between the two.
   */
  @Post(":id/calibrate")
  async calibrate(@Param("id") id: string) {
    const state = await this.safety.send(id, { type: "CALIBRATED" });
    return { id, state };
  }

  @Post(":id/setup-unavailable")
  async setupUnavailable(@Param("id") id: string, @Body() body: { reason: string }) {
    const state = await this.safety.send(id, { type: "SETUP_UNAVAILABLE", reason: body.reason });
    return { id, state };
  }

  /** Feeds subject-specific scale calibration (docs/adr/008) - set before calling scale-calibration. */
  @Post(":id/height")
  async setHeight(@Param("id") id: string, @Body() body: { subjectHeightMeters: number }) {
    return this.sessions.setHeight(id, body.subjectHeightMeters);
  }

  /**
   * Runs the only TRD-approved scale-validation method implemented this phase
   * (subject_specific) against a single frame, using the height set via
   * POST /:id/height. Throws (422, surfaced from ml-service) rather than
   * silently accepting an unvalidated scale if ankle/nose aren't fully
   * observed in the given frame.
   */
  @Post(":id/scale-calibration")
  async calibrateScaleFromFrame(
    @Param("id") id: string,
    @Body() body: { frameId: string; imageBase64: string }
  ) {
    const session = await this.sessions.get(id);
    if (session.subjectHeightMeters == null) {
      throw new BadRequestException("Session has no subjectHeightMeters set - call POST /sessions/:id/height first.");
    }
    const record = await this.mlClient.calibrateScale({
      sessionId: id,
      frameId: body.frameId,
      imageBase64: body.imageBase64,
      subjectHeightMeters: session.subjectHeightMeters,
    });
    return this.sessions.recordScaleCalibration(id, record as { scaleCalibrationId: string });
  }

  /**
   * Ingests a T_WC(t) sample from the iOS AR session controller
   * (apps/ios-client/Sources/Spatial/ARSessionController.swift - unverified,
   * no Swift toolchain in this sandbox). A thin append+broadcast; there is no
   * AR-specific backend logic yet beyond persisting the record for later
   * hazard-analysis (HZ-04 anchor-drift) review.
   */
  @Post(":id/camera-poses")
  async submitCameraPose(
    @Param("id") id: string,
    @Body()
    body: {
      timestamp: string;
      translation: [number, number, number];
      rotation: [number, number, number, number];
      anchorConfidence: number;
      trackingState: "normal" | "limited" | "notAvailable";
      worldAnchorId: string;
    }
  ) {
    const record = { cameraPoseId: uuid(), sessionId: id, ...body };
    await this.events.appendValidated(id, "camera-pose", record);
    this.gateway.broadcast(id, "camera-pose", record);
    return record;
  }
}
