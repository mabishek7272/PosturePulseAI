import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";

export type PatientField = "name" | "dob" | "contact" | "intake" | "consent_signatures";

const FORMAT = "v1";
const KEY_BYTES = 32;
const IV_BYTES = 12;

/**
 * AES-256-GCM for the patient register (ADR-017). Each value is sealed on its
 * own with a fresh random IV, and the field name is authenticated as
 * additional data, so ciphertext cannot be moved between columns. Format:
 * `v1.<iv>.<tag>.<ciphertext>` (base64). The key is PATIENT_DATA_KEY: 32
 * random bytes, base64. Losing the key makes the register unreadable.
 */
export class PatientCrypto {
  private readonly key: Buffer;

  constructor(base64Key: string) {
    const key = Buffer.from(base64Key, "base64");
    if (key.length !== KEY_BYTES || key.toString("base64") !== base64Key.trim()) {
      throw new Error("PATIENT_DATA_KEY must be 32 bytes, base64-encoded (for example: openssl rand -base64 32).");
    }
    this.key = key;
  }

  /** Throws unless PATIENT_DATA_KEY is set to a valid key: the register must not start without it. */
  static fromEnv(env: Record<string, string | undefined> = process.env): PatientCrypto {
    const value = env.PATIENT_DATA_KEY;
    if (!value) {
      throw new Error("PATIENT_DATA_KEY is required by the patient register and is not set.");
    }
    return new PatientCrypto(value);
  }

  encrypt(field: PatientField, plaintext: string): string {
    const iv = randomBytes(IV_BYTES);
    const cipher = createCipheriv("aes-256-gcm", this.key, iv);
    cipher.setAAD(Buffer.from(field, "utf-8"));
    const ciphertext = Buffer.concat([cipher.update(plaintext, "utf-8"), cipher.final()]);
    return [FORMAT, iv.toString("base64"), cipher.getAuthTag().toString("base64"), ciphertext.toString("base64")].join(".");
  }

  decrypt(field: PatientField, sealed: string): string {
    const parts = sealed.split(".");
    if (parts.length !== 4 || parts[0] !== FORMAT) throw new Error("Unknown sealed-value format.");
    const [, iv, tag, ciphertext] = parts.map((p, i) => (i === 0 ? p : Buffer.from(p, "base64"))) as [string, Buffer, Buffer, Buffer];
    const decipher = createDecipheriv("aes-256-gcm", this.key, iv);
    decipher.setAAD(Buffer.from(field, "utf-8"));
    decipher.setAuthTag(tag);
    return Buffer.concat([decipher.update(ciphertext), decipher.final()]).toString("utf-8");
  }
}
