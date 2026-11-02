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

interface RequestOptions {
  method?: string;
  body?: unknown;
  token?: string;
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
  const headers: Record<string, string> = {};
  if (options.body !== undefined) headers["content-type"] = "application/json";
  if (options.token) headers.Authorization = `Bearer ${options.token}`;

  const response = await fetch(`${BACKEND_URL}${path}`, {
    method: options.method ?? "GET",
    headers,
    body: options.body === undefined ? undefined : JSON.stringify(options.body),
  });

  await assertOk(response);
  return (await response.json()) as T;
}

/**
 * Shared failure handling for every call, including the multipart clip upload
 * which cannot go through `request()` because it sends FormData.
 */
export async function assertOk(response: Response): Promise<void> {
  if (response.status === 401) {
    unauthorizedHandler?.();
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
