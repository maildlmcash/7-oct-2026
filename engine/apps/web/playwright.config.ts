import { defineConfig } from "@playwright/test";

export default defineConfig({
  testDir: "./tests",
  // One browser at a time. A second browser during the first Next.js compile
  // can refresh the document, which the shell navigation test counts.
  workers: 1,
  use: {
    baseURL: "http://localhost:3468",
  },
  webServer: {
    command: "pnpm exec next dev -p 3468",
    url: "http://localhost:3468",
    reuseExistingServer: false,
    timeout: 120000,
  },
});
