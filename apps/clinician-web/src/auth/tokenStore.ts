// A tiny external store (not React state) so both the API client (plain
// functions, no component tree) and AuthContext (React state, for
// re-rendering on login/logout) can share one source of truth for the
// clinician's JWT (docs/adr/010-clinician-authentication.md). Kept in
// sessionStorage, not localStorage, so a token doesn't outlive the tab.

const STORAGE_KEY = "clinician-web:token";
type Listener = (token: string | null) => void;

function readFromStorage(): string | null {
  try {
    return sessionStorage.getItem(STORAGE_KEY);
  } catch {
    return null;
  }
}

let currentToken: string | null = readFromStorage();
const listeners = new Set<Listener>();

export function getToken(): string | null {
  return currentToken;
}

export function setToken(token: string): void {
  currentToken = token;
  try {
    sessionStorage.setItem(STORAGE_KEY, token);
  } catch {
    // Private-mode/blocked storage: the token still works for this page
    // load via the in-memory copy, it just won't survive a reload.
  }
  listeners.forEach((listener) => listener(token));
}

export function clearToken(): void {
  currentToken = null;
  try {
    sessionStorage.removeItem(STORAGE_KEY);
  } catch {
    // See setToken - non-fatal.
  }
  listeners.forEach((listener) => listener(null));
}

export function subscribeToken(listener: Listener): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}
