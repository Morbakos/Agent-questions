import { fileURLToPath } from "node:url";

const path = (relative: string) => fileURLToPath(new URL(relative, import.meta.url));

/**
 * Same aliases as `paths` in tsconfig.json, shared by `vitest.config.ts` (unit) and `vitest.config.e2e.ts`:
 * `resolve.tsconfigPaths` (Vite 8) does not rewrite `.js` to `.ts` for aliases.
 */
export const alias = {
	"@app": path("./src/app"),
	"@server": path("./src"),
};
