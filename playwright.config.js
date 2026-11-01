// Browser UI tests. They run against the production build (vite preview), so
// a bundling or CSP problem the dev server hides still fails here. Port 5181,
// next to the app's pinned 5180, so a running dev session is left alone.
// Drives the installed Microsoft Edge: no browser download needed.
// Run: npx playwright test   (or: python run.py e2e)
import { defineConfig, devices } from "@playwright/test";

const PORT = 5181;

export default defineConfig({
  testDir: "e2e",
  testMatch: /\.spec\.mjs$/,
  outputDir: "test-results",
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? [["github"], ["html", { open: "never" }]] : "list",
  use: {
    baseURL: `http://127.0.0.1:${PORT}`,
    channel: process.env.CDASS_UI_BROWSER || "msedge",
    acceptDownloads: true,
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
  },
  projects: [
    { name: "desktop", use: { ...devices["Desktop Edge"], channel: process.env.CDASS_UI_BROWSER || "msedge" } },
  ],
  webServer: {
    command: `npx vite build && npx vite preview --host 127.0.0.1 --port ${PORT} --strictPort`,
    url: `http://127.0.0.1:${PORT}`,
    reuseExistingServer: !process.env.CI,
    timeout: 120_000,
  },
});
