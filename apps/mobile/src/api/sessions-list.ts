import { request } from "./http";

export interface SessionSummary {
  id: string;
  state: string;
  createdAt: string;
  protocolId: string;
  subjectPseudoId: string;
}

/** GET /sessions is clinician-only, same contract apps/clinician-web's SessionQueuePage uses. */
export function listSessions(token: string, limit?: number): Promise<SessionSummary[]> {
  const query = limit ? `?limit=${limit}` : "";
  return request<SessionSummary[]>(`/sessions${query}`, { token });
}
