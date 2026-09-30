import { createContext, useContext, useEffect, useState, type ReactNode } from "react";
import { login as loginRequest } from "../api/client";
import { clearToken, getToken, setToken, subscribeToken } from "./tokenStore";

interface AuthContextValue {
  /** null means logged out - see tokenStore for where this actually lives. */
  token: string | null;
  login: (username: string, password: string) => Promise<void>;
  logout: () => void;
}

const AuthContext = createContext<AuthContextValue | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [token, setTokenState] = useState<string | null>(getToken());

  useEffect(() => subscribeToken(setTokenState), []);

  const value: AuthContextValue = {
    token,
    login: async (username, password) => {
      const { accessToken } = await loginRequest(username, password);
      setToken(accessToken);
    },
    logout: () => clearToken(),
  };

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthContextValue {
  const context = useContext(AuthContext);
  if (!context) throw new Error("useAuth must be used within an AuthProvider");
  return context;
}
