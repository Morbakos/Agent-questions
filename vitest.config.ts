import { defineConfig } from "vitest/config";

// Tests of the shared package. The server has its own `vitest.config.ts` (packages/server) and the UI its own runner (`ng test`).
export default defineConfig({
	test: {
		include: ["packages/shared/**/*.test.ts"],
		environment: "node",
	},
});
