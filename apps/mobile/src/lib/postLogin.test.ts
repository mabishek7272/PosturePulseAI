import { resolvePostLoginRoute } from "./postLogin";

describe("resolvePostLoginRoute", () => {
  it("sends a first-time doctor to profile setup", async () => {
    await expect(resolvePostLoginRoute(async () => ({ complete: false }))).resolves.toBe("/doctor-profile?setup=1");
  });

  it("sends a doctor with a complete profile straight to permissions", async () => {
    await expect(resolvePostLoginRoute(async () => ({ complete: true }))).resolves.toBe("/permissions");
  });

  it("does not block sign-in when the profile cannot be read", async () => {
    await expect(resolvePostLoginRoute(async () => { throw new Error("network down"); })).resolves.toBe("/permissions");
    await expect(resolvePostLoginRoute(() => Promise.reject(new Error("500")))).resolves.toBe("/permissions");
  });
});
