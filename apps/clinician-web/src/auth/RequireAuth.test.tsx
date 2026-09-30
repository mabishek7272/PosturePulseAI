import { render, screen } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { afterEach, describe, expect, it } from "vitest";
import { clearToken, setToken } from "./tokenStore";
import { AuthProvider } from "./AuthContext";
import { RequireAuth } from "./RequireAuth";

function renderAt(path: string) {
  render(
    <MemoryRouter initialEntries={[path]}>
      <AuthProvider>
        <Routes>
          <Route path="/login" element={<div>login page</div>} />
          <Route
            path="/protected"
            element={
              <RequireAuth>
                <div>protected content</div>
              </RequireAuth>
            }
          />
        </Routes>
      </AuthProvider>
    </MemoryRouter>
  );
}

afterEach(() => {
  clearToken();
});

describe("RequireAuth", () => {
  it("redirects to /login when there is no token", () => {
    renderAt("/protected");
    expect(screen.getByText("login page")).toBeInTheDocument();
  });

  it("renders the protected content when a token is present", () => {
    setToken("a.valid.token");
    renderAt("/protected");
    expect(screen.getByText("protected content")).toBeInTheDocument();
  });
});
