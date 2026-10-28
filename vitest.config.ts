import { defineConfig } from "vitest/config";

// Tests du serveur et du paquet partagé. L'UI a son propre lanceur (`ng test`).
export default defineConfig({
	test: {
		include: ["server/**/*.test.ts", "shared/**/*.test.ts"],
		environment: "node",
	},
});
