/** Overridable via a .env file (VITE_BACKEND_API_URL) - see README.md. Defaults
 * to the same localhost:3000 backend-api used throughout local dev/verification. */
export const BACKEND_API_URL: string = import.meta.env.VITE_BACKEND_API_URL ?? "http://localhost:3000";
