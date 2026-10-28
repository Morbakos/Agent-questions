import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

// Tests du serveur et du paquet partagé. L'UI a son propre lanceur (`ng test`).
export default defineConfig({
	resolve: {
		// Les tests lisent les sources du paquet partagé : pas besoin de le compiler avant.
		alias: {
			"@agent-questions/shared": fileURLToPath(new URL("./shared/src/index.ts", import.meta.url)),
		},
	},
	test: {
		include: ["server/**/*.test.ts", "shared/**/*.test.ts"],
		environment: "node",
	},
});
