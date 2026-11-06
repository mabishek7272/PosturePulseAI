import type { MetricResult } from "../api/events";
import { formatResult, formatValueParts, hasReferenceComparison, metricLabel, NO_REFERENCE_CAPTION, positionLabel } from "../lib/results";

export interface SignatureMark {
  svgPath: string;
  signedAt: string;
}

export interface ReportPdfInput {
  patientName: string | null;
  sessionId: string;
  /** ISO time the session was created. */
  scannedAt: string | null;
  results: MetricResult[];
  signatures: { subject: SignatureMark; clinician: SignatureMark } | null;
  /** ISO time the PDF was produced. */
  producedAt: string;
  appVersion: string;
}

/**
 * Footer wording. Mirrors docs/claims-and-scope.md: draft, not clinically
 * validated, describes visible geometry, and leaves interpretation to the
 * clinician. Never a diagnosis or a score.
 */
export const PDF_DISCLAIMER =
  "Draft. Not clinically validated. These values describe body-landmark geometry measured from video, each with its " +
  "uncertainty. They are not a diagnosis and not a score. A clinician interprets them.";

const ESCAPES: Record<string, string> = { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" };

export function escapeHtml(text: string): string {
  return text.replace(/[&<>"']/g, (c) => ESCAPES[c] ?? c);
}

/** Only plain SVG path data (as the server enforces) may be embedded; anything else is dropped. */
const SAFE_PATH = /^[MLQl0-9 .-]+$/;

/** viewBox around the path's own coordinates, with a margin; null when there are no coordinates. */
export function pathViewBox(path: string, margin = 6): string | null {
  const nums = (path.match(/-?\d+(?:\.\d+)?/g) ?? []).map(Number);
  // Relative "l" commands (single-point dots) add tiny offsets; absolute pairs dominate the box.
  const xs: number[] = [];
  const ys: number[] = [];
  for (let i = 0; i + 1 < nums.length; i += 2) {
    xs.push(nums[i]!);
    ys.push(nums[i + 1]!);
  }
  if (xs.length === 0) return null;
  const minX = Math.min(...xs) - margin;
  const minY = Math.min(...ys) - margin;
  const w = Math.max(...xs) - Math.min(...xs) + 2 * margin;
  const h = Math.max(...ys) - Math.min(...ys) + 2 * margin;
  return `${minX.toFixed(1)} ${minY.toFixed(1)} ${Math.max(w, 1).toFixed(1)} ${Math.max(h, 1).toFixed(1)}`;
}

export function signatureSvg(path: string): string {
  if (!SAFE_PATH.test(path)) return `<div class="sig-missing">Signature unavailable</div>`;
  const box = pathViewBox(path);
  if (!box) return `<div class="sig-missing">Signature unavailable</div>`;
  return `<svg class="sig" viewBox="${box}" preserveAspectRatio="xMidYMid meet" xmlns="http://www.w3.org/2000/svg"><path d="${path}" fill="none" stroke="#1d1a3a" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"/></svg>`;
}

function formatDate(iso: string | null): string {
  if (!iso) return "–";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "–";
  return d.toLocaleString("en-GB", { day: "numeric", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" });
}

function rowHtml(r: MetricResult, i: number): string {
  const parts = formatValueParts(r);
  const value = parts ? `${parts.value} <span class="unc">${parts.uncertainty}</span>` : escapeHtml(formatResult(r));
  const reference = parts
    ? hasReferenceComparison(r)
      ? `${escapeHtml(positionLabel(r))}<div class="sub">Reference ${escapeHtml(r.reference?.label ?? "")}</div>`
      : `<span class="muted">${escapeHtml(NO_REFERENCE_CAPTION)}</span>`
    : `<span class="muted">–</span>`;
  const note = r.analysis?.text ? `<div class="sub">${escapeHtml(r.analysis.text)}</div>` : "";
  return `<tr><td class="num">${i + 1}</td><td>${escapeHtml(metricLabel(r))}${r.tier === "proxy" ? ' <span class="tag">proxy</span>' : ""}${note}</td><td class="val">${value}</td><td>${reference}</td></tr>`;
}

/** The whole report as one self-contained HTML document for expo-print. No external resources. */
export function buildReportHtml(input: ReportPdfInput): string {
  const rows = input.results.map(rowHtml).join("");
  const measured = input.results.filter((r) => r.estimate).length;
  const sigBlock = input.signatures
    ? `<div class="sigs">
        <div class="sigbox"><div class="siglabel">Patient</div>${signatureSvg(input.signatures.subject.svgPath)}<div class="sub">Signed ${escapeHtml(formatDate(input.signatures.subject.signedAt))}</div></div>
        <div class="sigbox"><div class="siglabel">Clinician</div>${signatureSvg(input.signatures.clinician.svgPath)}<div class="sub">Signed ${escapeHtml(formatDate(input.signatures.clinician.signedAt))}</div></div>
      </div>`
    : `<p class="muted">No consent signatures are on record for this scan (it was taken before signatures were captured).</p>`;

  return `<!doctype html><html><head><meta charset="utf-8"><style>
  @page { margin: 28px; }
  body { font-family: -apple-system, Helvetica, Arial, sans-serif; color: #1d1a3a; font-size: 11px; }
  .bar { height: 6px; background: linear-gradient(90deg, #6d4cf5, #b5abfc); border-radius: 3px; margin-bottom: 14px; }
  h1 { font-size: 20px; margin: 0; letter-spacing: -0.3px; }
  h1 span { color: #6d4cf5; }
  .meta { display: flex; flex-wrap: wrap; gap: 4px 22px; margin: 10px 0 16px; color: #4b4870; }
  .meta b { color: #1d1a3a; }
  table { width: 100%; border-collapse: collapse; }
  th { text-align: left; font-size: 10px; text-transform: uppercase; letter-spacing: 0.6px; color: #6b6890; border-bottom: 1.5px solid #d9d5f5; padding: 6px 6px; }
  td { border-bottom: 1px solid #ecebf7; padding: 7px 6px; vertical-align: top; }
  td.num { color: #8a87a8; width: 18px; }
  td.val { white-space: nowrap; font-weight: 600; }
  .unc { font-weight: 400; color: #6b6890; }
  .sub { color: #6b6890; font-size: 9.5px; margin-top: 2px; }
  .muted { color: #8a87a8; }
  .tag { font-size: 8.5px; color: #6d4cf5; border: 1px solid #b5abfc; border-radius: 4px; padding: 0 4px; }
  h2 { font-size: 13px; margin: 22px 0 8px; }
  .sigs { display: flex; gap: 18px; }
  .sigbox { flex: 1; border: 1px solid #d9d5f5; border-radius: 8px; padding: 8px 10px; }
  .siglabel { font-size: 10px; text-transform: uppercase; letter-spacing: 0.6px; color: #6b6890; }
  .sig { width: 100%; height: 70px; }
  .sig-missing { height: 70px; color: #8a87a8; }
  .assess { border: 1px dashed #b5abfc; border-radius: 8px; height: 70px; }
  footer { margin-top: 20px; color: #6b6890; font-size: 9px; border-top: 1px solid #ecebf7; padding-top: 8px; }
  </style></head><body>
  <div class="bar"></div>
  <h1>PosturePulse <span>Pro</span> · Posture assessment</h1>
  <div class="meta">
    <div>Patient <b>${escapeHtml(input.patientName ?? "Not linked")}</b></div>
    <div>Scan <b>${escapeHtml(formatDate(input.scannedAt))}</b></div>
    <div>Session <b>${escapeHtml(input.sessionId.slice(0, 8))}</b></div>
    <div>Measured <b>${measured} of ${input.results.length}</b></div>
  </div>
  <table><thead><tr><th>#</th><th>Measurement</th><th>Value ± uncertainty</th><th>Reference</th></tr></thead><tbody>${rows}</tbody></table>
  <h2>Clinician assessment</h2>
  <div class="assess"></div>
  <h2>Consent</h2>
  ${sigBlock}
  <footer>${escapeHtml(PDF_DISCLAIMER)}<br/>Produced ${escapeHtml(formatDate(input.producedAt))} · app ${escapeHtml(input.appVersion)}</footer>
  </body></html>`;
}
