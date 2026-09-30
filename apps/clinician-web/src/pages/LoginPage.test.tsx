import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { afterEach, describe, expect, it, vi } from "vitest";
import * as client from "../api/client";
import { AuthProvider } from "../auth/AuthContext";
import { clearToken, getToken } from "../auth/tokenStore";
import { LoginPage } from "./LoginPage";

function renderLoginPage() {
  render(
    <MemoryRouter initialEntries={["/login"]}>
      <AuthProvider>
        <Routes>
          <Route path="/login" element={<LoginPage />} />
          <Route path="/" element={<div>queue page</div>} />
        </Routes>
      </AuthProvider>
    </MemoryRouter>
  );
}

afterEach(() => {
  vi.restoreAllMocks();
  clearToken();
});

describe("LoginPage", () => {
  it("logs in and stores the token on success", async () => {
    vi.spyOn(client, "login").mockResolvedValue({ accessToken: "a.jwt.token" });
    renderLoginPage();

    await userEvent.type(screen.getByLabelText("Username"), "drchen");
    await userEvent.type(screen.getByLabelText("Password"), "the-password");
    await userEvent.click(screen.getByRole("button", { name: "Sign in" }));

    await waitFor(() => expect(getToken()).toBe("a.jwt.token"));
    await waitFor(() => expect(screen.getByText("queue page")).toBeInTheDocument());
  });

  it("shows an error and does not store a token on failed login", async () => {
    vi.spyOn(client, "login").mockRejectedValue(new Error("Invalid username or password"));
    renderLoginPage();

    await userEvent.type(screen.getByLabelText("Username"), "drchen");
    await userEvent.type(screen.getByLabelText("Password"), "wrong-password");
    await userEvent.click(screen.getByRole("button", { name: "Sign in" }));

    await waitFor(() => expect(screen.getByText("Invalid username or password")).toBeInTheDocument());
    expect(getToken()).toBeNull();
  });
});
