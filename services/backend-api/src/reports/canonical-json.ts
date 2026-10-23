import { createHash } from "node:crypto";

/** JSON with object keys sorted at every depth, so equal documents always serialise to the same bytes. */
export function canonicalJson(value: unknown): string {
  return JSON.stringify(sortKeys(value));
}

function sortKeys(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sortKeys);
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>)
        .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
        .map(([k, v]) => [k, sortKeys(v)])
    );
  }
  return value;
}

/**
 * sha256 over the canonical JSON of the whole report body, with the digest
 * field itself (signOff.contentSha256) left out: that is what sign-off stores
 * and what anyone re-checking a released report recomputes. signOff's
 * clinicianId and signedAt, status and every row are covered.
 */
export function reportContentSha256(body: { signOff?: unknown } & Record<string, unknown>): string {
  const signOff = body.signOff as Record<string, unknown> | null | undefined;
  const hashed = signOff && typeof signOff === "object" ? { ...body, signOff: omitDigest(signOff) } : body;
  return createHash("sha256").update(canonicalJson(hashed)).digest("hex");
}

function omitDigest(signOff: Record<string, unknown>): Record<string, unknown> {
  const { contentSha256: _digest, ...rest } = signOff;
  return rest;
}
