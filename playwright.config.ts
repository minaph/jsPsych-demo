import { defineConfig } from "@playwright/test";
export default defineConfig({ testDir: "./e2e", timeout: 60_000, workers: 1, retries: 0, reporter: "list", use: { baseURL: process.env.TEST_BASE_URL ?? "http://127.0.0.1:5173", channel: "chrome", viewport: { width: 1280, height: 1000 }, trace: "retain-on-failure", screenshot: "only-on-failure" } });
