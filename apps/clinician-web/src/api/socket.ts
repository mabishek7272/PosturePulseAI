import { io, type Socket } from "socket.io-client";
import { getToken } from "../auth/tokenStore";
import { BACKEND_API_URL } from "./config";

/**
 * Joins the same per-session Socket.IO room iOS clients use
 * (services/backend-api/src/ws/session.gateway.ts) to get live event
 * broadcasts without polling. Authenticates with the clinician's JWT - the
 * gateway disconnects unauthenticated clients (docs/adr/012). The caller is
 * responsible for calling `disconnect()` on unmount.
 */
export function connectToSession(sessionId: string): Socket {
  return io(BACKEND_API_URL, {
    query: { sessionId },
    auth: { token: getToken() },
    transports: ["websocket"],
  });
}
