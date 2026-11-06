/// <reference types="vitest/config" />
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],
  test: {
    // Explicit, so test discovery never depends on where vitest is launched
    // from (npm workspace, this directory, or a git worktree under a dot-dir).
    root: import.meta.dirname,
    include: ["src/**/*.test.{ts,tsx}"],
    environment: "jsdom",
    setupFiles: "./src/test-setup.ts",
    globals: true,
    // Pinned so the API-client tests (which assert http://localhost:3000) never
    // depend on a developer's gitignored .env.local pointing at a real server.
    env: { VITE_BACKEND_API_URL: "http://localhost:3000" },
  },
});
