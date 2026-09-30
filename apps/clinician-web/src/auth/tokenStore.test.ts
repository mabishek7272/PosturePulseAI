import { afterEach, describe, expect, it, vi } from "vitest";
import { clearToken, getToken, setToken, subscribeToken } from "./tokenStore";

afterEach(() => {
  clearToken();
});

describe("tokenStore", () => {
  it("starts with no token", () => {
    expect(getToken()).toBeNull();
  });

  it("setToken makes getToken return it and persists to sessionStorage", () => {
    setToken("abc.def.ghi");
    expect(getToken()).toBe("abc.def.ghi");
    expect(sessionStorage.getItem("clinician-web:token")).toBe("abc.def.ghi");
  });

  it("clearToken removes it from both memory and sessionStorage", () => {
    setToken("abc.def.ghi");
    clearToken();
    expect(getToken()).toBeNull();
    expect(sessionStorage.getItem("clinician-web:token")).toBeNull();
  });

  it("notifies subscribers on set and clear", () => {
    const listener = vi.fn();
    const unsubscribe = subscribeToken(listener);

    setToken("abc.def.ghi");
    expect(listener).toHaveBeenCalledWith("abc.def.ghi");

    clearToken();
    expect(listener).toHaveBeenCalledWith(null);

    unsubscribe();
    setToken("xyz");
    expect(listener).toHaveBeenCalledTimes(2);
  });
});
