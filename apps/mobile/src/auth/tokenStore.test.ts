import * as SecureStore from "expo-secure-store";
import { clearClinicianToken, getClinicianToken, getRefreshToken, saveClinicianToken, saveRefreshToken } from "./tokenStore";

jest.mock("expo-secure-store");

describe("tokenStore", () => {
  afterEach(() => jest.resetAllMocks());

  it("saves the clinician token under its own key", async () => {
    await saveClinicianToken("tok-abc");
    expect(SecureStore.setItemAsync).toHaveBeenCalledWith("beaive.clinicianToken", "tok-abc");
  });

  it("reads the clinician token back", async () => {
    (SecureStore.getItemAsync as jest.Mock).mockResolvedValue("tok-abc");
    await expect(getClinicianToken()).resolves.toBe("tok-abc");
  });

  it("returns null rather than throwing when the keychain is unavailable", async () => {
    (SecureStore.getItemAsync as jest.Mock).mockRejectedValue(new Error("keychain locked"));
    await expect(getClinicianToken()).resolves.toBeNull();
  });

  it("clears BOTH tokens on logout", async () => {
    await clearClinicianToken();
    expect(SecureStore.deleteItemAsync).toHaveBeenCalledWith("beaive.clinicianToken");
    expect(SecureStore.deleteItemAsync).toHaveBeenCalledWith("beaive.clinicianRefreshToken");
  });

  it("keeps the refresh token under its own Keychain key", async () => {
    await saveRefreshToken("r-abc");
    expect(SecureStore.setItemAsync).toHaveBeenCalledWith("beaive.clinicianRefreshToken", "r-abc");
    (SecureStore.getItemAsync as jest.Mock).mockResolvedValue("r-abc");
    await expect(getRefreshToken()).resolves.toBe("r-abc");
  });

  it("reads no refresh token, rather than throwing, when the keychain is unavailable", async () => {
    (SecureStore.getItemAsync as jest.Mock).mockRejectedValue(new Error("keychain locked"));
    await expect(getRefreshToken()).resolves.toBeNull();
  });
});
