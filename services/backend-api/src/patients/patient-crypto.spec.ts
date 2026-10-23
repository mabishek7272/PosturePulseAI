import { randomBytes } from "node:crypto";
import { PatientCrypto } from "./patient-crypto";

const KEY = randomBytes(32).toString("base64");

describe("PatientCrypto", () => {
  it("round-trips a value", () => {
    const crypto = new PatientCrypto(KEY);
    const sealed = crypto.encrypt("name", "Ada Example");
    expect(sealed).toMatch(/^v1\.[^.]+\.[^.]+\.[^.]+$/);
    expect(sealed).not.toContain("Ada");
    expect(crypto.decrypt("name", sealed)).toBe("Ada Example");
  });

  it("handles non-ASCII text and empty strings", () => {
    const crypto = new PatientCrypto(KEY);
    expect(crypto.decrypt("name", crypto.encrypt("name", "Zoë Müller 山田"))).toBe("Zoë Müller 山田");
    expect(crypto.decrypt("contact", crypto.encrypt("contact", ""))).toBe("");
  });

  it("uses a fresh random IV every time", () => {
    const crypto = new PatientCrypto(KEY);
    expect(crypto.encrypt("name", "same")).not.toBe(crypto.encrypt("name", "same"));
  });

  it("refuses a tampered value", () => {
    const crypto = new PatientCrypto(KEY);
    const [v, iv, tag, ct] = crypto.encrypt("name", "Ada").split(".");
    const flipped = Buffer.from(ct, "base64");
    flipped[0] ^= 1;
    expect(() => crypto.decrypt("name", [v, iv, tag, flipped.toString("base64")].join("."))).toThrow();
  });

  it("refuses a value sealed under another key", () => {
    const sealed = new PatientCrypto(KEY).encrypt("name", "Ada");
    expect(() => new PatientCrypto(randomBytes(32).toString("base64")).decrypt("name", sealed)).toThrow();
  });

  it("binds a value to its field, so a name cannot be swapped into the date-of-birth column", () => {
    const crypto = new PatientCrypto(KEY);
    expect(() => crypto.decrypt("dob", crypto.encrypt("name", "Ada"))).toThrow();
  });

  it("refuses an unknown format", () => {
    expect(() => new PatientCrypto(KEY).decrypt("name", "plain text")).toThrow(/format/);
  });

  describe("key", () => {
    it("is required: fromEnv refuses to start without PATIENT_DATA_KEY", () => {
      expect(() => PatientCrypto.fromEnv({})).toThrow(/PATIENT_DATA_KEY/);
      expect(() => PatientCrypto.fromEnv({ PATIENT_DATA_KEY: "" })).toThrow(/PATIENT_DATA_KEY/);
    });

    it("must be 32 bytes of base64", () => {
      expect(() => new PatientCrypto(randomBytes(16).toString("base64"))).toThrow(/32 bytes/);
      expect(() => new PatientCrypto("not base64 !!")).toThrow(/32 bytes/);
    });

    it("fromEnv reads the variable", () => {
      const crypto = PatientCrypto.fromEnv({ PATIENT_DATA_KEY: KEY });
      expect(crypto.decrypt("name", new PatientCrypto(KEY).encrypt("name", "x"))).toBe("x");
    });
  });
});
