import { defineConfig } from "vitest/config";
import { alias } from "./vitest.alias.js";

// Unit and repository tests: `src/**/*.spec.ts`. The e2e tests are in `test/` (`vitest.config.e2e.ts`).
export default defineConfig({
	resolve: { alias },
	test: {
		include: ["src/**/*.spec.ts"],
		environment: "node",
	},
});
