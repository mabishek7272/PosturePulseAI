import { buildProfileInput, draftFromProfile, EMPTY_DRAFT, profileProblems } from "./doctorProfile";
import type { Stroke } from "./signature";

const FULL = { ...EMPTY_DRAFT, fullName: "Dr Mei Chen", specialty: "Physiotherapy", licenceNumber: "PT-12345" };
const INK: Stroke[] = [Array.from({ length: 30 }, (_, i) => ({ x: i * 6, y: 40 + (i % 5) * 4 }))];

describe("profileProblems", () => {
  it("asks for everything on an empty first-time form", () => {
    expect(profileProblems(EMPTY_DRAFT, false, [])).toEqual([
      "Full name is required.", "Specialty is required.", "Licence / registration number is required.", "Draw your signature.",
    ]);
  });

  it("is satisfied by name, specialty, licence and a real signature", () => {
    expect(profileProblems(FULL, false, INK)).toEqual([]);
  });

  it("does not need a new drawing when one is already on file", () => {
    expect(profileProblems(FULL, true, [])).toEqual([]);
  });

  it("rejects a scribble that is too short to be a signature", () => {
    expect(profileProblems(FULL, false, [[{ x: 1, y: 1 }, { x: 2, y: 2 }]])).toContain("The signature is too short; draw it again.");
  });

  it("treats whitespace as empty", () => {
    expect(profileProblems({ ...FULL, licenceNumber: "   " }, true, [])).toEqual(["Licence / registration number is required."]);
  });
});

describe("buildProfileInput", () => {
  it("trims, and sends cleared optional fields as null so they are really cleared", () => {
    const input = buildProfileInput({ ...FULL, fullName: "  Dr Mei Chen ", clinic: "  ", qualifications: "MPT" }, [], 300, 150);
    expect(input).toMatchObject({ fullName: "Dr Mei Chen", clinic: null, qualifications: "MPT", licensingAuthority: null });
  });

  it("omits the signature unless a new one was drawn, so the stored one is kept", () => {
    expect(buildProfileInput(FULL, [], 300, 150)).not.toHaveProperty("signature");
    const withInk = buildProfileInput(FULL, INK, 300, 150);
    expect(withInk.signature).toMatchObject({ width: 300, height: 150 });
    expect(withInk.signature!.paths[0]).toMatch(/^M /);
  });
});

describe("draftFromProfile", () => {
  it("fills nulls with empty strings for the inputs", () => {
    expect(draftFromProfile(null)).toEqual(EMPTY_DRAFT);
    expect(draftFromProfile({
      fullName: "A", specialty: null, licenceNumber: "L", qualifications: null, licensingAuthority: null, clinic: "C",
      professionalContact: null, hasSignature: true, complete: false, updatedAt: null,
    })).toMatchObject({ fullName: "A", specialty: "", licenceNumber: "L", clinic: "C" });
  });
});
