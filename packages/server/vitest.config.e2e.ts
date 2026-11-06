import { defineConfig } from "vitest/config";
import { alias } from "./vitest.alias.js";

// E2E tests: full Nest application (`test/*.e2e-spec.ts`), mounted with `createTestApplication`.
export default defineConfig({
	resolve: { alias },
	test: {
		include: ["test/**/*.e2e-spec.ts"],
		environment: "node",
		// Cold start of a full application + scrypt (admin creation): the default 5 s is too tight.
		testTimeout: 20_000,
	},
});
