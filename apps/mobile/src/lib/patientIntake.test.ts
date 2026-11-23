import { missingRequiredAnswers, requiredAnswersMessage } from "./patientIntake";

const COMPLETE = { nationality: "Indian", sexAtBirth: "female", genderIdentity: "woman", smoking: "never", alcohol: "never" } as const;

describe("patientIntake", () => {
  it("lists every required answer when nothing was given", () => {
    expect(missingRequiredAnswers(undefined)).toEqual(["Nationality", "Sex at birth", "Gender identity", "Smoking history", "Alcohol use"]);
    expect(missingRequiredAnswers({})).toHaveLength(5);
  });

  it("is satisfied by a complete set, and says nothing", () => {
    expect(missingRequiredAnswers({ ...COMPLETE })).toEqual([]);
    expect(requiredAnswersMessage({ ...COMPLETE })).toBeNull();
  });

  it("names exactly the missing ones", () => {
    const { smoking: _s, nationality: _n, ...rest } = COMPLETE;
    expect(requiredAnswersMessage(rest)).toBe("Please answer: Nationality, Smoking history.");
  });

  it("does not accept a blank nationality", () => {
    expect(missingRequiredAnswers({ ...COMPLETE, nationality: "   " })).toEqual(["Nationality"]);
  });

  it("counts an explicit 'prefer not to say' as an answer", () => {
    expect(missingRequiredAnswers({ ...COMPLETE, sexAtBirth: "prefer_not_to_say", genderIdentity: "prefer_not_to_say" })).toEqual([]);
  });
});
