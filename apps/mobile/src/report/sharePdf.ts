import Constants from "expo-constants";
import * as Print from "expo-print";
import * as Sharing from "expo-sharing";
import { ApiError, request } from "../api/http";
import type { MetricResult } from "../api/events";
import { getConsentSignatures } from "../api/sessions";
import { buildReportHtml } from "./reportHtml";

/**
 * Renders the scan's report to a PDF on the device and opens the system share
 * sheet (Mail, Files, AirDrop, ...). Nothing is uploaded by this; the file is
 * written to the app's cache. Signatures are fetched with the clinician token;
 * a scan from before signatures existed exports without them and says so.
 */
export async function shareReportPdf(opts: {
  sessionId: string;
  patientName: string | null;
  results: MetricResult[];
  token: string;
}): Promise<void> {
  const session = await request<{ createdAt?: string; consentRecordId?: string }>(
    `/sessions/${encodeURIComponent(opts.sessionId)}`,
    { token: opts.token },
  );
  let signatures = null;
  if (session.consentRecordId) {
    try {
      signatures = await getConsentSignatures(session.consentRecordId, opts.token);
    } catch (err) {
      if (!(err instanceof ApiError && err.status === 404)) throw err;
    }
  }
  const html = buildReportHtml({
    patientName: opts.patientName,
    sessionId: opts.sessionId,
    scannedAt: session.createdAt ?? null,
    results: opts.results,
    signatures,
    producedAt: new Date().toISOString(),
    appVersion: Constants.expoConfig?.version ?? "dev",
  });
  // A4 at 72 PPI.
  const { uri } = await Print.printToFileAsync({ html, width: 595, height: 842 });
  if (!(await Sharing.isAvailableAsync())) {
    throw new Error("Sharing is not available on this device.");
  }
  await Sharing.shareAsync(uri, { mimeType: "application/pdf", UTI: "com.adobe.pdf", dialogTitle: "Share assessment report" });
}
