import { io, type Socket } from "socket.io-client";
import { BACKEND_API_URL } from "./config";

/**
 * Joins the same per-session Socket.IO room iOS clients use
 * (services/backend-api/src/ws/session.gateway.ts) to get live event
 * broadcasts (pose/quality/decision/exposure/movement/camera-pose/sensor
 * events) without polling. The caller is responsible for calling
 * `disconnect()` on unmount.
 */
export function connectToSession(sessionId: string): Socket {
  return io(BACKEND_API_URL, {
    query: { sessionId },
    transports: ["websocket"],
  });
}
