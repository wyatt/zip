import { defineConfig } from "@playwright/test";
export default defineConfig({ testDir: "./tests/e2e", timeout: 60000, workers: 1, use: { baseURL: "http://127.0.0.1:3000", browserName: "chromium", viewport: { width: 1440, height: 1100 }, trace: "retain-on-failure" } });
