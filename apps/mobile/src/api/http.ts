import { BACKEND_URL } from "./config";

export class ApiError extends Error {
  constructor(message: string, readonly status: number) {
    super(message);
  }
}

/** 401 is separate so the caller can clear the stored token and return to login. */
export class UnauthorizedError extends ApiError {
  constructor() {
    super("Your session has expired - please log in again.", 401);
  }
}

/**
 * Called on any 401. The app wires this to clearing the keychain, so an
 * expired token is dropped once rather than retried by every later screen.
 * Kept as a handler so this module stays free of storage dependencies.
 */
let unauthorizedHandler: (() => void) | null = null;

export function setUnauthorizedHandler(handler: (() => void) | null): void {
  unauthorizedHandler = handler;
}

/**
 * Asked for a fresh access token when a call with `staleToken` got a 401. Resolves a new token,
 * or null when the session cannot be renewed (refresh token expired or revoked). Rejects on a
 * network failure, which must NOT sign the clinician out.
 */
type RefreshHandler = (staleToken: string) => Promise<string | null>;
let refreshHandler: RefreshHandler | null = null;

export function setRefreshHandler(handler: RefreshHandler | null): void {
  refreshHandler = handler;
}

interface RequestOptions {
  method?: string;
  body?: unknown;
  token?: string;
  /** For the refresh call itself: a 401 there is an answer, not a reason to lock the app a second time. */
  skipUnauthorizedHandler?: boolean;
}

async function serverMessage(response: Response): Promise<string> {
  try {
    const body = (await response.json()) as { message?: unknown };
    if (typeof body?.message === "string") return body.message;
    if (Array.isArray(body?.message)) return body.message.join("; ");
  } catch {
    // No JSON body - the status line is all there is.
  }
  return response.statusText;
}

export async function request<T>(path: string, options: RequestOptions = {}): Promise<T> {
  const send = (token: string | undefined) => {
    const headers: Record<string, string> = {};
    if (options.body !== undefined) headers["content-type"] = "application/json";
    if (token) headers.Authorization = `Bearer ${token}`;
    return fetch(`${BACKEND_URL}${path}`, {
      method: options.method ?? "GET",
      headers,
      body: options.body === undefined ? undefined : JSON.stringify(options.body),
    });
  };

  let response = await send(options.token);

  // An expired access token is renewed once and the call retried, so a clinician is not
  // sent to the login screen while their 30-day refresh token is still good.
  if (response.status === 401 && options.token && refreshHandler) {
    const fresh = await refreshHandler(options.token);
    if (fresh) response = await send(fresh);
  }

  await assertOk(response, options.skipUnauthorizedHandler);
  return (await response.json()) as T;
}

/**
 * Shared failure handling for every call, including the multipart clip upload
 * which cannot go through `request()` because it sends FormData.
 */
export async function assertOk(response: Response, skipUnauthorizedHandler = false): Promise<void> {
  if (response.status === 401) {
    if (!skipUnauthorizedHandler) unauthorizedHandler?.();
    throw new UnauthorizedError();
  }
  if (!response.ok) {
    // A bare "Internal server error" tells the clinician nothing and the
    // developer even less, so name the status and the call that produced it.
    throw new ApiError(
      `${await serverMessage(response)} (${response.status} ${pathOf(response)})`,
      response.status
    );
  }
}

function pathOf(response: Response): string {
  try {
    return new URL(response.url).pathname;
  } catch {
    return "unknown endpoint";
  }
}
