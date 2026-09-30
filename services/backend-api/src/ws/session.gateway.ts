import { Logger } from "@nestjs/common";
import {
  OnGatewayConnection,
  OnGatewayDisconnect,
  WebSocketGateway,
  WebSocketServer,
} from "@nestjs/websockets";
import type { Server, Socket } from "socket.io";

/**
 * iOS-facing push channel: state transitions, quality flags, decision events.
 * A client connects with ?sessionId=<id> and joins that session's room; other
 * modules (ml-integration, symptoms) inject this gateway and call broadcast()
 * after they change session state, rather than the gateway containing any
 * business logic of its own.
 */
@WebSocketGateway({ cors: true })
export class SessionGateway implements OnGatewayConnection, OnGatewayDisconnect {
  private readonly logger = new Logger(SessionGateway.name);

  @WebSocketServer()
  server!: Server;

  handleConnection(client: Socket) {
    const sessionId = client.handshake.query.sessionId;
    if (typeof sessionId === "string" && sessionId.length > 0) {
      client.join(roomFor(sessionId));
      this.logger.log(`client ${client.id} joined session ${sessionId}`);
    } else {
      this.logger.warn(`client ${client.id} connected without a sessionId query param - disconnecting`);
      client.disconnect(true);
    }
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
