import { defineConfig } from "@playwright/test";
import { existsSync } from "node:fs";
if (existsSync(".env.local")) process.loadEnvFile(".env.local");
export default defineConfig({ testDir: "./tests/e2e", timeout: 240000, workers: 1, use: { baseURL: process.env.IRIS_E2E_BASE_URL ?? "http://127.0.0.1:3000", browserName: "chromium", viewport: { width: 1440, height: 1100 }, actionTimeout: 15000, navigationTimeout: 20000, trace: "retain-on-failure", screenshot: "only-on-failure" } });
