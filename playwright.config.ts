import { defineConfig } from "@playwright/test";

/**
 * End-to-end tests: they start the **built** server (`dist/index.js`, so run `bun run build` first) with a temporary
 * database, and drive a real browser (Chromium) and real MCP clients. No mocks.
 */
export default defineConfig({
	testDir: "e2e",
	timeout: 60_000,
	expect: { timeout: 10_000 },
	// Each test starts its own servers on free ports: they can run in parallel.
	fullyParallel: true,
	forbidOnly: !!process.env.CI,
	retries: process.env.CI ? 1 : 0,
	reporter: process.env.CI ? [["github"], ["list"]] : "list",
	use: { browserName: "chromium", trace: "retain-on-failure" },
});
