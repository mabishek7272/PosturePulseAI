import { Logger } from "@nestjs/common";
import {
  OnGatewayConnection,
  OnGatewayDisconnect,
  WebSocketGateway,
  WebSocketServer,
} from "@nestjs/websockets";
import type { Server, Socket } from "socket.io";
import { isSubjectTokenFor, SubjectAuthService } from "../auth/subject-auth.service";

/**
 * Push channel for the subject's device and the clinician dashboard: state
 * transitions, quality flags, decision events. A client connects with
 * ?sessionId=<id> plus a token in the handshake auth payload and joins that
 * session's room; other modules (ml-integration, symptoms) inject this gateway
 * and call broadcast() after they change session state, rather than the
 * gateway containing any business logic of its own.
 */
@WebSocketGateway({ cors: true })
export class SessionGateway implements OnGatewayConnection, OnGatewayDisconnect {
  private readonly logger = new Logger(SessionGateway.name);

  @WebSocketServer()
  server!: Server;

  constructor(private readonly subjectAuth: SubjectAuthService) {}

  /** Accepts a subject token for this session, or any clinician token (docs/adr/012). */
  async handleConnection(client: Socket) {
    const sessionId = client.handshake.query.sessionId;
    if (typeof sessionId !== "string" || sessionId.length === 0) {
      this.logger.warn(`client ${client.id} connected without a sessionId query param - disconnecting`);
      client.disconnect(true);
      return;
    }
    const claims = await this.subjectAuth.verify(client.handshake.auth?.token);
    if (claims?.role !== "clinician" && !isSubjectTokenFor(claims, sessionId)) {
      this.logger.warn(`client ${client.id} has no valid token for session ${sessionId} - disconnecting`);
      client.disconnect(true);
      return;
    }
    client.join(roomFor(sessionId));
    this.logger.log(`client ${client.id} joined session ${sessionId} as ${claims?.role}`);
  }

  handleDisconnect(client: Socket) {
    this.logger.log(`client ${client.id} disconnected`);
  }

  broadcast(sessionId: string, event: string, payload: unknown) {
    this.server?.to(roomFor(sessionId)).emit(event, payload);
  }
}

function roomFor(sessionId: string): string {
  return `session:${sessionId}`;
}
