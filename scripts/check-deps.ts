// The published package is the root package: its `dependencies` are installed on the user's machine and serve as the
// bundle's `external` list (`scripts/build-server.ts`). Those of `packages/server` are the source of truth for the
// server code: every server runtime dependency must therefore appear at the root with the same range, otherwise the
// published bundle would crash at startup ("Cannot find package"). The root may have extra ones (for example the
// peers of `@nestjs/mcp`).
import { dependencies as root } from "../package.json" with { type: "json" };
import { dependencies as server } from "../packages/server/package.json" with { type: "json" };

const problems: string[] = [];
for (const [name, range] of Object.entries(server as Record<string, string>)) {
	const published = (root as Record<string, string>)[name];
	if (published === undefined) {
		problems.push(`${name} (${range}) : absent des dependencies du paquet racine`);
	} else if (published !== range) {
		problems.push(`${name} : packages/server demande ${range}, le paquet racine ${published}`);
	}
}

if (problems.length > 0) {
	console.error("Runtime dependencies out of sync between packages/server and the root package:");
	for (const problem of problems) {
		console.error(`  - ${problem}`);
	}
	process.exit(1);
}
console.log("Runtime dependencies aligned (packages/server ⊆ root package).");
