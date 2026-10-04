import { defineConfig } from "@playwright/test";

export default defineConfig({
  testDir: "./e2e",
  fullyParallel: false,
  workers: 1,
  timeout: 45000,
  expect: { timeout: 10000 },
  reporter: [["list"], ["html", { open: "never" }]],
  use: {
    baseURL: "http://localhost:5174",
    browserName: "chromium",
    viewport: { width: 1280, height: 800 },
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
  },
  webServer: [
    {
      command: "pnpm --filter @snapland/shared build && pnpm --dir ../backend migrate:up && pnpm --dir ../backend build && node ../backend/dist/main.js",
      url: "http://localhost:4124/readyz",
      timeout: 120000,
      reuseExistingServer: false,
      env: {
        NODE_ENV: "test", PORT: "4124",
        DATABASE_URL: process.env.E2E_DATABASE_URL ?? "postgres://snapland:snapland@localhost:55432/snapland",
        REDIS_URL: process.env.E2E_REDIS_URL ?? "redis://localhost:56379",
        JWT_ACCESS_SECRET: "browser-test-access-secret-only",
        JWT_REFRESH_SECRET: "browser-test-refresh-secret-only",
        CORS_ORIGIN: "http://localhost:5174",
        AREAS_QUERY_LIMIT: "1000",
      },
    },
    {
      command: "pnpm dev --host 127.0.0.1",
      url: "http://localhost:5174",
      reuseExistingServer: false,
      env: { FRONTEND_PORT: "5174", VITE_API_URL: "http://localhost:4124", VITE_WS_URL: "ws://localhost:4124/ws" },
    },
  ],
});
